"""Outfit recommendation, rules v1.

1. Items tagged TIGHT are skipped with a warning; LOOSE ones are worn at a cost (the `fit` factor, 3 points per
   item, 6 on a business-or-dressier occasion) and `breakdown.fit` reports it as 0–100.
2. Hard rules remove items: types that do not belong to the occasion, forbidden colours (white for a wedding guest),
   weather (no shorts below 10 °C, no sweater / hoodie / cardigan / coat / jacket from 25 °C, no coat from 20 °C,
   no light shoes in rain or snow — unless the wardrobe has no darker pair: then the light ones are worn with a
   warning and the `rain` factor, −5).
3. Outfits are top + bottom or a dress, plus shoes and up to two layers (one of them, a cardigan under a jacket or
   coat, or a blazer under a coat — a casual jacket does not go over a blazer). Below 5 °C a jacket or a coat is required; if the wardrobe has none, nothing is recommended (hard weather
   constraints are never relaxed). Shoes are optional only when no suitable pair exists, and the response says so.
4. Each outfit is scored 0–100 on occasion (formality close to the event, the types it asks for, calm palette),
   weather (total warmth for the temperature, a jacket or coat against rain) and colour (2–3 colours, neutrals go
   with everything, two bright colours clash). Total = 0.40 occasion + 0.35 weather + 0.25 colour.
5. The best outfits are picked greedily with a penalty for reusing items, so the list is not five variations of one
   shirt.
6. Personal taste (I-77): the user's likes and dislikes, summed per garment type and colour by the API, shift each
   outfit by up to ±TASTE_POINTS. Outfits the user already judged (`exclude`) are not returned again.
7. What the photo says (I-77): a patterned item brings its second colour into the colour count; two patterned
   items in one outfit compete (the `patterns` factor, −5); a pattern costs a formal occasion 8 points per item; a
   short-sleeved top without a layer below +12 °C costs 5 points and from +25 °C adds 2 (the `sleeve` factor); a
   long sleeve without a layer from +25 °C costs 10 weather points.
9. Style factors (I-79, factors.py): colour-wheel harmony, formality coherence, light / dark contrast, a dark
   outfit for an evening out, freshness (items saved this week cost a little); their sum, limited to ±12 points, is
   added to the total. Wind (I-79): from 20 km/h below +15 °C the outfit is scored for a temperature 2 °C lower
   (4 °C from 35 km/h), and going without a layer costs 8 weather points.
10. Trained taste (I-79, learn.py): with 8 or more swipes (likes and dislikes both) a logistic regression over the
   outfit's features is trained on them; its like-probability, scaled to ±TASTE_POINTS, is averaged with the
   counting of item 6.
8. Purchase suggestions (I-77, `suggest`): for each outfit, every item the user does not own (each type of the same
   slot × each colour) is tried in place of each worn item, plus shoes or a warm layer when missing; the single change
   that raises the score most, by at least MIN_GAIN points, is returned with a reason.
"""
from itertools import combinations, product
from uuid import UUID

from app.models.schemas import (
    ColorName, FitTag, GarmentType, OutfitRecommendation, Pattern, Precipitation, PurchaseSuggestion,
    RecommendationRequest, RecommendationResponse, RecommendationStatus, ScoreBreakdown, Sleeve, Taste, WardrobeItem,
)
from dataclasses import dataclass

from app.models.schemas import EventType, Factor, TasteModelInfo
from .catalog import BOTTOM, BRIGHT, EVENTS, GARMENTS, LIGHT, NEUTRAL, ONE_PIECE, OUTER, SHOES, TOP, EventRules
from .factors import STYLE_POINTS, fit_score, style
from .learn import TasteModel, train


@dataclass(frozen=True)
class Extra:
    """What the request knows beyond occasion, temperature and precipitation (I-79)."""
    event: EventType | None = None
    hour: int | None = None
    wind: float | None = None
    recent: frozenset = frozenset()
    model: TasteModel | None = None


