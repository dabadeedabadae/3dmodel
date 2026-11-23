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


class WardrobeItem(ContractModel):
    id: UUID
    type: GarmentType
    dominantColor: ColorName
    fitTag: FitTag

    @field_validator("dominantColor", mode="before")
    @classmethod
    def normalize_color(cls, value):
        if isinstance(value, str):
            normalized = value.strip().lower()
            return "gray" if normalized == "grey" else normalized
        return value


class Weather(ContractModel):
    temperatureC: Annotated[float, Field(strict=True, ge=-90, le=60)]
    precipitation: Precipitation


class RecommendationRequest(ContractModel):
    wardrobe: list[WardrobeItem] = Field(max_length=200)
    weather: Weather
    eventType: EventType
    limit: Annotated[int, Field(strict=True, ge=1, le=5)] = 5

    @model_validator(mode="after")
    def unique_item_ids(self):
        ids = [item.id for item in self.wardrobe]
        if len(ids) != len(set(ids)):
            raise ValueError("wardrobe item IDs must be unique")
        return self


Score = Annotated[float, Field(ge=0, le=100)]


class ScoreBreakdown(ContractModel):
    weather: Score
    occasion: Score
    color: Score
    # Optional: GOOD-only filtering makes fit constant, so weighting is pending.
    fit: Score | None = None


class OutfitRecommendation(ContractModel):
    items: list[UUID] = Field(min_length=1)
    score: Score
    breakdown: ScoreBreakdown
    explanation: str = Field(min_length=1)

    @field_validator("items")
    @classmethod
    def unique_items(cls, items):
        if len(items) != len(set(items)):
            raise ValueError("outfit item IDs must be unique")
        return items


class RecommendationStatus(str, Enum):
    OK = "OK"
    NO_VALID_OUTFITS = "NO_VALID_OUTFITS"


class RecommendationResponse(ContractModel):
    status: RecommendationStatus
    outfits: list[OutfitRecommendation] = Field(max_length=5)
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def consistent_status(self):
        if (self.status == RecommendationStatus.OK) != bool(self.outfits):
            raise ValueError("OK requires outfits; NO_VALID_OUTFITS requires an empty list")
        return self
