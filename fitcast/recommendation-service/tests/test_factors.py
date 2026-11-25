"""Style factors, wind and the trained taste model (I-79)."""
import random
from uuid import UUID, uuid4

from app.engine.learn import MIN_EXAMPLES, features, train
from app.engine.recommend import recommend
from app.models.schemas import RecommendationRequest, WardrobeItem


def item(type_, color, **more):
    return {"id": str(uuid4()), "type": type_, "dominantColor": color, "fitTag": "GOOD", **more}


def ask(wardrobe, event="CASUAL", t=18.0, p="NONE", **more):
    weather = {"temperatureC": t, "precipitation": p}
    if "windKph" in more:
        weather["windKph"] = more.pop("windKph")
    return recommend(RecommendationRequest.model_validate(
        {"wardrobe": wardrobe, "weather": weather, "eventType": event, "limit": 10, **more}))


def find(response, *ids):
    want = {UUID(i["id"]) for i in ids}
    return next(o for o in response.outfits if set(o.items) == want)


def factor(outfit, key):
    return next((f for f in outfit.breakdown.factors if f.key == key), None)


def test_plain_outfit_has_no_style_points():
    top, bottom = item("TSHIRT", "gray"), item("JEANS", "gray")
    o = find(ask([top, bottom]), top, bottom)
    assert o.breakdown.style is None and o.breakdown.factors == []


def test_harmony_rewards_complementary_and_punishes_fighting_colors():
    blue, jeans = item("TSHIRT", "blue"), item("JEANS", "gray")
    orange_shoes, green_shoes = item("SHOES", "orange"), item("SHOES", "green")
    r = ask([blue, jeans, orange_shoes, green_shoes])
    good, bad = find(r, blue, jeans, orange_shoes), find(r, blue, jeans, green_shoes)
    assert factor(good, "harmony").points > 0 and factor(bad, "harmony").points < 0
    assert good.score > bad.score


def test_coherence_punishes_hoodie_with_dress_pants():
    hoodie, tee, pants = item("HOODIE", "gray"), item("SWEATER", "gray"), item("PANTS", "black")
    r = ask([hoodie, tee, pants], t=12.0)
    assert factor(find(r, hoodie, pants), "coherence").points < 0
    assert factor(find(r, tee, pants), "coherence") is None


def test_contrast_same_color_and_light_dark():
    red_top, red_bottom = item("TSHIRT", "red"), item("JEANS", "red")
    white_top, navy_bottom = item("TSHIRT", "white"), item("JEANS", "navy")
    r = ask([red_top, red_bottom, white_top, navy_bottom])
    assert factor(find(r, red_top, red_bottom), "contrast").points < 0
    assert factor(find(r, white_top, navy_bottom), "contrast").points > 0


def test_evening_favours_dark_only_for_going_out():
    dark, light, pants = item("SHIRT", "black"), item("SHIRT", "white"), item("PANTS", "navy")
    beige = item("PANTS", "beige")
    wardrobe = [dark, light, pants, beige]
    evening = ask(wardrobe, event="THEATER", hour=20)
    assert factor(find(evening, dark, pants), "evening").points > 0
    assert factor(find(evening, light, beige), "evening").points < 0
    assert factor(find(ask(wardrobe, event="THEATER", hour=12), dark, pants), "evening") is None
    assert factor(find(ask(wardrobe, event="STUDY", hour=20), dark, pants), "evening") is None


def test_freshness_costs_recently_worn_items():
    worn, fresh, jeans = item("TSHIRT", "gray"), item("TSHIRT", "black"), item("JEANS", "gray")
    r = ask([worn, fresh, jeans], recentItems=[worn["id"]])
    assert factor(find(r, worn, jeans), "freshness").points == -3
    assert factor(find(r, fresh, jeans), "freshness") is None


def test_wind_lowers_the_weather_score_without_a_layer():
    tee, jeans, jacket = item("SWEATER", "gray"), item("JEANS", "gray"), item("JACKET", "black")
    wardrobe = [tee, jeans, jacket]
    calm, windy = ask(wardrobe, t=10.0), ask(wardrobe, t=10.0, windKph=40)
    assert find(windy, tee, jeans).breakdown.weather < find(calm, tee, jeans).breakdown.weather
    assert factor(find(windy, tee, jeans), "wind") is not None
    # no wind chill in warm weather
    assert factor(find(ask(wardrobe, t=22.0, windKph=40), tee, jeans), "wind") is None


def test_no_model_before_enough_swipes():
    top, bottom = item("TSHIRT", "gray"), item("JEANS", "gray")
    history = [{"items": [top["id"], bottom["id"]], "liked": True}] * (MIN_EXAMPLES - 1)
    assert ask([top, bottom], history=history).tasteModel is None


def _wardrobe():
    tops = [item(t, c) for t in ("TSHIRT", "SHIRT", "SWEATER", "HOODIE") for c in ("navy", "white", "red", "green")]
    bottoms = [item(t, c) for t in ("JEANS", "PANTS") for c in ("gray", "black", "beige")]
    return tops, bottoms


def test_model_learns_a_hidden_taste_and_moves_the_ranking():
    """A user who likes navy tops and dislikes hoodies: the model must recover it from the swipes."""
    tops, bottoms = _wardrobe()
    by_id = {UUID(i["id"]): WardrobeItem.model_validate(i) for i in tops + bottoms}
    pairs = [(a, b) for a in tops for b in bottoms]
    random.Random(7).shuffle(pairs)

    def likes(a, b):
        return a["type"] != "HOODIE" and a["dominantColor"] in ("navy", "white")

    seen, held_out = pairs[:60], pairs[60:]
    history = [{"items": [a["id"], b["id"]], "liked": likes(a, b)} for a, b in seen]
    model = train([([by_id[UUID(a["id"])], by_id[UUID(b["id"])]], likes(a, b)) for a, b in seen])
    assert model is not None
    right = sum((model.probability([by_id[UUID(a["id"])], by_id[UUID(b["id"])]]) > 0.5) == likes(a, b)
                for a, b in held_out)
    assert right / len(held_out) >= 0.85, f"held-out accuracy {right}/{len(held_out)}"

    r = ask(tops + bottoms, history=history)
    assert r.tasteModel is not None and r.tasteModel.examples == 60
    assert any(f in ("type:HOODIE", "color:red", "color:green") for f in r.tasteModel.avoids)
    # the best outfit is one the user would like, and it carries taste points
    best = r.outfits[0]
    top = next(i for i in tops if UUID(i["id"]) in best.items)
    assert likes(top, None) and best.breakdown.taste > 0


def test_history_with_deleted_items_is_skipped():
    top, bottom = item("TSHIRT", "gray"), item("JEANS", "gray")
    history = [{"items": [str(uuid4())], "liked": True}] * 20
    assert ask([top, bottom], history=history).tasteModel is None


def test_features_describe_the_outfit():
    f = features([WardrobeItem.model_validate(item("TSHIRT", "white", sleeve="short", pattern="pattern")),
                  WardrobeItem.model_validate(item("JEANS", "navy")),
                  WardrobeItem.model_validate(item("JACKET", "black"))])
    assert f["pair:white+navy"] == 1 and f["layered"] == 1 and f["patterned"] == 1 and f["short-sleeve"] == 1
    assert f["all-neutral"] == 1 and "bright" not in f