NO_EXTRA = Extra()


def feels_like(t: float, wind: float | None) -> float:
    """Wind chill, coarse: only in cool weather, 2 °C from 20 km/h and 4 °C from 35 km/h."""
    if wind is None or t >= 15 or wind < 20:
        return t
    return t - (4 if wind >= 35 else 2)

G = GarmentType
WEIGHTS = {"occasion": 0.40, "weather": 0.35, "color": 0.25}
#: items kept per slot after the per-item ranking; bounds the combinations (≈64 bases · ≤25 layer options · 8 shoes)
PER_SLOT = 8
WARM_OUTER = {G.JACKET, G.COAT}
#: the most personal taste can move an outfit's score
TASTE_POINTS = 10.0
#: a purchase is only suggested when it raises the score by at least this much
MIN_GAIN = 3.0
TOO_WARM_FOR_HEAT = {G.SWEATER, G.HOODIE, G.CARDIGAN, G.COAT, G.JACKET}
WET = {Precipitation.RAIN, Precipitation.SNOW, Precipitation.MIXED}
PRECIP_TEXT = {Precipitation.RAIN: "rain", Precipitation.SNOW: "snow", Precipitation.MIXED: "rain and snow"}


def clamp(v: float) -> float:
    return max(0.0, min(100.0, v))


def target_warmth(t: float) -> int:
    """Sum of item warmth (0–3 each) that feels right at temperature t."""
    for limit, warmth in ((25, 1), (20, 2), (15, 3), (10, 4), (5, 5), (0, 6)):
        if t >= limit:
            return warmth
    return 7


def hard_reject(item: WardrobeItem, rules: EventRules, t: float, p: Precipitation) -> bool:
    info = GARMENTS[item.type]
    if item.type in rules.forbidden:
        return True
    if info.slot != SHOES and item.dominantColor in rules.forbidden_colors:
        return True
    if t >= 25 and item.type in TOO_WARM_FOR_HEAT:
        return True
    if t >= 20 and item.type == G.COAT:
        return True
    if t < 10 and item.type == G.SHORTS:
        return True
    if p in WET and info.slot == SHOES and item.dominantColor in LIGHT:
        return True
    return False


def item_occasion(item: WardrobeItem, rules: EventRules) -> float:
    """How well one item suits the occasion: formality distance and the palette."""
    info = GARMENTS[item.type]
    # the type says nothing about how formal a pair of shoes is
    score = 80.0 if info.slot == SHOES else 100 - 25 * abs(info.formality - rules.formality)
    if rules.palette is not None and item.dominantColor not in rules.palette:
        score -= 20
    return clamp(score)


def outfit_occasion(worn: list[WardrobeItem], rules: EventRules) -> float:
    """Average item fit, plus up to 20 points for wearing the types the occasion asks for (a blazer for an interview)."""
    base = sum(item_occasion(i, rules) for i in worn) / len(worn)
    if not rules.preferred:
        return clamp(base)
    present = len({i.type for i in worn} & rules.preferred)
    return clamp(0.8 * base + 20 * min(1.0, present / min(len(rules.preferred), 3)))


def color_score(colors: list, rules: EventRules) -> tuple[float, str]:
    distinct = list(dict.fromkeys(colors))
    # neutrals go with everything, so only the other colours count towards "two or three colours"
    chromatic = [c for c in distinct if c not in NEUTRAL]
    score = {0: 100, 1: 100, 2: 85, 3: 60}.get(len(chromatic), 35)
    if len(distinct) > 3:
        score -= 5 * (len(distinct) - 3)
    bright = [c for c in distinct if c in BRIGHT]
    pairs = len(list(combinations(bright, 2)))
    score -= pairs * (15 if rules.bright_ok else 30)
    if not bright:
        phrase = "calm neutral colors" if all(c in NEUTRAL for c in distinct) else "calm colors"
    elif len(bright) == 1:
        phrase = f"neutral base with a {bright[0].value} accent"
    else:
        phrase = "bold color mix" if rules.bright_ok else "two bright colors compete"
    return clamp(score), phrase


