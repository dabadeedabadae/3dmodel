"""Coarse knowledge about garment types, colours and occasions (the rules; the trained taste model is learn.py).

Everything here is inferred from the garment *type* only: the wardrobe has no per-item style, season or warmth yet,
so a light jacket and a down jacket look the same to the engine. These tables are the place to tune the rules.
"""
from dataclasses import dataclass, field

from app.models.schemas import ColorName, EventType, GarmentType

G, E, C = GarmentType, EventType, ColorName

# ---- garments -------------------------------------------------------------------------------------------------

TOP, BOTTOM, ONE_PIECE, OUTER, SHOES, ACCESSORY = "TOP", "BOTTOM", "ONE_PIECE", "OUTER", "SHOES", "ACCESSORY"


@dataclass(frozen=True)
class GarmentInfo:
    slot: str
    formality: int  # 1 sporty … 5 dressed up
    warmth: int  # 0 none … 3 very warm
    styles: frozenset[str]
    noun: str  # for explanations


GARMENTS: dict[GarmentType, GarmentInfo] = {
    G.TSHIRT: GarmentInfo(TOP, 2, 1, frozenset({"SPORT", "CASUAL"}), "T-shirt"),
    G.SHIRT: GarmentInfo(TOP, 4, 1, frozenset({"CLASSIC", "CASUAL"}), "shirt"),
    G.SWEATER: GarmentInfo(TOP, 3, 2, frozenset({"CASUAL", "CLASSIC"}), "sweater"),
    G.HOODIE: GarmentInfo(TOP, 1, 2, frozenset({"SPORT", "CASUAL"}), "hoodie"),
    # I-77: a cardigan is a layer over a T-shirt, shirt or sweater, not the only top
    G.CARDIGAN: GarmentInfo(OUTER, 3, 2, frozenset({"CASUAL", "CLASSIC"}), "cardigan"),
    G.BLAZER: GarmentInfo(OUTER, 5, 0,frozenset({"CLASSIC"}), "blazer"),
    G.JACKET: GarmentInfo(OUTER, 2, 2, frozenset({"CASUAL", "SPORT"}), "jacket"),
    G.COAT: GarmentInfo(OUTER, 4, 3, frozenset({"CLASSIC"}), "coat"),
    G.PANTS: GarmentInfo(BOTTOM, 4, 2, frozenset({"CLASSIC", "CASUAL"}), "pants"),
    G.JEANS: GarmentInfo(BOTTOM, 2, 2, frozenset({"CASUAL"}), "jeans"),
    G.SHORTS: GarmentInfo(BOTTOM, 1, 0, frozenset({"SPORT", "CASUAL"}), "shorts"),
    G.SKIRT: GarmentInfo(BOTTOM, 3, 1, frozenset({"CASUAL", "CLASSIC"}), "skirt"),
    G.DRESS: GarmentInfo(ONE_PIECE, 4, 1, frozenset({"CLASSIC", "CASUAL"}), "dress"),
    G.SHOES: GarmentInfo(SHOES, 3, 1, frozenset({"SPORT", "CASUAL", "CLASSIC"}), "shoes"),
    G.ACCESSORY: GarmentInfo(ACCESSORY, 3, 0, frozenset({"SPORT", "CASUAL", "CLASSIC"}), "accessory"),
}

# ---- colours --------------------------------------------------------------------------------------------------

NEUTRAL = frozenset({C.BLACK, C.WHITE, C.GRAY, C.BEIGE, C.NAVY})
#: muted colours: not neutral, but they do not clash like two bright colours do
MUTED = frozenset({C.BROWN})
BRIGHT = frozenset(set(C) - NEUTRAL - MUTED)
#: calm palette for business-like occasions
CALM = frozenset({C.NAVY, C.GRAY, C.BLACK, C.BEIGE, C.WHITE, C.BROWN})
#: shoes in these colours show dirt in rain and snow
LIGHT = frozenset({C.WHITE, C.BEIGE, C.YELLOW, C.PINK})
#: dark and light tones (I-79): the balance of an outfit, and what suits an evening
DARK = frozenset({C.BLACK, C.NAVY, C.BROWN, C.PURPLE})
LIGHT_TONE = frozenset({C.WHITE, C.BEIGE, C.YELLOW, C.PINK})

