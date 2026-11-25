import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.engine.recommend import recommend
from app.main import app
from app.models.schemas import RecommendationRequest

_counter = iter(range(1, 10_000))


def item(type_, color, fit="GOOD"):
    return {"id": str(uuid.UUID(int=next(_counter))), "type": type_, "dominantColor": color, "fitTag": fit}


def run(wardrobe, event, t, p="NONE", limit=5):
    req = RecommendationRequest.model_validate(
        {"wardrobe": wardrobe, "weather": {"temperatureC": t, "precipitation": p}, "eventType": event, "limit": limit})
    res = recommend(req)
    by_id = {str(i["id"]): i for i in wardrobe}
    outfits = [[by_id[str(x)] for x in o.items] for o in res.outfits]
    return res, outfits


def types(outfit):
    return {i["type"] for i in outfit}


@pytest.fixture
def wardrobe():
    return [
        item("SHIRT", "white"), item("SHIRT", "blue"), item("TSHIRT", "red"), item("HOODIE", "green"),
        item("SWEATER", "gray"), item("PANTS", "gray"), item("JEANS", "blue"), item("SHORTS", "beige"),
        item("BLAZER", "navy"), item("JACKET", "black"), item("COAT", "beige"),
        item("SHOES", "black"), item("SHOES", "white"), item("DRESS", "red"),
    ]


def test_business_in_the_rain_is_smart_calm_and_has_no_light_shoes(wardrobe):
    res, outfits = run(wardrobe, "BUSINESS", 8, "RAIN")
    assert res.status == "OK" and 1 <= len(outfits) <= 5
    for o in outfits:
        assert not types(o) & {"HOODIE", "SHORTS"}
        assert not any(i["type"] == "SHOES" and i["dominantColor"] == "white" for i in o)
    best = outfits[0]
    assert {"SHIRT", "PANTS"} <= types(best)
    assert types(best) & {"BLAZER", "COAT", "JACKET"}, "a layer against the rain"
    assert res.outfits[0].explanation.startswith("Business meeting, +8 °C, rain:")


def test_interview_prefers_blazer_and_forbids_tshirt(wardrobe):
    _, outfits = run(wardrobe, "INTERVIEW", 18)
    assert all("TSHIRT" not in types(o) and "HOODIE" not in types(o) for o in outfits)
    assert "BLAZER" in types(outfits[0])


def test_wedding_guest_never_wears_white_clothes(wardrobe):
    _, outfits = run(wardrobe, "WEDDING_GUEST", 20)
    assert outfits
    for o in outfits:
        assert not any(i["dominantColor"] == "white" and i["type"] != "SHOES" for i in o)


def test_cold_requires_warm_outerwear(wardrobe):
    _, outfits = run(wardrobe, "CASUAL", -5, "SNOW")
    assert outfits and all(types(o) & {"JACKET", "COAT"} for o in outfits)
    assert all("SHORTS" not in types(o) for o in outfits)
    no_outer = [i for i in wardrobe if i["type"] not in ("JACKET", "COAT")]
    res, outfits = run(no_outer, "CASUAL", -5, "SNOW")
    assert res.status == "NO_VALID_OUTFITS" and outfits == []
    assert any("jacket or a coat" in w for w in res.warnings)


def test_heat_removes_warm_layers(wardrobe):
    _, outfits = run(wardrobe, "CASUAL", 30)
    assert outfits
    for o in outfits:
        assert not types(o) & {"SWEATER", "HOODIE", "COAT", "JACKET"}


def test_gym_is_sporty(wardrobe):
    _, outfits = run(wardrobe, "GYM", 22)
    assert outfits
    for o in outfits:
        assert not types(o) & {"SHIRT", "BLAZER", "DRESS", "JEANS"}


def test_tight_and_loose_items_are_skipped_with_a_warning(wardrobe):
    wardrobe.append(item("SHIRT", "navy", "TIGHT"))
    res, outfits = run(wardrobe, "BUSINESS", 15)
    tight = wardrobe[-1]["id"]
    assert all(tight not in [i["id"] for i in o] for o in outfits)
    assert any("too tight or too loose" in w for w in res.warnings)


def test_two_bright_colors_score_lower_than_neutrals():
    neutral = [item("TSHIRT", "white"), item("JEANS", "navy"), item("SHOES", "black")]
    loud = [item("TSHIRT", "red"), item("JEANS", "green"), item("SHOES", "black")]
    (_, _), (_, _) = run(neutral, "CASUAL", 20), run(loud, "CASUAL", 20)
    a = run(neutral, "CASUAL", 20)[0].outfits[0].breakdown.color
    b = run(loud, "CASUAL", 20)[0].outfits[0].breakdown.color
    assert a > b


