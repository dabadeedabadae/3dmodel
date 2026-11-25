"""The evaluation script (scripts/evaluate_taste.py). The users here are made up to test the script itself: their
numbers say nothing about real people."""
import random
from uuid import uuid4

from scripts.evaluate_taste import MIN_SWIPES, PREDICTORS, counting, evaluate, load_item, markdown


def _item(type_, color, **more):
    return {"id": str(uuid4()), "type": type_, "dominantColor": color, "fitTag": "GOOD", **more}


def _user(name, likes, n=40, seed=1):
    tops = [_item(t, c) for t in ("TSHIRT", "SHIRT", "HOODIE") for c in ("navy", "white", "red", "green")]
    bottoms = [_item(t, c) for t in ("JEANS", "PANTS") for c in ("gray", "black")]
    pairs = [(a, b) for a in tops for b in bottoms]
    random.Random(seed).shuffle(pairs)
    return {"id": name, "wardrobe": tops + bottoms,
            "swipes": [{"items": [a["id"], b["id"]], "liked": likes(a, b)} for a, b in pairs[:n]]}


def test_a_learnable_taste_beats_always_like():
    data = {"users": [_user("u1", lambda a, b: a["dominantColor"] in ("navy", "white") and a["type"] != "HOODIE")]}
    result = evaluate(data)
    row = result["rows"][0]
    assert row["swipes"] == 40 and set(row["accuracy"]) == set(PREDICTORS)
    assert abs(row["accuracy"]["always like"] - row["likes"]) < 0.15
    assert row["accuracy"]["model"] > row["accuracy"]["always like"] + 0.15
    assert result["overall"] == row["accuracy"]


def test_random_swipes_are_not_predicted():
    rng = random.Random(3)
    result = evaluate({"users": [_user("coin", lambda a, b: rng.random() < 0.5)]})
    assert result["rows"][0]["accuracy"]["model"] < 0.7


def test_chronological_split_and_determinism():
    data = {"users": [_user("u1", lambda a, b: a["dominantColor"] == "navy")]}
    assert evaluate(data) == evaluate(data)
    chrono = evaluate(data, chronological=True)
    assert "time order" in chrono["protocol"] and chrono["rows"][0]["accuracy"]["model"] >= 0.5


def test_users_without_enough_usable_swipes_are_skipped():
    few = _user("few", lambda a, b: a["dominantColor"] == "navy", n=MIN_SWIPES - 1)
    one_sided = _user("fan", lambda a, b: True)
    gone = _user("gone", lambda a, b: a["dominantColor"] == "navy")
    gone["wardrobe"] = gone["wardrobe"][:2]  # the swiped items were deleted since
    result = evaluate({"users": [few, one_sided, gone]})
    assert result["rows"] == [] and [name for name, _, _ in result["skipped"]] == ["few", "fan", "gone"]
    assert "Skipped few" in markdown(result)


def test_items_come_from_database_rows_and_bad_ones_are_dropped():
    row = _item("TSHIRT", "Grey", attributes={"pattern": "pattern", "sleeve": "short", "tone": "light"})
    loaded = load_item(row)
    assert loaded.dominantColor.value == "gray" and loaded.pattern.value == "pattern" and loaded.sleeve.value == "short"
    assert load_item(_item("TSHIRT", "turquoise")) is None


def test_counting_matches_the_api_formula():
    navy, red = load_item(_item("TSHIRT", "navy")), load_item(_item("TSHIRT", "red"))
    taste = counting([([navy], True), ([navy], True), ([red], False)])
    # sum / (count + 2): navy +2/4, red −1/3, T-shirts +1/5
    assert taste.colors == {"navy": 0.5, "red": -0.333} and taste.types == {"TSHIRT": 0.2}


def test_table_has_one_row_per_user_and_a_total():
    data = {"users": [_user("u1", lambda a, b: a["dominantColor"] == "navy"),
                      _user("u2", lambda a, b: b["type"] == "JEANS", seed=2)]}
    table = markdown(evaluate(data))
    assert "| u1 | 40 |" in table and "| u2 | 40 |" in table and "**all (2 users)**" in table
