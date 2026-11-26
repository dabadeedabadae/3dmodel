# How the app learns from swipes

In the "Looks" feed you swipe through outfits: right (or ♥, or →) if you like one, left if you don't. After the
first swipes a "Your taste" box appears, and cards get notes like "+0.6 your taste", meaning how much your taste
moved that outfit up or down. After 8 swipes, with both likes and dislikes among them, you see "Personal model ·
trained on N swipes" and what the model noticed: what you like and what you avoid. Outfits you've already judged
don't come back.

## Step by step

### 1. What gets remembered

Every swipe is saved in the database as its own record:

- which items were in the outfit;
- like or dislike;
- which occasion or event it was for;
- the weather (temperature and precipitation);
- the score the outfit had.

You judge an outfit once per occasion or event, and swiping it again replaces the old verdict. An outfit you
disliked for an event isn't shown for that event again. The taste numbers themselves aren't stored anywhere: they
are worked out from your swipe history every time. If you delete an item, swipes with it simply stop counting.

### 2. Simple taste: counting types and colours (from the first swipe)

1. Each like adds +1, and each dislike −1, to **the type and the colour of every item** in the outfit.
2. The weight is `sum / (number of votes + 2)`, kept between −1 and +1. The "+2" means one swipe moves your taste a
   little, and many swipes that agree move it a lot: 1 like gives 0.33, 5 likes in a row give 0.71.
3. For an outfit, each item gets the average of its type weight and its colour weight. These are averaged over the
   items and multiplied by 10. That gives a shift between −10 and +10 points.

**Example.** You liked one outfit: white T-shirt, blue jeans, white shoes.

- Types: T-shirt, jeans and shoes got one "yes" each → weight 1/3 ≈ 0.33 each.
- Colours: blue 1/3 ≈ 0.33; white appeared twice → 2 / (2 + 2) = 0.5.
- The same outfit next time: T-shirt (0.33 + 0.5) / 2 = 0.42, jeans (0.33 + 0.33) / 2 = 0.33, shoes 0.42. Average
  0.39 × 10 = **+3.9 points**.
- A similar outfit with the same jeans but a different T-shirt and shoes goes up less. An outfit with none of these
  types and colours doesn't move at all.

### 3. Personal model (from 8 swipes)

Counting types and colours can't see combinations. It can't learn that you like a white top with a blue bottom but
not blue with blue. So once you have **8 swipes, including at least 2 likes and 2 dislikes**, a small learning model
switches on. It is a logistic regression, not a neural network.

1. Every judged outfit is described by features:
   - which item types and colours it has;
   - the pair "top colour + bottom colour";
   - whether it has an outer layer;
   - whether any item is patterned;
   - whether there's a short sleeve;
   - whether it's all neutral colours;
   - how many bright colours it has;
   - how dressy and how dark it is.
2. The model learns to predict "will like / won't like". It is trained from scratch on every request: 200 steps of
   gradient descent with regularisation. Even with hundreds of swipes this takes milliseconds, so there is nothing to
   store.
3. For each new outfit the model gives a chance of a like, `p`. That becomes points: `10 × (2p − 1)`, from −10
   (sure you won't like it) to +10 (sure you will).
4. These points are **averaged** with the simple counting points from step 2. The result still stays within ±10.
5. The three features with the biggest positive weight are shown as "prefers", the three most negative as "avoids".

### 4. How taste changes what you see

- Taste is one part of the score (see [recommendations.md](recommendations.md)). It can move an outfit up or down by
  at most 10 points. Occasion, weather and colours still weigh more, so taste can't rescue an outfit that's wrong for
  the weather, and it doesn't override the bans.
- Outfits you've already judged in the feed are left out, so you see new ones.
- The buy tip never suggests a type or colour you dislike on balance ([buy-advice.md](buy-advice.md)).

### 5. Does it work?

On real people the model's quality **hasn't been measured yet**. So far there's only a test with a made-up user who
follows a hidden taste rule: the model guesses at least 85 % of held-back outfits correctly. That shows the code can
learn. It doesn't show that it predicts real people. The tool for a real check is ready: export swipes and score the
model on a held-back part (see the service README).

## Diagram

```mermaid
flowchart TD
    SW[Swipe ♥ / ✕] --> DB[(Saved in the database:<br/>items, verdict, occasion, weather)]
    DB --> CNT["Count types and colours<br/>sum / (votes + 2)"]
    DB --> Q{8+ swipes,<br/>both likes<br/>and dislikes?}
    Q -- yes --> LR[Logistic regression<br/>on outfit features]
    Q -- no --> ONLY[counting only]
    CNT --> AVG[Average → ±10 points]
    LR --> AVG
    ONLY --> AVG
    AVG --> SCORE[The "taste" part<br/>of the outfit score]
    DB --> EX[Judged outfits<br/>are not shown again]
```

## Where this is in the code

- Saving swipes and counting types and colours (`tasteFrom`):
  [src/recommendations/recommendations.service.ts](../../fitcast/src/recommendations/recommendations.service.ts)
- Personal model: [recommendation-service/app/engine/learn.py](../../fitcast/recommendation-service/app/engine/learn.py)
- How taste goes into the score (`taste_points`, `evaluate`):
  [recommendation-service/app/engine/recommend.py](../../fitcast/recommendation-service/app/engine/recommend.py)
- The swipes table: the `OutfitFeedback` model in [prisma/schema.prisma](../../fitcast/prisma/schema.prisma)
- The feed: [frontend/app/looks/page.tsx](../../fitcast/frontend/app/looks/page.tsx)
- Checking the model: [scripts/evaluate_taste.py](../../fitcast/recommendation-service/scripts/evaluate_taste.py),
  the test `test_model_learns_a_hidden_taste_and_moves_the_ranking` in
  [tests/test_engine.py](../../fitcast/recommendation-service/tests/test_engine.py)
