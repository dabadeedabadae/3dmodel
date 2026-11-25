# FitCast Recommendation Service — phases 1–2

Status (2026-11-23): the rule-based engine v1 is implemented in `app/engine/` (`catalog.py` holds the tables of
garment formality/warmth, occasions and colours; `recommend.py` the generation, hard rules, scoring and ranking;
tests in `tests/test_engine.py`). `/recommendations` answers 200 instead of 501. The contract gained the event types
DATE, WEDDING_GUEST, INTERVIEW, PARTY, THEATER, TRAVEL, STUDY, FAMILY_WALK and the garment types CARDIGAN, BLAZER.
The sections below are the original phase 1–2 proposal, kept for history.

## Responsibilities

NestJS authenticates users, reads only their wardrobe from PostgreSQL, obtains weather,
and calls Python over internal HTTP. Python receives item metadata and conditions;
it does not connect to the database or receive passwords, photos, or JWT tokens.
NestJS must explicitly map database records to the contract below: sending complete
Prisma records fails validation because unknown fields are rejected.
The Python service has no authentication yet and should run locally during development.
Service access control must be decided before deployment.

## Request: POST /recommendations

```json
{
  "wardrobe": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "type": "TSHIRT",
      "dominantColor": "white",
      "fitTag": "GOOD"
    }
  ],
  "weather": {"temperatureC": 18, "precipitation": "NONE"},
  "eventType": "CASUAL",
  "limit": 5
}
```

- `id`: UUID, matching Prisma's generated string IDs; unique within the request.
- `type`: TSHIRT, SHIRT, JACKET, COAT, SWEATER, HOODIE, CARDIGAN, BLAZER, PANTS, JEANS,
  SHORTS, SKIRT, DRESS, SHOES, ACCESSORY.
- `pattern` (optional, I-77): solid | pattern; `secondaryColor` (optional): a palette color; `sleeve` (optional):
  short | long — read from the photo on the device.
- `fitTag`: GOOD, TIGHT, LOOSE. All three are valid input; filtering is a later engine responsibility.
- `dominantColor`: black, white, gray, beige, brown, red, orange, yellow,
  green, blue, navy, purple, pink. Whitespace and case are normalized;
  grey is accepted as gray. HEX/RGB are not accepted in this MVP contract.
- `eventType`: CASUAL, GYM, BUSINESS, FORMAL, OUTDOOR, DATE, WEDDING_GUEST, INTERVIEW, PARTY, THEATER, TRAVEL,
  STUDY, FAMILY_WALK.
- `temperatureC`: finite JSON number from -90 to 60 Celsius. This is an input
  validity bound, not a claim that recommendations are suitable across this range.
- `precipitation`: NONE, RAIN, SNOW, MIXED. Required; missing weather is not silently treated as dry.
- `limit`: integer 1–10, default 5 (10 is used by the swipe feed).
- `taste` (optional, I-77): `{types: {GarmentType: w}, colors: {color: w}}`, w in −1…+1, learned by the API from likes
  and dislikes; shifts each outfit by up to ±10 points and is reported in `breakdown.taste`.
- `exclude` (optional): outfits already judged, each a list of item ids — never returned again.
- `suggest` (optional, default false): add `suggestion` to each outfit — the one not-owned item (type + colour)
  that raises its score most (at least 3 points), or shoes when the outfit has none; disliked types/colours and
  `avoidTypes` are never suggested.
- `avoidTypes` (optional): garment types the user does not wear (the API sends SKIRT, DRESS for a men's feed).
- `wardrobe`: required list, empty allowed, maximum 200 items. This provisional
  bound limits input size; generation will need its own computation budget.
- Unknown fields and enum values are rejected with HTTP 422.

## Proposed response for the completed engine

Illustrative shape only; the item IDs and scores below are synthetic, not calculated.

```json
{
  "status": "OK",
  "outfits": [
    {
      "items": [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003"
      ],
      "score": 87,
      "breakdown": {"weather": 90, "occasion": 85, "color": 85, "fit": null},
      "explanation": "Suitable for the selected conditions; neutral color combination."
    }
  ],
  "warnings": []
}
```

Scores range from 0 to 100. `fit` is optional pending a scoring decision.
Item IDs must come from the request and must not repeat inside an outfit.
The future engine must enforce outfit completeness, uniqueness across outfits,
and the requested limit; schemas alone cannot enforce these contextual rules.

For no valid combinations the future engine returns HTTP 200 with:

```json
{
  "status": "NO_VALID_OUTFITS",
  "outfits": [],
  "warnings": ["No complete outfit can be built from the available items."]
}
```

It returns fewer than `limit` when fewer valid combinations exist. It must never
invent clothes or relax hard weather constraints just to produce five results.
`OK` requires at least one outfit; `NO_VALID_OUTFITS` requires an empty list.

## Decisions proposed in phase 1

1. Match Prisma field names and enums without changing the database.
2. Start with the named color palette above; agree it with the detection developer.
   Prisma currently stores an unrestricted string, so existing colors may need mapping.
3. For MVP, filter to GOOD fit before generation, following the repository README.
   TIGHT and LOOSE are input data, not validation errors.
4. If only GOOD survives, fit scores are constant. Do not finalize the preliminary
   four-factor weights until this is resolved. Optional fit breakdown avoids implying
   an approved weighting formula.
5. Start with top + bottom + shoes, or dress + shoes; weather may require outerwear.
   Missing mandatory slots produce no complete outfit, rather than a partial outfit.
6. Initially infer coarse suitability from category. SHOES and JACKET do not convey
   warmth, waterproofing, or formality: precise weather/event handling will require
   richer metadata. No season/style fields are invented in the current database.

## Confirm with the team before integration

- Color output of the detection service and conversion to the named palette.
- GOOD-only filtering versus allowing some LOOSE items, and scoring weights.
- Whether to add occasion tags, warmth and rain suitability to wardrobe metadata.
- Weather provider mapping, including missing/stale data and mixed precipitation.
- Input size limit, internal access control and NestJS timeout/failure behavior.

These are recorded decisions to discuss; phases 1–2 do not claim team agreement.

## Local setup

Run from `recommendation-service/` with Python 3.10 or newer (the Docker image uses 3.12):

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

- GET /health: HTTP 200, `{"status":"ok"}`; reports scaffold availability only.
- GET /docs: interactive contract documentation.
- POST /recommendations: validates input and returns the ranked outfits (rules v1, `app/engine/recommend.py`).
- I-79, all optional: `weather.windKph`, `hour` (local hour 0–23), `history` (every swipe: `{items, liked}` — the
  taste model `app/engine/learn.py` is trained on it from 8 swipes with both verdicts), `recentItems` (items of
  outfits saved this week). Each outfit's `breakdown` gains `style` (±12 points) and `factors` (`key`, `points`,
  `note`: harmony, coherence, contrast, evening, freshness, wind — `app/engine/factors.py`); the response gains
  `tasteModel` (`examples`, `likes`, `prefers`, `avoids`) once a model was trained.
- Invalid input: HTTP 422 with Pydantic validation details.

Dependencies have bounded compatible ranges; a reproducible lock remains a deployment task.

## Next phase

Implement and test color matching independently in `app/engine/`, including
explicit palette RGB values, neutral handling, hue distances and outfit aggregation.
Generation, eligibility rules, scoring and ranking are done (phases 1–2); taste, exclusions and purchase
suggestions were added in I-77.