def weather_score(clothes: list[WardrobeItem], layers: tuple, t: float, p: Precipitation) -> float:
    warmth = sum(GARMENTS[i.type].warmth for i in clothes)
    # one step off is a matter of taste (a coat instead of a jacket at +8 °C); more is not
    diff = abs(warmth - target_warmth(t))
    score = 100 - 25 * max(0, diff - 1)
    if p in WET and not any(o.type in WARM_OUTER for o in layers):
        score -= 20
    if p == Precipitation.SNOW and any(i.type in (G.SKIRT, G.DRESS) for i in clothes):
        score -= 15
    if t < 3 and not any(o.type == G.COAT for o in layers):
        score -= 10
    return clamp(score)


def describe(item: WardrobeItem) -> str:
    # "patterned gray T-shirt": the photo said the item is not one colour (I-77)
    patterned = "patterned " if item.pattern == Pattern.PATTERN else ""
    return f"{patterned}{item.dominantColor.value} {GARMENTS[item.type].noun}"


def explanation(rules: EventRules, t: float, p: Precipitation, base: tuple, layers: tuple, shoes, color_phrase: str,
                cold: bool) -> str:
    conditions = f"{round(t):+d} °C" + (f", {PRECIP_TEXT[p]}" if p in PRECIP_TEXT else "")
    if layers:
        # outermost first: "beige coat over a navy blazer, white shirt and gray pants"
        under = [*reversed(layers[:-1]), *base]
        inner = ", ".join(describe(i) for i in under[:-1]) + (" and " if len(under) > 1 else "") + describe(under[-1])
        clothes = f"{describe(layers[-1])} over a {inner}"
    elif len(base) == 2:
        clothes = f"{describe(base[0])} with {describe(base[1])}"
    else:
        clothes = describe(base[0])
    if shoes is not None:
        clothes += f", {shoes.dominantColor.value} shoes"
    notes = [color_phrase]
    warm = any(o.type in WARM_OUTER for o in layers)
    if cold and warm:
        notes.append("a warm layer for the cold")
    elif p in WET and warm:
        notes.append("a layer against the " + ("snow" if p == Precipitation.SNOW else "rain"))
    return f"{rules.label}, {conditions}: {clothes}; " + ", ".join(notes) + "."


def layer_options(outers: list[WardrobeItem], cold: bool) -> list[tuple]:
    """No layer, one layer, a cardigan under a jacket / coat, or a blazer under a coat. In the cold a warm layer is
    mandatory. (I-77: "jacket over blazer over cardigan" won the interview before — a casual jacket does not go over
    a blazer, and a cardigan is a layer, not the only top.)"""
    warm = [o for o in outers if o.type in WARM_OUTER]
    stacked = [(u, w) for u in outers for w in warm
               if (u.type == G.CARDIGAN) or (u.type == G.BLAZER and w.type == G.COAT)]
    if cold:
        return [(w,) for w in warm] + stacked
    return [(), *((o,) for o in outers), *stacked]


def taste_points(worn: list[WardrobeItem], taste: Taste | None) -> float | None:
    """Average liking of the worn items (type and colour, −1…+1) scaled to ±TASTE_POINTS."""
    if taste is None or not (taste.types or taste.colors):
        return None
    per_item = [(taste.types.get(i.type, 0.0) + taste.colors.get(i.dominantColor, 0.0)) / 2 for i in worn]
    return round(TASTE_POINTS * sum(per_item) / len(per_item), 1)


