"""How well is a user's next swipe predicted? Train on part of their swipes, test on the rest.

    python -m scripts.evaluate_taste swipes.json            # from recommendation-service/
    python -m scripts.evaluate_taste swipes.json --chronological

Input (what scripts/export_swipes.sql prints): {"users": [{"id": "u1", "wardrobe": [item, …], "swipes": [
{"items": [item id, …], "liked": true}, …]}]}; swipes are in the order they were made. An item is a wardrobe row:
id, type, dominantColor, fitTag and either `attributes` (the database column) or pattern / secondaryColor / sleeve.

Four predictors are compared on the same held-out swipes:
- model: the logistic regression of app/engine/learn.py, like when probability > 0.5;
- counting: per-type and per-colour sums (tasteFrom in the API, I-77), like when the outfit's sum is positive;
- served: the two averaged, as the engine does when it scores an outfit;
- always like: the baseline every other column has to beat — it equals the share of likes.
When a predictor has nothing to say (too few swipes for the model, a zero sum), it answers with the majority verdict
of the training swipes.

Default protocol: REPEATS random splits, TRAIN_SHARE of the swipes for training, accuracy averaged over the splits
(30 swipes leave only 9 to test on, so a single split is noisy). --chronological uses one split instead: the first
TRAIN_SHARE of the swipes in time order against the later ones, which is how the feed actually works.

The output is a Markdown table. It reports what the data shows; it is not a tuned or selected result.
"""
import argparse
import json
import random
import sys
from pathlib import Path

from pydantic import ValidationError

from app.engine.learn import train
from app.engine.recommend import TASTE_POINTS, taste_points
from app.models.schemas import Taste, WardrobeItem

TRAIN_SHARE = 0.7
REPEATS = 20
SEED = 7
#: users with fewer usable swipes than this are listed as skipped
MIN_SWIPES = 10
PREDICTORS = ("model", "counting", "served", "always like")


def load_item(raw: dict) -> WardrobeItem | None:
    """A wardrobe row as the API would send it to the service; None when the service would reject it."""
    attributes = raw.get("attributes") or {}
    data = {k: raw[k] for k in ("id", "type", "dominantColor", "fitTag") if k in raw}
    for key in ("pattern", "secondaryColor", "sleeve"):
        value = raw.get(key, attributes.get(key))
        if value:
            data[key] = value
    try:
        return WardrobeItem.model_validate(data)
    except ValidationError:
        return None


def counting(examples: list[tuple[list[WardrobeItem], bool]]) -> Taste:
    """tasteFrom of the API (src/recommendations/recommendations.service.ts): ±1 per item, sum / (count + 2)."""
    acc: dict[str, dict] = {"types": {}, "colors": {}}
    for worn, liked in examples:
        for i in worn:
            for group, key in (("types", i.type), ("colors", i.dominantColor)):
                total, n = acc[group].get(key, (0, 0))
                acc[group][key] = (total + (1 if liked else -1), n + 1)
    weights = {group: {k: max(-1.0, min(1.0, round(total / (n + 2), 3))) for k, (total, n) in values.items()}
               for group, values in acc.items()}
    return Taste(types={k: w for k, w in weights["types"].items() if w},
                 colors={k: w for k, w in weights["colors"].items() if w})


def predict(train_set: list, test_set: list) -> dict[str, list[bool]]:
    """Per predictor, whether each held-out swipe was called right."""
    likes = sum(1 for _, liked in train_set if liked)
    majority = likes * 2 >= len(train_set)
    model, taste = train(train_set), counting(train_set)
    right: dict[str, list[bool]] = {name: [] for name in PREDICTORS}
    for worn, liked in test_set:
        learned = None if model is None else TASTE_POINTS * (2 * model.probability(worn) - 1)
        counted = taste_points(worn, taste)
        served = counted if learned is None else learned if counted is None else (learned + counted) / 2
        for name, points in (("model", learned), ("counting", counted), ("served", served)):
            guess = majority if points is None or points == 0 else points > 0
            right[name].append(guess == liked)
        right["always like"].append(liked)
    return right


