"""Personal taste model (I-79): a logistic regression trained on the user's own swipes.

Every judged outfit is one training example (liked = 1, disliked = 0). Its features describe the outfit, not single
items: which garment types and colours it has, the top colour × bottom colour pair, whether it is layered, patterned,
short-sleeved, all-neutral, how many bright colours, how formal and how dark it is. The model is small and trained
from scratch on each request (plain gradient descent with L2, no dependencies): a few hundred examples take
milliseconds, and nothing has to be stored. It is used once there are at least MIN_EXAMPLES swipes with both likes and
dislikes; before that the per-type and per-colour counting (I-77) stands in.
"""
from math import exp

from app.models.schemas import Pattern, Sleeve, WardrobeItem
from .catalog import BOTTOM, BRIGHT, DARK, GARMENTS, NEUTRAL, OUTER, SHOES, TOP

#: fewer swipes than this, or only likes / only dislikes: no model
MIN_EXAMPLES = 8
MIN_PER_CLASS = 2
L2 = 0.05
STEPS = 200
RATE = 0.5


def features(worn: list[WardrobeItem]) -> dict[str, float]:
    """Sparse description of an outfit; every value is 0…1."""
    f: dict[str, float] = {}
    for i in worn:
        f[f"type:{i.type.value}"] = 1.0
        f[f"color:{i.dominantColor.value}"] = 1.0
    tops = [i for i in worn if GARMENTS[i.type].slot == TOP]
    bottoms = [i for i in worn if GARMENTS[i.type].slot == BOTTOM]
    if tops and bottoms:
        f[f"pair:{tops[0].dominantColor.value}+{bottoms[0].dominantColor.value}"] = 1.0
    clothes = [i for i in worn if GARMENTS[i.type].slot != SHOES]
    if any(GARMENTS[i.type].slot == OUTER for i in worn):
        f["layered"] = 1.0
    if any(i.pattern == Pattern.PATTERN for i in worn):
        f["patterned"] = 1.0
    if any(i.sleeve == Sleeve.SHORT for i in tops):
        f["short-sleeve"] = 1.0
    colors = {i.dominantColor for i in worn}
    if colors <= NEUTRAL:
        f["all-neutral"] = 1.0
    bright = len(colors & BRIGHT)
    if bright:
        f["bright"] = min(1.0, bright / 2)
    if clothes:
        f["formal"] = sum(GARMENTS[i.type].formality for i in clothes) / (5 * len(clothes))
        f["dark"] = sum(1 for i in clothes if i.dominantColor in DARK) / len(clothes)
    return f


def _sigmoid(z: float) -> float:
    return 1 / (1 + exp(-max(-30.0, min(30.0, z))))


class TasteModel:
    def __init__(self, weights: dict[str, float], bias: float, examples: int, likes: int):
        self.weights, self.bias, self.examples, self.likes = weights, bias, examples, likes

    def probability(self, worn: list[WardrobeItem]) -> float:
        """Chance (0…1) that the user likes this outfit."""
        return _sigmoid(self.bias + sum(self.weights.get(k, 0.0) * v for k, v in features(worn).items()))

    def top(self, n: int = 3) -> tuple[list[str], list[str]]:
        """The features that pull most towards a like and towards a dislike."""
        ranked = sorted(self.weights.items(), key=lambda kv: (-kv[1], kv[0]))
        likes = [k for k, w in ranked[:n] if w > 0.05]
        dislikes = [k for k, w in sorted(self.weights.items(), key=lambda kv: (kv[1], kv[0]))[:n] if w < -0.05]
        return likes, dislikes


def train(examples: list[tuple[list[WardrobeItem], bool]]) -> TasteModel | None:
    """Logistic regression by batch gradient descent; None when there is too little to learn from."""
    likes = sum(1 for _, liked in examples if liked)
    if len(examples) < MIN_EXAMPLES or min(likes, len(examples) - likes) < MIN_PER_CLASS:
        return None
    rows = [(features(worn), 1.0 if liked else 0.0) for worn, liked in examples]
    weights: dict[str, float] = {k: 0.0 for f, _ in rows for k in f}
    bias, n = 0.0, len(rows)
    for _ in range(STEPS):
        grad = {k: L2 * w for k, w in weights.items()}
        gb = 0.0
        for f, y in rows:
            err = _sigmoid(bias + sum(weights[k] * v for k, v in f.items())) - y
            gb += err / n
            for k, v in f.items():
                grad[k] += err * v / n
        for k in weights:
            weights[k] -= RATE * grad[k]
        bias -= RATE * gb
    return TasteModel(weights, bias, n, likes)
