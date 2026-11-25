"""Proposed HTTP contract aligned with Prisma field names and enums."""
from enum import Enum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class GarmentType(str, Enum):
    TSHIRT = "TSHIRT"
    SHIRT = "SHIRT"
    JACKET = "JACKET"
    COAT = "COAT"
    SWEATER = "SWEATER"
    HOODIE = "HOODIE"
    CARDIGAN = "CARDIGAN"
    BLAZER = "BLAZER"
    PANTS = "PANTS"
    JEANS = "JEANS"
    SHORTS = "SHORTS"
    SKIRT = "SKIRT"
    DRESS = "DRESS"
    SHOES = "SHOES"
    ACCESSORY = "ACCESSORY"


class FitTag(str, Enum):
    GOOD = "GOOD"
    TIGHT = "TIGHT"
    LOOSE = "LOOSE"


class EventType(str, Enum):
    CASUAL = "CASUAL"
    GYM = "GYM"
    BUSINESS = "BUSINESS"
    FORMAL = "FORMAL"
    OUTDOOR = "OUTDOOR"
    DATE = "DATE"
    WEDDING_GUEST = "WEDDING_GUEST"
    INTERVIEW = "INTERVIEW"
    PARTY = "PARTY"
    THEATER = "THEATER"
    TRAVEL = "TRAVEL"
    STUDY = "STUDY"
    FAMILY_WALK = "FAMILY_WALK"


class ColorName(str, Enum):
    BLACK = "black"
    WHITE = "white"
    GRAY = "gray"
    BEIGE = "beige"
    BROWN = "brown"
    RED = "red"
    ORANGE = "orange"
    YELLOW = "yellow"
    GREEN = "green"
    BLUE = "blue"
    NAVY = "navy"
    PURPLE = "purple"
    PINK = "pink"


class Precipitation(str, Enum):
    NONE = "NONE"
    RAIN = "RAIN"
    SNOW = "SNOW"
    MIXED = "MIXED"


class Pattern(str, Enum):
    SOLID = "solid"
    PATTERN = "pattern"


class Sleeve(str, Enum):
    SHORT = "short"
    LONG = "long"


class WardrobeItem(ContractModel):
    id: UUID
    type: GarmentType
    dominantColor: ColorName
    fitTag: FitTag
    #: read from the photo on the device (I-77); absent when unknown
    pattern: Pattern | None = None
    secondaryColor: ColorName | None = None
    sleeve: Sleeve | None = None

    @field_validator("dominantColor", "secondaryColor", mode="before")
    @classmethod
    def normalize_color(cls, value):
        if isinstance(value, str):
            normalized = value.strip().lower()
            return "gray" if normalized == "grey" else normalized
        return value


class Weather(ContractModel):
    temperatureC: Annotated[float, Field(strict=True, ge=-90, le=60)]
    precipitation: Precipitation
    #: wind at 10 m, km/h (I-79); absent when unknown
    windKph: Annotated[float, Field(ge=0, le=300)] | None = None


TasteWeight = Annotated[float, Field(ge=-1, le=1)]


class Taste(ContractModel):
    """The user's taste learned from likes and dislikes: −1 (avoid) … +1 (loves), per garment type and colour."""
    types: dict[GarmentType, TasteWeight] = Field(default_factory=dict)
    colors: dict[ColorName, TasteWeight] = Field(default_factory=dict)


class JudgedOutfit(ContractModel):
    """One swipe: the outfit's items (ids from `wardrobe`) and the verdict. Training data of the taste model."""
    items: list[UUID] = Field(min_length=1, max_length=8)
    liked: bool