def evaluate_user(swipes: list, chronological: bool, rng: random.Random) -> dict[str, float]:
    """Accuracy per predictor: the mean over the splits."""
    cut = max(1, min(len(swipes) - 1, round(TRAIN_SHARE * len(swipes))))
    if chronological:
        splits = [(swipes[:cut], swipes[cut:])]
    else:
        splits = []
        for _ in range(REPEATS):
            shuffled = swipes[:]
            rng.shuffle(shuffled)
            splits.append((shuffled[:cut], shuffled[cut:]))
    per_split: dict[str, list[float]] = {name: [] for name in PREDICTORS}
    for train_set, test_set in splits:
        for name, hits in predict(train_set, test_set).items():
            per_split[name].append(sum(hits) / len(hits))
    return {name: sum(values) / len(values) for name, values in per_split.items()}


def evaluate(data: dict, chronological: bool = False, seed: int = SEED) -> dict:
    rng = random.Random(seed)
    rows, skipped = [], []
    for n, user in enumerate(data.get("users", []), start=1):
        name = str(user.get("id", f"u{n}"))
        items = {}
        for raw in user.get("wardrobe") or []:
            item = load_item(raw)
            if item is not None:
                items[str(item.id)] = item
        swipes = [([items[str(i)] for i in s["items"]], bool(s["liked"])) for s in user.get("swipes") or []
                  if s.get("items") and all(str(i) in items for i in s["items"])]
        likes = sum(1 for _, liked in swipes if liked)
        if len(swipes) < MIN_SWIPES:
            skipped.append((name, len(swipes), "fewer than %d usable swipes" % MIN_SWIPES))
            continue
        if likes in (0, len(swipes)):
            skipped.append((name, len(swipes), "only likes or only dislikes"))
            continue
        rows.append({"user": name, "swipes": len(swipes), "likes": likes / len(swipes),
                     "accuracy": evaluate_user(swipes, chronological, rng)})
    total = sum(r["swipes"] for r in rows)
    # weighted by the number of swipes, so a user with 100 swipes counts more than one with 30
    overall = ({name: sum(r["accuracy"][name] * r["swipes"] for r in rows) / total for name in PREDICTORS}
               if rows else {})
    return {"rows": rows, "skipped": skipped, "overall": overall, "swipes": total,
            "protocol": (f"first {TRAIN_SHARE:.0%} of each user's swipes in time order against the rest" if chronological
                         else f"{REPEATS} random splits per user, {TRAIN_SHARE:.0%} train / the rest test, seed {seed}")}


def markdown(result: dict) -> str:
    def pct(x: float) -> str:
        return f"{100 * x:.0f} %"

    lines = ["| User | Swipes | Likes | Model | Counting | Served (both) | Always like |",
             "|---|---|---|---|---|---|---|"]
    for r in result["rows"]:
        a = r["accuracy"]
        lines.append(f"| {r['user']} | {r['swipes']} | {pct(r['likes'])} | " +
                     " | ".join(pct(a[name]) for name in PREDICTORS) + " |")
    if result["rows"]:
        o = result["overall"]
        lines.append(f"| **all ({len(result['rows'])} users)** | {result['swipes']} | | " +
                     " | ".join(f"**{pct(o[name])}**" for name in PREDICTORS) + " |")
    lines.append("")
    lines.append(f"Held-out accuracy; {result['protocol']}. \"All\" is weighted by the number of swipes.")
    for name, n, why in result["skipped"]:
        lines.append(f"Skipped {name}: {n} usable swipes ({why}).")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("path", type=Path, help="JSON written by scripts/export_swipes.sql")
    parser.add_argument("--chronological", action="store_true", help="one split in time order instead of random ones")
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args(argv)
    try:
        # utf-8-sig / utf-16: PowerShell's ">" writes a byte-order mark
        raw = args.path.read_bytes()
        data = json.loads(raw.decode("utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig"))
    except (OSError, ValueError) as error:
        print(f"{args.path} is not the JSON that scripts/export_swipes.sql prints: {error}", file=sys.stderr)
        return 2
    result = evaluate(data, args.chronological, args.seed)
    print(markdown(result))
    if not result["rows"]:
        print("No user has enough swipes to evaluate.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