# ---- occasions ------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class EventRules:
    label: str
    formality: float
    #: garment types that must not appear at all
    forbidden: frozenset[GarmentType] = frozenset()
    #: types that fit the occasion especially well (bonus)
    preferred: frozenset[GarmentType] = frozenset()
    #: colours that must not appear on clothes (shoes excluded)
    forbidden_colors: frozenset[ColorName] = frozenset()
    #: when set, colours outside it cost points
    palette: frozenset[ColorName] | None = None
    #: bright colours are welcome (no clash penalty for one or two accents)
    bright_ok: bool = False
    styles: frozenset[str] = field(default_factory=frozenset)


SMART_ONLY = frozenset({G.HOODIE, G.SHORTS})
EVENTS: dict[EventType, EventRules] = {
    E.CASUAL: EventRules("Casual", 2, styles=frozenset({"CASUAL"})),
    E.GYM: EventRules("Gym", 1, forbidden=frozenset({G.SHIRT, G.BLAZER, G.COAT, G.DRESS, G.SKIRT, G.JEANS, G.CARDIGAN}),
                      preferred=frozenset({G.TSHIRT, G.HOODIE, G.SHORTS}), bright_ok=True, styles=frozenset({"SPORT"})),
    E.BUSINESS: EventRules("Business meeting", 4, forbidden=SMART_ONLY, preferred=frozenset({G.BLAZER, G.SHIRT, G.PANTS}),
                           palette=CALM, styles=frozenset({"CLASSIC"})),
    E.FORMAL: EventRules("Formal event", 5, forbidden=SMART_ONLY | {G.TSHIRT, G.JEANS, G.JACKET},
                         preferred=frozenset({G.BLAZER, G.SHIRT, G.DRESS}), palette=CALM, styles=frozenset({"CLASSIC"})),
    E.OUTDOOR: EventRules("Outdoors", 1.5, forbidden=frozenset({G.BLAZER, G.DRESS}),
                          preferred=frozenset({G.JACKET, G.JEANS, G.HOODIE}), bright_ok=True, styles=frozenset({"SPORT", "CASUAL"})),
    E.DATE: EventRules("Date", 3, forbidden=frozenset({G.SHORTS}), preferred=frozenset({G.SHIRT, G.DRESS, G.SKIRT}),
                       bright_ok=True, styles=frozenset({"CASUAL", "CLASSIC"})),
    E.WEDDING_GUEST: EventRules("Wedding (guest)", 5, forbidden=SMART_ONLY | {G.TSHIRT, G.JEANS, G.JACKET},
                                preferred=frozenset({G.BLAZER, G.SHIRT, G.DRESS}),
                                forbidden_colors=frozenset({C.WHITE}), bright_ok=True, styles=frozenset({"CLASSIC"})),
    E.INTERVIEW: EventRules("Job interview", 4.5, forbidden=SMART_ONLY | {G.TSHIRT, G.JEANS},
                            preferred=frozenset({G.BLAZER, G.SHIRT, G.PANTS}), palette=CALM, styles=frozenset({"CLASSIC"})),
    E.PARTY: EventRules("Party", 3, forbidden=frozenset({G.SHORTS}), bright_ok=True, styles=frozenset({"CASUAL", "CLASSIC"})),
    E.THEATER: EventRules("Theater or restaurant", 4, forbidden=SMART_ONLY, preferred=frozenset({G.SHIRT, G.DRESS, G.BLAZER}),
                          styles=frozenset({"CLASSIC"})),
    E.TRAVEL: EventRules("Travel", 2, forbidden=frozenset({G.BLAZER}), preferred=frozenset({G.JEANS, G.HOODIE, G.JACKET}),
                         styles=frozenset({"CASUAL", "SPORT"})),
    E.STUDY: EventRules("Study", 2.5, preferred=frozenset({G.SWEATER, G.SHIRT, G.JEANS}), styles=frozenset({"CASUAL"})),
    E.FAMILY_WALK: EventRules("Walk with kids", 1.5, forbidden=frozenset({G.BLAZER, G.DRESS}),
                              preferred=frozenset({G.JEANS, G.HOODIE, G.JACKET}), bright_ok=True,
                              styles=frozenset({"CASUAL", "SPORT"})),
}
