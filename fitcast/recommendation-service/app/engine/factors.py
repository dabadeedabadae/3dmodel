"""Style factors (I-79): what makes an outfit look put together beyond occasion, weather and the colour count.

Each factor returns points (plus or minus) and a short note; an outfit with nothing remarkable gets no points at all,
so the base score stays what it was. The sum is limited to ±STYLE_POINTS.

- harmony: the chromatic colours on the colour wheel: neighbours (analogous) or opposites (complementary) go
  together, colours in between fight;
- coherence: a hoodie with a blazer or dress pants: garments three or more formality steps apart do not belong in
  one outfit;
- contrast: the same chromatic colour on top and bottom looks like a uniform; a light top over a dark bottom (or the
  reverse) reads well;
- evening: after 18:00 a going-out occasion favours a dark outfit;
- freshness: items from outfits saved in the last week cost a little, so the feed does not repeat itself.
"""
from itertools import combinations

from app.models.schemas import ColorName as C, EventType as E, WardrobeItem
from .catalog import BOTTOM, DARK, GARMENTS, LIGHT_TONE, NEUTRAL, SHOES, TOP

STYLE_POINTS = 12.0
#: hue angle on the colour wheel, degrees
HUE = {C.RED: 0, C.BROWN: 25, C.ORANGE: 30, C.YELLOW: 60, C.GREEN: 120, C.BLUE: 220, C.PURPLE: 280, C.PINK: 330}
EVENING_EVENTS = {E.PARTY, E.THEATER, E.DATE, E.FORMAL, E.WEDDING_GUEST}
EVENING_HOUR = 18


def _hue_gap(a: C, b: C) -> float:
    d = abs(HUE[a] - HUE[b]) % 360
    return min(d, 360 - d)


def harmony(worn: list[WardrobeItem]):
    chromatic = list(dict.fromkeys(i.dominantColor for i in worn if i.dominantColor in HUE))
    if len(chromatic) < 2:
        return None
    gaps = [_hue_gap(a, b) for a, b in combinations(chromatic, 2)]
    if all(g <= 45 for g in gaps):
        return 3.0, "neighbouring colors"
    if len(chromatic) == 2 and 150 <= gaps[0] <= 210:
        return 3.0, "complementary colors"
    if any(60 <= g <= 135 for g in gaps):
        return -4.0, "colors that fight"
    return None


def coherence(clothes: list[WardrobeItem]):
    levels = [GARMENTS[i.type].formality for i in clothes]
    if max(levels) - min(levels) >= 3:
        return -5.0, "sporty and dressy pieces mixed"
    return None


def contrast(worn: list[WardrobeItem]):
    tops = [i for i in worn if GARMENTS[i.type].slot == TOP]
    bottoms = [i for i in worn if GARMENTS[i.type].slot == BOTTOM]
    if not tops or not bottoms:
        return None
    a, b = tops[0].dominantColor, bottoms[0].dominantColor
    if a == b and a not in NEUTRAL:
        return -3.0, f"{a.value} head to toe"
    if (a in LIGHT_TONE and b in DARK) or (a in DARK and b in LIGHT_TONE):
        return 2.0, "light and dark balance"
    return None


def evening(clothes: list[WardrobeItem], event: E, hour: int | None):
    if hour is None or hour < EVENING_HOUR or event not in EVENING_EVENTS:
        return None
    dark = sum(1 for i in clothes if i.dominantColor in DARK)
    if dark * 2 > len(clothes):
        return 3.0, "dark for the evening"
    if dark == 0:
        return -2.0, "light for an evening out"
    return None


def freshness(worn: list[WardrobeItem], recent: frozenset):
    n = sum(1 for i in worn if i.id in recent and GARMENTS[i.type].slot != SHOES)
    if not n:
        return None
    return -min(6.0, 3.0 * n), "worn this week"


def style(worn: list[WardrobeItem], clothes: list[WardrobeItem], event: E, hour: int | None,
          recent: frozenset) -> list[tuple[str, float, str]]:
    """[(key, points, note)] for every factor that applies; the caller limits the total to ±STYLE_POINTS."""
    found = (("harmony", harmony(worn)), ("coherence", coherence(clothes)), ("contrast", contrast(worn)),
             ("evening", evening(clothes, event, hour)), ("freshness", freshness(worn, recent)))
    return [(key, value[0], value[1]) for key, value in found if value is not None]