class RecommendationRequest(ContractModel):
    wardrobe: list[WardrobeItem] = Field(max_length=200)
    weather: Weather
    eventType: EventType
    limit: Annotated[int, Field(strict=True, ge=1, le=10)] = 5
    #: personal taste; shifts the score by up to ±TASTE_POINTS
    taste: Taste | None = None
    #: outfits already judged (each a list of item ids) — not returned again
    exclude: list[list[UUID]] = Field(default_factory=list, max_length=500)
    #: also propose one item to buy that would make each outfit better
    suggest: bool = False
    #: garment types the user does not wear (e.g. skirts and dresses in a men's feed): never used or suggested
    avoidTypes: list[GarmentType] = Field(default_factory=list, max_length=15)
    #: local hour of the occasion, 0–23 (I-79): an evening out favours a dark outfit
    hour: Annotated[int, Field(strict=True, ge=0, le=23)] | None = None
    #: every swipe so far (I-79): the personal taste model is trained on it
    history: list[JudgedOutfit] = Field(default_factory=list, max_length=500)
    #: items of outfits saved in the last week (I-79): repeating them costs a little
    recentItems: list[UUID] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def unique_item_ids(self):
        ids = [item.id for item in self.wardrobe]
        if len(ids) != len(set(ids)):
            raise ValueError("wardrobe item IDs must be unique")
        return self


Score = Annotated[float, Field(ge=0, le=100)]


class Factor(ContractModel):
    """One style factor that moved the score: harmony, coherence, contrast, evening, freshness, wind."""
    key: str
    points: float
    note: str = Field(min_length=1)


class ScoreBreakdown(ContractModel):
    weather: Score
    occasion: Score
    color: Score
    # Optional: GOOD-only filtering makes fit constant, so weighting is pending.
    fit: Score | None = None
    #: personal taste shift in points (−TASTE_POINTS … +TASTE_POINTS); absent without a taste
    taste: Annotated[float, Field(ge=-10, le=10)] | None = None
    #: style factors in points (I-79), their sum limited to ±12; absent when none applies
    style: Annotated[float, Field(ge=-12, le=12)] | None = None
    factors: list[Factor] = Field(default_factory=list)


class PurchaseSuggestion(ContractModel):
    """An item the user does not own that would raise this outfit's score."""
    type: GarmentType
    dominantColor: ColorName
    #: the wardrobe item it would replace; null when it is added (e.g. shoes, a layer)
    replaces: UUID | None = None
    #: the outfit's score with the new item instead
    score: Score
    #: score points it adds; 0 for shoes added to an outfit without any (they complete it rather than lift it)
    gain: Annotated[float, Field(ge=0, le=100)]
    reason: str = Field(min_length=1)


class OutfitRecommendation(ContractModel):
    items: list[UUID] = Field(min_length=1)
    score: Score
    breakdown: ScoreBreakdown
    explanation: str = Field(min_length=1)
    suggestion: PurchaseSuggestion | None = None

    @field_validator("items")
    @classmethod
    def unique_items(cls, items):
        if len(items) != len(set(items)):
            raise ValueError("outfit item IDs must be unique")
        return items


class RecommendationStatus(str, Enum):
    OK = "OK"
    NO_VALID_OUTFITS = "NO_VALID_OUTFITS"


class TasteModelInfo(ContractModel):
    """The trained taste model (I-79): how much it learned from and what it found."""
    examples: int
    likes: int
    #: features that pull most towards a like / a dislike, e.g. "color:navy", "layered", "pair:white+navy"
    prefers: list[str] = Field(default_factory=list)
    avoids: list[str] = Field(default_factory=list)


class RecommendationResponse(ContractModel):
    status: RecommendationStatus
    outfits: list[OutfitRecommendation] = Field(max_length=10)
    warnings: list[str] = Field(default_factory=list)
    #: present once there are enough swipes to train on
    tasteModel: TasteModelInfo | None = None

    @model_validator(mode="after")
    def consistent_status(self):
        if (self.status == RecommendationStatus.OK) != bool(self.outfits):
            raise ValueError("OK requires outfits; NO_VALID_OUTFITS requires an empty list")
        return self