def test_outfits_are_valid_unique_and_diverse(wardrobe):
    res, outfits = run(wardrobe, "CASUAL", 16, limit=5)
    assert len(outfits) == 5
    keys = [frozenset(i["id"] for i in o) for o in outfits]
    assert len(set(keys)) == 5
    for o, rec in zip(outfits, res.outfits):
        assert len({i["id"] for i in o}) == len(o)
        assert 0 <= rec.score <= 100
        assert rec.breakdown.fit is None
        slots = types(o)
        assert ("DRESS" in slots) or (slots & {"SHIRT", "TSHIRT", "SWEATER", "HOODIE"} and slots & {"PANTS", "JEANS", "SHORTS"})
    tops = [next(i["id"] for i in o if i["type"] in ("SHIRT", "TSHIRT", "SWEATER", "HOODIE", "DRESS")) for o in outfits]
    assert len(set(tops)) >= 2, "not five variations of one top"
    assert [r.score for r in res.outfits] != [] and res.outfits[0].score >= res.outfits[-1].score - 6 * 4


def test_without_shoes_outfits_still_come_with_a_warning():
    res, outfits = run([item("TSHIRT", "white"), item("JEANS", "blue")], "CASUAL", 20)
    assert res.status == "OK" and len(outfits) == 1
    assert any("Add shoes" in w for w in res.warnings)


def test_large_wardrobe_is_fast():
    colors = ["black", "white", "gray", "navy", "beige", "red", "blue", "green"]
    kinds = ["TSHIRT", "SHIRT", "SWEATER", "PANTS", "JEANS", "SKIRT", "SHOES", "JACKET", "COAT", "BLAZER"]
    big = [item(kinds[i % len(kinds)], colors[i % len(colors)]) for i in range(200)]
    start = time.perf_counter()
    res, outfits = run(big, "BUSINESS", 7, "RAIN")
    assert res.status == "OK" and len(outfits) == 5
    assert time.perf_counter() - start < 3


