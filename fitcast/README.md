# FitCast

**Quick start:** `docker compose up --build -d` → http://localhost:3001. Everything about the project (architecture,
where files live, the 3D part, checks) is in [docs/ONBOARDING.md](docs/ONBOARDING.md).

## Client: running on macOS

Landing page, sign-in and sign-up, an account area with the wardrobe, a mobile web layout, and an admin panel with a recommendation test bench.

```bash
docker start fitcast-preview-postgres        # or: npm run db:up (port taken from DATABASE_URL in .env)
npm run migrate:deploy && npm run generate
npm run build && node dist/main.js           # API on PORT from .env (3002 locally)
cd frontend && npm run dev                   # http://localhost:3001, NEXT_PUBLIC_API_URL in frontend/.env.local
```

- **3D model (`/fitting`):** a dressed figure from the 3dmodel module with body and height sliders; the top and bottom are tinted with the colors of wardrobe items. A Men / Women switch picks the figure set; "Realistic proportions" (height and weight drive the whole body) are built from men's ANSUR II measurements only, so the women's figure is shaped with the sliders directly. Figures are listed in `frontend/public/models/figures.json` (`sex: 'female'` marks women's figures), live in `frontend/public/models` (in git) and are rebuilt with `npm run ib:outfits` in the repository root (after `npm ci` there), then copied with `npm run figure:sync` in `fitcast/`. The old `/model` placeholder is in `archive/` (also not in git), and the URL redirects to `/fitting`.
- **What the photo says (I-77):** besides the type and the main colour, the wardrobe form reads the pattern (one colour / pattern or print), the second colour, the sleeve length and the tone on the device; they are stored with the item (`attributes`) and the recommendations use them (two patterns compete, a short sleeve in the cold, a print for a formal occasion).
- **Your photo → 3D T-shirt:** when you add a T-shirt in your profile, the photo is analyzed right in the browser (mask, points, color, background-free texture; the photo is not sent anywhere for this) and saved with the item. In `/fitting`, such a T-shirt (labeled "3D") goes on the model with its print. One-time setup: `npm run ml:sync` (copies the U²-Netp model and the onnxruntime-web runtime, neither is committed). Samples from an open dataset: `npm run garments:sync`.
- **Demo data:** `npm run seed:demo` creates `demo@fitcast.test` (7 items from CC0 photos in `scripts/demo-photos`) and `admin@fitcast.test`. Passwords are written to `.demo-accounts.local.json` (not committed).
- **Wardrobe:** `GET/POST /wardrobe`, `PATCH/DELETE /wardrobe/:id`, own items only. Photos are JPEG/PNG/WebP up to 8 MB; the type is checked by content, the file name is random, and files are stored locally in `uploads/` (not committed). Colors come from the recommendation contract palette (13 colors); the color hint from the photo is the median of the image center, and the user confirms it.
- **Recommendation test in the admin panel:** `POST /admin/recommendations/test` builds a request following the `recommendation-service` contract (item type, color, fit and id only) and, if `RECOMMENDATION_SERVICE_URL` is set, sends it to the service and shows the response (the outfits from the rule engine below).
  Run the service: easiest with `docker compose up -d recommendation`; without Docker it needs Python 3.10+ (the code uses `X | None` type syntax): `cd recommendation-service && .venv/bin/python -m uvicorn app.main:app --port 8010`.
- **Weather and events (`/events`):** `GET /weather[?city=]` returns the current weather and a 16-day forecast for the profile city (or another city) from [Open-Meteo](https://open-meteo.com): no API key, data CC BY 4.0, only the city name and its coordinates leave the server, responses are cached in memory (geocoding 24 h, forecast 30 min). `GET/POST /events`, `GET/PATCH/DELETE /events/:id` (own events only, `?scope=upcoming|past`): an event has a name, an occasion (`EventType`, 13 occasions: casual, gym, business meeting, formal event, outdoors, date, wedding guest, job interview, party, theater or restaurant, travel, study, walk with kids), a start time, an optional city (empty = profile city) and a note. Each upcoming event comes with the forecast for its hour and city, or the reason there is none (`TOO_FAR` beyond 16 days, `NO_CITY`, `CITY_NOT_FOUND`, `UNAVAILABLE`). `weather.recommendationInput` is the `weather` + `eventType` part of the recommendation-service request; `POST /recommendations` joins it with the user's wardrobe. Provider URLs can be overridden with `OPEN_METEO_GEOCODING_URL` / `OPEN_METEO_FORECAST_URL`.
- **Outfit recommendations (rules v1 + a trained taste model):** style factors (color-wheel harmony, formality coherence, light / dark contrast, a dark outfit for an evening out, freshness, wind) and a per-user logistic regression trained on the swipes (I-79, `app/engine/factors.py`, `learn.py`). `recommendation-service/app/engine` builds top + bottom (or dress) + shoes + up to two layers from GOOD-fit items, with hard rules per occasion (13 event types, e.g. no hoodie or shorts for an interview, no white for a wedding guest) and weather (warm layer below +5 °C, no sweater/coat in heat, no light shoes in rain), then scores occasion / weather / color and returns 3–5 varied outfits with a short reason. Garment formality and warmth come from the type only (`catalog.py`); per-item style/season/warmth are not stored yet. API: `POST /recommendations` (`{eventId}` uses the event's forecast, `{eventType}` the current weather in the profile city), `PUT /recommendations/feedback` (fits / doesn't fit, stored with the conditions; disliked outfits are hidden for that event), `GET/POST/DELETE /outfits` (saved outfits, linked to an event). UI: "Suggest outfits" on events, "What to wear today", saved outfits, "Try on in 3D" opens `/fitting?top=&bottom=`.
- **Looks (`/looks`, swipe feed):** outfits from your own wardrobe for an occasion and today's weather, shown on the 3D mannequin (its colours and the photo prints of the items; the event suggestions use the same figure), one card at a time, on a phone or a computer. Swipe right (or ♥, or →) if you like it, left if not: each swipe adds ±1 to the garment types and colours of the outfit, and the next outfits are ranked with that taste (up to ±10 points). Swiped outfits are not shown again. Under each card, "Complete the look" proposes one item you don't own (type + colour, with a tinted catalogue picture) that would raise the outfit's score, and it can go to a shopping list kept in the browser. A Men / Women / All switch leaves out skirts and dresses for men. API: `POST /recommendations` with `feed: true` (and `wear`).
- **Checks:** `npm run test:wardrobe` (ownership, validation, files, recommendation bench), `npm run test:admin`, `npm run test:events` (events + weather against a local Open-Meteo mock, no internet needed), `npm run test:recommendations` and `npm run test:feed` (need the recommendation-service running, e.g. the docker container on :8010), recommendation-service `python -m pytest`, `cd frontend && npx next build`.

## Administration

A simple `/admin` panel: an overview (counts of users, items and outfits, recent sign-ups), the latest 100 users, wardrobe items and saved outfits, the recommendation test bench, and a "3D garments" section that shows every prepared 3D figure (drag to rotate, slider ranges) and the garment catalog (`frontend/public/catalog`, updated with `npm run catalog:sync` in the repository root). The panel is read-only. API access is checked on the server; passwords and their hashes are never returned.

After updating the project, run in the root:

```powershell
npm run migrate:deploy
npm run generate
```

Stop the backend (`Ctrl+C`) before `generate` so Windows doesn't lock the Prisma DLL. Then register your account via `/register` and grant it admin rights:

```powershell
npm run admin:set -- your-email@example.com
```

Start the backend again (`npm run start:dev`) and the frontend from the `frontend` folder (`npm run dev`). Sign in with your account's normal password and open `http://localhost:3001/admin`. A link to the panel also appears on the account page. There is no shared admin password, and sign-up can't grant admin rights.

Revoke rights: `npm run admin:set -- your-email@example.com revoke`. Changes take effect on the next request, without reissuing the JWT.

Access-control check: `npm run test:admin` (requires a local database with migrations applied and free port 3102; the temporary test account is deleted afterwards).

## Overview

FitCast is a web app that builds a digital wardrobe from photos of the user's real clothes and suggests outfits based on weather, occasion, fit and color coordination.

Users photograph individual items; FitCast detects the clothing type and color with computer vision and places the items on an abstract preset body model (not a digital twin of the user). Outfit recommendations are filtered by weather, occasion type, fit and color coordination.

## User flow

1. The user photographs several items from their wardrobe (one at a time)
2. The system automatically detects the **clothing type** (T-shirt / jacket / pants, etc.) and the **dominant color** from the photo
3. The user manually adds a **fit tag** to each item (fits well / too tight / too loose)
4. The item is added to the digital wardrobe and shown on an **abstract preset body model** (not a copy of the user's body, but a predefined model)
5. The user gets an **outfit suggestion** filtered by several parameters at once

## Core features (MVP)

| Feature | Description |
|---|---|
| **Garment & Color Detection** | Detects the clothing type and dominant color from an uploaded photo (computer vision) |
| **Body Preset Model** | A visual model that wears the clothes, instead of a flat list of photos |
| **Fit Tagging** | A manual fit tag for each item that affects recommendations |
| **Weather Integration** | Connects to a weather API so outfits match the current weather |
| **Event-Type Filter** | The user picks a context (gym / business meeting / casual) that narrows the selection |
| **Color-Coordination Check** | Warns about clashing colors when building an outfit |
| **Outfit Builder** | The core logic: combines items by weather + occasion + fit tag + color, excluding items that don't fit |

## Stretch features (post-MVP)

- **Personality/style quiz** that influences recommendations — postponed; the niche is already crowded with similar quizzes from competitors, and it isn't part of the product's core differentiation

## Tech stack

- **Backend:** NestJS
- **Database:** PostgreSQL (Redis was planned but isn't used yet)
- **Frontend:** Next.js (React)
- **Garment/Color Detection:** MobileNetV2 (ONNX, Apache-2.0) runs in the browser and maps ImageNet clothing classes to the site's garment types — a suggestion the user confirms (21 of 26 project photos right at once); the color, pattern, second color and tone come from the photo's pixels (U²-Netp mask, Lab clustering)

## Key difference from competitors

Competitors either show the wardrobe as a flat list with no visual model (Cladwell, Stylebook) or build a "digital twin" of the user's body from photos (Fitted, partly Whering). FitCast photographs the **clothes**, not the user's body, and places them on a neutral preset model, so the recognition pipeline only deals with garments, never with recognizing a person.

## User profile

After signing in, a regular user lands on /profile and an admin on /admin. The home page keeps redirecting to the matching area. The profile lets users change their name (up to 80 characters), city (up to 100) and bio (up to 300); the email is read-only. Empty values clear the fields. Item and outfit counters come from the user's own data.

Apply the new migration: npm run migrate:deploy. Stop the backend before npm run generate, then start it again. API: GET /users/me and PATCH /users/me; only the owner of a valid JWT can make changes. Checks for saving, limits and data isolation are part of npm run test:admin.

Account settings: /profile/settings. Personal details and bio are edited separately from the profile card. PATCH /users/me/password accepts currentPassword and newPassword (at least 8 characters, up to 72 bytes of UTF-8). Changing the password requires confirming the current one, updates the bcrypt hash and ends all old JWT sessions. Apply the password_sessions migration and restart the backend after prisma generate. Password-change tests are part of npm run test:admin.
