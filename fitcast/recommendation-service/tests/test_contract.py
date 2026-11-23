from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models.schemas import RecommendationRequest, RecommendationResponse


@pytest.fixture
def payload():
    return {
        "wardrobe": [{"id": "00000000-0000-4000-8000-000000000001",
                      "type": "TSHIRT", "dominantColor": "white", "fitTag": "GOOD"}],
        "weather": {"temperatureC": 18, "precipitation": "NONE"},
        "eventType": "CASUAL",
    }


def test_accepts_prisma_fields_and_normalizes_color(payload):
    payload["wardrobe"][0]["dominantColor"] = " Grey "
    parsed = RecommendationRequest.model_validate(payload)
    assert parsed.wardrobe[0].dominantColor == "gray"
    assert parsed.limit == 5


@pytest.mark.parametrize("field,value", [
    ("id", "not-a-uuid"), ("type", "BOOTS"),
    ("dominantColor", "#ffffff"), ("fitTag", "fits_well"),
])
def test_rejects_invalid_item(payload, field, value):
    payload["wardrobe"][0][field] = value
    with pytest.raises(ValidationError):
        RecommendationRequest.model_validate(payload)


def test_duplicate_ids_rejected(payload):
    payload["wardrobe"].append(deepcopy(payload["wardrobe"][0]))
    with pytest.raises(ValidationError):
        RecommendationRequest.model_validate(payload)


@pytest.mark.parametrize("temperature", [float("nan"), float("inf"), -91, 61, "18", True])
def test_invalid_temperature(payload, temperature):
    payload["weather"]["temperatureC"] = temperature
    with pytest.raises(ValidationError):
        RecommendationRequest.model_validate(payload)


@pytest.mark.parametrize("limit", [0, 6, 1.5, True])
def test_invalid_limit(payload, limit):
    payload["limit"] = limit
    with pytest.raises(ValidationError):
        RecommendationRequest.model_validate(payload)


def test_empty_wardrobe_is_valid(payload):
    payload["wardrobe"] = []
    assert RecommendationRequest.model_validate(payload).wardrobe == []


def test_unknown_fields_rejected(payload):
    payload["userId"] = "unexpected"
    with pytest.raises(ValidationError):
        RecommendationRequest.model_validate(payload)


def test_invalid_event_and_precipitation(payload):
    for field, value in [("eventType", "PICNIC"), ("precipitation", "HAIL")]:
        candidate = deepcopy(payload)
        target = candidate if field == "eventType" else candidate["weather"]
        target[field] = value
        with pytest.raises(ValidationError):
            RecommendationRequest.model_validate(candidate)


def test_wardrobe_size_bound(payload):
    payload["wardrobe"] *= 201
    with pytest.raises(ValidationError):
        RecommendationRequest.model_validate(payload)


def test_response_status_must_match_outfits():
    with pytest.raises(ValidationError):
        RecommendationResponse(status="OK", outfits=[])
    assert RecommendationResponse(status="NO_VALID_OUTFITS", outfits=[]).outfits == []


def test_api_contract(payload):
    client = TestClient(app)
    assert client.get("/health").json() == {"status": "ok"}
    response = client.post("/recommendations", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "NO_VALID_OUTFITS"  # a single T-shirt is not an outfit
    payload["wardrobe"][0]["dominantColor"] = "unknown"
    assert client.post("/recommendations", json=payload).status_code == 422