def evaluate(base: tuple, layers: tuple, shoes, rules: EventRules, t: float, p: Precipitation, taste: Taste | None,
             extra: Extra = NO_EXTRA):
    clothes = [*base, *layers]
    worn = [*clothes, *([shoes] if shoes else [])]
    occasion = outfit_occasion(worn, rules)
    felt = feels_like(t, extra.wind)
    weather = weather_score(clothes, layers, felt, p)
    factors = (style(worn, clothes, extra.event, extra.hour, extra.recent, t, p, rules.formality)
               if extra.event is not None else [])
    if felt < t and not layers:
        weather = clamp(weather - 8)
        factors.append(("wind", 0.0, "windy: a layer would help"))
    elif felt < t:
        factors.append(("wind", 0.0, "a layer against the wind"))
    colors = [i.dominantColor for i in worn] + [i.secondaryColor for i in worn if i.secondaryColor is not None]
    color, phrase = color_score(colors, rules)
    # two patterns and a short sleeve in the cold are style factors now (factors.py: patterns, sleeve)
    patterned = [i for i in clothes if i.pattern == Pattern.PATTERN]
    if rules.formality >= 4:
        occasion = clamp(occasion - 8 * len(patterned))
    tops = [i for i in base if GARMENTS[i.type].slot == TOP]
    if not layers and any(i.sleeve == Sleeve.LONG for i in tops) and t >= 25:
        weather = clamp(weather - 10)
    tp = taste_points(worn, taste)
    if extra.model is not None:
        learned = TASTE_POINTS * (2 * extra.model.probability(worn) - 1)
        tp = round(learned if tp is None else (learned + tp) / 2, 1)
    sp = max(-STYLE_POINTS, min(STYLE_POINTS, sum(points for _, points, _ in factors)))
    total = (WEIGHTS["occasion"] * occasion + WEIGHTS["weather"] * weather + WEIGHTS["color"] * color + (tp or 0)
             + sp)
    return round(clamp(total), 1), occasion, weather, color, phrase, tp, worn, factors


SHOP_TYPES = {slot: [g for g, info in GARMENTS.items() if info.slot == slot] for slot in (TOP, BOTTOM, OUTER, SHOES)}


def _virtual(type_: GarmentType, color: ColorName) -> WardrobeItem:
    return WardrobeItem(id=UUID(int=0), type=type_, dominantColor=color, fitTag=FitTag.GOOD)