def test_http_endpoint_returns_recommendations(wardrobe):
    client = TestClient(app)
    body = {"wardrobe": wardrobe, "weather": {"temperatureC": 12.5, "precipitation": "NONE"}, "eventType": "DATE", "limit": 3}
    response = client.post("/recommendations", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "OK" and len(data["outfits"]) == 3
    ids = {i["id"] for i in wardrobe}
    assert all(set(o["items"]) <= ids for o in data["outfits"])


# ---- I-77: layers, taste, exclusions, purchase suggestions ----------------------------------------------------------

def run_req(wardrobe, event, t, p="NONE", limit=5, **extra):
    req = RecommendationRequest.model_validate(
        {"wardrobe": wardrobe, "weather": {"temperatureC": t, "precipitation": p}, "eventType": event, "limit": limit,
         **extra})
    res = recommend(req)
    by_id = {str(i["id"]): i for i in wardrobe}
    return res, [[by_id[str(x)] for x in o.items] for o in res.outfits]


def test_cardigan_is_a_layer_over_a_top_not_the_only_top():
    w = [item("CARDIGAN", "gray"), item("TSHIRT", "white"), item("JEANS", "blue"), item("SHOES", "black")]
    _, outfits = run_req(w, "CASUAL", 15, limit=10)
    assert outfits
    for o in outfits:
        assert types(o) & {"TSHIRT"}, "every outfit has a real top under the cardigan"


def test_casual_jacket_never_goes_over_a_blazer():
    w = [item("SHIRT", "white"), item("PANTS", "gray"), item("BLAZER", "navy"), item("JACKET", "black"),
         item("COAT", "beige"), item("CARDIGAN", "gray"), item("SHOES", "black")]
    _, outfits = run_req(w, "INTERVIEW", 2, limit=10)
    assert outfits
    for o in outfits:
        assert not {"BLAZER", "JACKET"} <= types(o)


def test_interview_has_no_jeans(wardrobe):
    _, outfits = run_req(wardrobe, "INTERVIEW", 18, limit=10)
    assert all("JEANS" not in types(o) for o in outfits)


def test_taste_moves_liked_colors_up():
    w = [item("TSHIRT", "navy"), item("TSHIRT", "gray"), item("JEANS", "blue"), item("SHOES", "black")]
    res_plain, plain = run_req(w, "CASUAL", 18)
    res_taste, liked = run_req(w, "CASUAL", 18, taste={"colors": {"gray": 1.0}, "types": {}})
    assert any(i["dominantColor"] == "gray" and i["type"] == "TSHIRT" for i in liked[0])
    assert res_taste.outfits[0].breakdown.taste is not None and res_taste.outfits[0].breakdown.taste > 0
    assert res_plain.outfits[0].breakdown.taste is None


def test_excluded_outfits_are_not_returned_again():
    w = [item("TSHIRT", "navy"), item("TSHIRT", "gray"), item("JEANS", "blue"), item("SHOES", "black")]
    res, outfits = run_req(w, "CASUAL", 18, limit=10)
    first = [str(x) for x in res.outfits[0].items]
    res2, _ = run_req(w, "CASUAL", 18, limit=10, exclude=[first])
    assert all(sorted(str(x) for x in o.items) != sorted(first) for o in res2.outfits)


def test_purchase_suggestion_raises_the_score_and_is_not_owned():
    # two bright colours clash on a date: a neutral item should be suggested
    w = [item("TSHIRT", "red"), item("JEANS", "green"), item("SHOES", "orange")]
    res, _ = run_req(w, "BUSINESS", 18, suggest=True)
    s = res.outfits[0].suggestion
    assert s is not None and s.gain >= 3 and s.score > res.outfits[0].score
    assert (s.type, s.dominantColor) not in {(i["type"], i["dominantColor"]) for i in w}
    assert s.reason


def test_suggestion_adds_shoes_when_there_are_none():
    w = [item("SHIRT", "white"), item("PANTS", "gray")]
    res, _ = run_req(w, "BUSINESS", 18, suggest=True)
    s = res.outfits[0].suggestion
    assert s is not None


def test_suggestion_skips_disliked_types_and_colors():
    w = [item("TSHIRT", "red"), item("JEANS", "green"), item("SHOES", "orange")]
    res, _ = run_req(w, "BUSINESS", 18, suggest=True,
                     taste={"types": {"PANTS": -0.5, "SHIRT": -0.5}, "colors": {"black": -0.4, "white": -0.4}})
    for o in res.outfits:
        s = o.suggestion
        if s is not None:
            assert s.type not in ("PANTS", "SHIRT") and s.dominantColor not in ("black", "white")


def test_avoided_types_are_never_used_or_suggested():
    w = [item("TSHIRT", "white"), item("SKIRT", "beige"), item("JEANS", "blue"), item("SHOES", "black")]
    res, outfits = run_req(w, "DATE", 18, limit=10, suggest=True, avoidTypes=["SKIRT", "DRESS"])
    assert outfits
    for o, rec in zip(outfits, res.outfits):
        assert "SKIRT" not in types(o)
        assert rec.suggestion is None or rec.suggestion.type not in ("SKIRT", "DRESS")


def item_x(type_, color, **extra):
    it = item(type_, color); it.update(extra); return it


def test_two_patterns_lose_to_one_pattern():
    w = [item_x("SHIRT", "white", pattern="pattern", secondaryColor="blue"), item_x("SHIRT", "white"),
         item_x("PANTS", "gray", pattern="pattern", secondaryColor="black"), item_x("SHOES", "black")]
    res, outfits = run_req(w, "CASUAL", 18, limit=10)
    best = outfits[0]
    assert sum(1 for i in best if i.get("pattern") == "pattern") <= 1


def test_short_sleeve_in_the_cold_prefers_long_sleeve():
    w = [item_x("TSHIRT", "white", sleeve="short"), item_x("TSHIRT", "gray", sleeve="long"), item("JEANS", "blue"),
         item("SHOES", "black")]
    _, outfits = run_req(w, "CASUAL", 9)
    assert any(i.get("sleeve") == "long" for i in outfits[0])


def test_pattern_costs_a_formal_occasion():
    w = [item_x("SHIRT", "white", pattern="pattern", secondaryColor="navy"), item_x("SHIRT", "blue"),
         item("PANTS", "gray"), item("BLAZER", "navy"), item("SHOES", "black")]
    _, outfits = run_req(w, "INTERVIEW", 18)
    assert not any(i.get("pattern") == "pattern" for i in outfits[0])


def test_unknown_attribute_values_are_rejected():
    with pytest.raises(Exception):
        RecommendationRequest.model_validate({"wardrobe": [item_x("SHIRT", "white", pattern="paisley")],
                                             "weather": {"temperatureC": 18, "precipitation": "NONE"}, "eventType": "CASUAL"})
