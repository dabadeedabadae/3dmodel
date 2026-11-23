"""Outfit recommendation, rules v1.

1. Only items tagged GOOD are used (README decision 3); TIGHT / LOOSE are skipped with a warning.
2. Hard rules remove items: types that do not belong to the occasion, forbidden colours (white for a wedding guest),
   weather (no shorts below 10 °C, no sweater / hoodie / cardigan / coat / jacket from 25 °C, no coat from 20 °C,
   no light shoes in rain or snow).
3. Outfits are top + bottom or a dress, plus shoes and up to two layers (one of them, or a blazer under a jacket /
   coat). Below 5 °C a jacket or a coat is required; if the wardrobe has none, nothing is recommended (hard weather
   constraints are never relaxed). Shoes are optional only when no suitable pair exists, and the response says so.
4. Each outfit is scored 0–100 on occasion (formality close to the event, the types it asks for, calm palette),
   weather (total warmth for the temperature, a jacket or coat against rain) and colour (2–3 colours, neutrals go
   with everything, two bright colours clash). Total = 0.40 occasion + 0.35 weather + 0.25 colour.
5. The best outfits are picked greedily with a penalty for reusing items, so the list is not five variations of one
   shirt.
"""
from itertools import combinations, product

from app.models.schemas import (
    FitTag, GarmentType, OutfitRecommendation, Precipitation, RecommendationRequest, RecommendationResponse,
    RecommendationStatus, ScoreBreakdown, WardrobeItem,
)
from .catalog import BOTTOM, BRIGHT, EVENTS, GARMENTS, LIGHT, NEUTRAL, ONE_PIECE, OUTER, SHOES, TOP, EventRules

G = GarmentType
WEIGHTS = {"occasion": 0.40, "weather": 0.35, "color": 0.25}
#: items kept per slot after the per-item ranking; bounds the combinations (≈64 bases · ≤25 layer options · 8 shoes)
PER_SLOT = 8
WARM_OUTER = {G.JACKET, G.COAT}
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
    return f"{item.dominantColor.value} {GARMENTS[item.type].noun}"


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
    """No layer, one layer, or a blazer under a jacket / coat. In the cold a warm layer is mandatory."""
    warm = [o for o in outers if o.type in WARM_OUTER]
    blazers = [o for o in outers if o.type == G.BLAZER]
    stacked = [(b, w) for b in blazers for w in warm]
    if cold:
        return [(w,) for w in warm] + stacked
    return [(), *((o,) for o in outers), *stacked]


def recommend(request: RecommendationRequest) -> RecommendationResponse:
    rules = EVENTS[request.eventType]
    t, p = request.weather.temperatureC, request.weather.precipitation
    warnings: list[str] = []

    good = [i for i in request.wardrobe if i.fitTag == FitTag.GOOD]
    if len(good) < len(request.wardrobe):
        n = len(request.wardrobe) - len(good)
        warnings.append(f"{n} item(s) tagged as too tight or too loose were not used.")
    usable = [i for i in good if not hard_reject(i, rules, t, p)]
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
    if not shoes_options:
        had_shoes = any(GARMENTS[i.type].slot == SHOES for i in good)
        warnings.append("Your shoes are too light for wet weather, so outfits are shown without shoes."
                        if had_shoes and p in WET else "Add shoes to your wardrobe to get complete outfits.")
        shoes_options = [None]

    scored = []
    for base, layers, shoes in product(bases, layers_list, shoes_options):
        clothes = [*base, *layers]
        worn = [*clothes, *([shoes] if shoes else [])]
        occasion = outfit_occasion(worn, rules)
        weather = weather_score(clothes, layers, t, p)
        color, phrase = color_score([i.dominantColor for i in worn], rules)
        total = WEIGHTS["occasion"] * occasion + WEIGHTS["weather"] * weather + WEIGHTS["color"] * color
        scored.append((round(total, 1), occasion, weather, color, phrase, base, layers, shoes, worn))
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

    outfits = [
        OutfitRecommendation(
            items=[i.id for i in worn], score=total,
            breakdown=ScoreBreakdown(occasion=round(occ, 1), weather=round(wea, 1), color=round(col, 1), fit=None),
            explanation=explanation(rules, t, p, base, layers, shoes, phrase, cold),
        )
        for total, occ, wea, col, phrase, base, layers, shoes, worn in picked
    ]
    return RecommendationResponse(status=RecommendationStatus.OK, outfits=outfits, warnings=warnings)