def suggest_purchase(base: tuple, layers: tuple, shoes, score: float, owned: set, rules: EventRules, t: float,
                     p: Precipitation, taste: Taste | None, cold: bool,
                     avoid: set | frozenset = frozenset(), extra: Extra = NO_EXTRA) -> PurchaseSuggestion | None:
    """The single not-owned item that raises this outfit's score most (replacing one worn item, or adding shoes /
    a warm layer). Items the occasion or weather rules out are never suggested."""
    best = None

    def disliked(item) -> bool:
        return taste is not None and (taste.types.get(item.type, 0) < 0 or taste.colors.get(item.dominantColor, 0) < 0)

    def consider(new_base, new_layers, new_shoes, item, replaces, why):
        nonlocal best
        # never suggest buying a type or colour the user keeps swiping away
        if hard_reject(item, rules, t, p) or disliked(item) or item.type in avoid:
            return
        if cold and not any(o.type in WARM_OUTER for o in new_layers):
            return
        total = evaluate(new_base, new_layers, new_shoes, rules, t, p, taste, extra)[0]
        gain = round(total - score, 1)
        if gain >= MIN_GAIN and (best is None or gain > best[0]):
            best = (gain, total, item, replaces, why)

    colors = list(ColorName)
    for k, worn in enumerate(base):
        for g in SHOP_TYPES.get(GARMENTS[worn.type].slot, []):
            for c in colors:
                if (g, c) in owned:
                    continue
                item = _virtual(g, c)
                consider(base[:k] + (item,) + base[k + 1:], layers, shoes, item, worn, "instead of your")
    for k, worn in enumerate(layers):
        for g in SHOP_TYPES[OUTER]:
            for c in colors:
                if (g, c) in owned:
                    continue
                item = _virtual(g, c)
                new_layers = layers[:k] + (item,) + layers[k + 1:]
                if len(new_layers) == 2 and new_layers not in layer_options(list(new_layers), cold):
                    continue
                consider(base, new_layers, shoes, item, worn, "instead of your")
    if shoes is not None:
        for c in colors:
            if (G.SHOES, c) not in owned:
                item = _virtual(G.SHOES, c)
                consider(base, layers, item, item, shoes, "instead of your")
    else:
        # an outfit without shoes is incomplete: always suggest the pair that suits it best, even with no score gain
        pairs = [(evaluate(base, layers, _virtual(G.SHOES, c), rules, t, p, taste, extra)[0], c) for c in colors
                 if not hard_reject(_virtual(G.SHOES, c), rules, t, p)]
        if pairs:
            total, c = max(pairs, key=lambda x: x[0])
            if best is None:
                best = (max(0.0, round(total - score, 1)), total, _virtual(G.SHOES, c), None, "to complete the outfit")
    if not layers:
        for g in sorted(WARM_OUTER):
            for c in colors:
                if (g, c) not in owned:
                    item = _virtual(g, c)
                    consider(base, (item,), shoes, item, None, "on top")
    if best is None:
        return None
    gain, total, item, replaces, why = best
    noun = GARMENTS[item.type].noun
    what = f"{item.dominantColor.value} {noun}"
    what = what.capitalize() if noun.endswith("s") else f"A {what}"
    if gain <= 0:
        reason = f"{what} would complete this outfit."
    elif replaces is not None:
        reason = f"{what} {why} {describe(replaces)} lifts this outfit from {score:.0f} to {total:.0f}."
    else:
        reason = f"{what} {why} lifts this outfit from {score:.0f} to {total:.0f}."
    return PurchaseSuggestion(type=item.type, dominantColor=item.dominantColor,
                              replaces=replaces.id if replaces is not None else None, score=total, gain=gain,
                              reason=reason)


def recommend(request: RecommendationRequest) -> RecommendationResponse:
    rules = EVENTS[request.eventType]
    t, p = request.weather.temperatureC, request.weather.precipitation
    warnings: list[str] = []

    # LOOSE items are worn at a cost (the fit factor); TIGHT ones are not worn at all
    good = [i for i in request.wardrobe if i.fitTag != FitTag.TIGHT]
    if len(good) < len(request.wardrobe):
        n = len(request.wardrobe) - len(good)
        warnings.append(f"{n} item(s) tagged as too tight were not used.")
    avoid = set(request.avoidTypes)
    usable = [i for i in good if not hard_reject(i, rules, t, p) and i.type not in avoid]
    by_slot: dict[str, list[WardrobeItem]] = {}
    for item in usable:
        by_slot.setdefault(GARMENTS[item.type].slot, []).append(item)
    for items in by_slot.values():
        items.sort(key=lambda i: (-item_occasion(i, rules), str(i.id)))
        del items[PER_SLOT:]

    bases: list[tuple] = [(a, b) for a, b in product(by_slot.get(TOP, []), by_slot.get(BOTTOM, []))]
    bases += [(d,) for d in by_slot.get(ONE_PIECE, [])]
    if not bases:
        warnings.append(f"No complete outfit for \"{rules.label}\" at {round(t):+d} °C: it needs a suitable top and "
                        "bottom, or a dress.")
        return RecommendationResponse(status=RecommendationStatus.NO_VALID_OUTFITS, outfits=[], warnings=warnings)

    cold = t < 5
    layers_list = layer_options(by_slot.get(OUTER, []), cold)
    if not layers_list:
        warnings.append(f"It is {round(t):+d} °C: add a jacket or a coat to your wardrobe to get outfits for this "
                        "weather.")
        return RecommendationResponse(status=RecommendationStatus.NO_VALID_OUTFITS, outfits=[], warnings=warnings)

    shoes_options: list = by_slot.get(SHOES, [])
    if not shoes_options and p in WET:
        # only light pairs in wet weather: better worn than no shoes at all, at a cost (the rain factor)
        light = [i for i in good if GARMENTS[i.type].slot == SHOES and i.type not in avoid
                 and not hard_reject(i, rules, t, Precipitation.NONE)]
        light.sort(key=lambda i: (-item_occasion(i, rules), str(i.id)))
        shoes_options = light[:PER_SLOT]
        if shoes_options:
            warnings.append("Your shoes are light for wet weather; a darker pair would suit it better.")
    if not shoes_options:
        warnings.append("Add shoes to your wardrobe to get complete outfits.")
        shoes_options = [None]

    # the taste model is trained on every swipe whose items are still in the wardrobe
    by_id = {i.id: i for i in request.wardrobe}
    model = train([([by_id[i] for i in h.items], h.liked) for h in request.history
                   if all(i in by_id for i in h.items)])
    extra = Extra(event=request.eventType, hour=request.hour, wind=request.weather.windKph,
                  recent=frozenset(request.recentItems), model=model)
    model_info = None
    if model is not None:
        prefers, avoids = model.top()
        model_info = TasteModelInfo(examples=model.examples, likes=model.likes, prefers=prefers, avoids=avoids)

    excluded = {frozenset(ids) for ids in request.exclude}
    scored = []
    for base, layers, shoes in product(bases, layers_list, shoes_options):
        total, occasion, weather, color, phrase, tp, worn, factors = evaluate(base, layers, shoes, rules, t, p,
                                                                              request.taste, extra)
        if frozenset(i.id for i in worn) in excluded:
            continue
        scored.append((total, occasion, weather, color, phrase, base, layers, shoes, worn, tp, factors))
    scored.sort(key=lambda s: (-s[0], [str(i.id) for i in s[8]]))

    # greedy diversity: each pick costs later outfits 6 points per shared item; ties keep the deterministic order
    pool = [(s, frozenset(i.id for i in s[8])) for s in scored]
    picked: list = []
    picked_ids: list[frozenset] = []
    while pool and len(picked) < request.limit:
        best_k, best_value = 0, None
        for k, (s, ids) in enumerate(pool):
            if best_value is not None and s[0] <= best_value:
                break  # sorted by score: nothing further down can win, even with zero overlap
            value = s[0] - 6 * max((len(ids & q) for q in picked_ids), default=0)
            if best_value is None or value > best_value:
                best_k, best_value = k, value
        best, best_ids = pool.pop(best_k)
        picked.append(best)
        picked_ids.append(best_ids)
        pool = [(s, ids) for s, ids in pool if ids != best_ids]
    picked.sort(key=lambda s: -s[0])  # the variety decided *which* outfits; show them best first

    owned = {(i.type, i.dominantColor) for i in request.wardrobe}
    outfits = [
        OutfitRecommendation(
            items=[i.id for i in worn], score=total,
            breakdown=ScoreBreakdown(
                occasion=round(occ, 1), weather=round(wea, 1), color=round(col, 1),
                fit=fit_score(worn, rules.formality), taste=tp,
                style=max(-STYLE_POINTS, min(STYLE_POINTS, sum(x[1] for x in factors))) if factors else None,
                factors=[Factor(key=k, points=pts, note=note) for k, pts, note in factors]),
            explanation=explanation(rules, t, p, base, layers, shoes, phrase, cold),
            suggestion=suggest_purchase(base, layers, shoes, total, owned, rules, t, p, request.taste, cold, avoid,
                                        extra)
            if request.suggest else None,
        )
        for total, occ, wea, col, phrase, base, layers, shoes, worn, tp, factors in picked
    ]
    return RecommendationResponse(status=RecommendationStatus.OK, outfits=outfits, warnings=warnings,
                                  tasteModel=model_info)
