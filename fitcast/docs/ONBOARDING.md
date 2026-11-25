# FitCast — team onboarding

What's in the project, where things live, how to run it, and how not to break the 3D part. Current as of 2026-11-23.

Everything is in a single `3dmodel` repository:
- the root is the 3D module (figures, FBX, photo transfer);
- the `fitcast/` folder is the product itself (website, API, Docker).

Unless stated otherwise, paths below are relative to `fitcast/`. The old `FitCast-architechtures` repository is no
longer developed; all work happens here.

## 1. Up and running in 5 minutes (Docker)

All you need is Docker Desktop. No Node or Python required.

```bash
git clone git@github.com:dabadeedabadae/3dmodel.git
cd 3dmodel/fitcast
docker compose up --build -d
```

The first build takes a few minutes. Then open:
- website: http://localhost:3001
- API: http://localhost:3002
- recommendation service: http://localhost:8010/health
- Postgres: `localhost:5433` (user, password and database are all `fitcast`)

Database migrations are applied automatically when the API starts.

**Demo accounts with a 7-item wardrobe:**

```bash
docker compose exec api node scripts/seed-demo.cjs
docker compose exec api cat .demo-accounts.local.json
```

The second command prints the logins and passwords: `demo@fitcast.test` and `admin@fitcast.test`, with random
passwords. The file lives only inside the container; don't commit it.

**If a port is taken**, create a `.env` file next to `docker-compose.yml` with the values you need:

```
WEB_PORT=3101
API_PORT=3102
DB_PORT=55433
REC_PORT=8110
```

The API URL is baked into the frontend at build time. After changing ports, rebuild:

```bash
docker compose up --build -d
```

**Handy commands:**
- `docker compose logs -f api` — API logs;
- `docker compose down` — stop;
- `docker compose down -v` — stop and wipe the database and uploaded photos.

After frontend changes, rebuild it:

```bash
docker compose up --build -d web
```

## 2. Running for development (frontend outside Docker)

Better for frontend work thanks to hot reload. The database and API stay in Docker.

```bash
docker compose up -d postgres api recommendation
cd frontend
npm ci
echo "NEXT_PUBLIC_API_URL=http://localhost:3002" > .env.local
npm run dev
```

The site opens at http://localhost:3001. There's a one-time step: in-browser photo analysis needs the onnxruntime
runtime in `frontend/public/ort`. From the `fitcast/` folder run:

```bash
npm ci
npm run ml:sync
```

API without Docker: `cp .env.example .env`, set `PORT=3002` and point `DATABASE_URL` at your database in `.env`, then
`npm run migrate:deploy && npm run build && node dist/main.js`.

## 3. Where things live

```
3dmodel/                      repository root = 3D module (see section 4)
├── imported-body/            figures: assets/*.fbx, out/*.json, scripts, docs (STATUS, DECISIONS, PIPELINE)
├── src/, scripts/, tests/    photo-to-garment transfer, recognition, checks (Vite + TS)
├── fixtures/photos/          test photos (CC0)
└── fitcast/                  ↓ website and API
fitcast/
├── docker-compose.yml        the whole system: postgres, api, web, recommendation
├── Dockerfile                API image
├── src/                      NestJS API
│   ├── auth/                 POST /auth/register, /auth/login (JWT)
│   ├── users/                GET/PATCH /users/me, PATCH /users/me/password
│   ├── wardrobe/             GET/POST /wardrobe, PATCH/DELETE /wardrobe/:id
│   │   └── garment3d.ts      strict validation of the client's "3D garment package" — do not loosen
│   ├── admin/                /admin/* for isAdmin only, recommendation bench
│   ├── events/               GET/POST /events, GET/PATCH/DELETE /events/:id (+ forecast per event)
│   ├── weather/              GET /weather[?city=] via Open-Meteo (no key, in-memory cache)
│   ├── recommendations/      POST /recommendations, PUT /recommendations/feedback, GET/POST/DELETE /outfits
│   └── prisma/               PrismaService
├── prisma/schema.prisma      User, UserEvent, WardrobeItem (garment3d JSON, textureUrl), SavedOutfit, OutfitItem,
│                             OutfitFeedback
├── prisma/migrations/        migrations; create new ones with `npx prisma migrate dev --name ...`
├── test/*.e2e.cjs            API e2e: `npm run test:wardrobe`, `test:admin`, `test:events`, `test:recommendations`, `test:feed`
├── scripts/
│   ├── seed-demo.cjs         demo accounts and items (photos in scripts/demo-photos, CC0)
│   ├── set-admin.cjs         grant or revoke admin rights: `npm run admin:set -- email [revoke]`
│   ├── sync-figure.cjs       ../imported-body/out → frontend/public/models (update the site's figures)
│   ├── sync-garments.cjs     sample garments from ../imported-body/out/photo
│   └── sync-ml.cjs           onnxruntime runtime → frontend/public/ort
├── recommendation-service/   FastAPI, Python 3.10+; rule-based outfit engine in app/engine, tests in tests/
└── frontend/                 Next.js 16 (App Router), React 19, three.js
    ├── app/
    │   ├── page.tsx, components/Landing.tsx    landing page
    │   ├── components/SiteHeader.tsx, AppShell.tsx   header and app shell
    │   ├── login/, register/                   sign-in and sign-up
    │   ├── profile/page.tsx, use-profile.ts    account area
    │   ├── profile/settings/                   name, city, bio, password change
    │   ├── profile/Wardrobe.tsx                wardrobe + photo upload + point editor
    │   ├── fitting/                            3D fitting room (FittingRoom.tsx, FigureViewer.tsx)
    │   ├── events/                             events, "What to wear today", outfit suggestions (Outfits.tsx)
    │   ├── admin/                              admin panel (+ Garments3D.tsx, RecommendationBench.tsx)
    │   └── globals.css                         all styles (single file)
    ├── lib/
    │   ├── api.ts            all API requests, token in localStorage, types
    │   ├── labels.ts         labels for types, colors, fit
    │   ├── garment/*         in-browser photo analysis: mask, points, color (analyze), garment type (category,
    │   │                     MobileNetV2), pattern / second color / tone (attributes)
    │   └── figure/*          3D: figure loading, slider deformation, photo transfer (photoMap.ts)
    └── public/
        ├── models/           PREBUILT 3D figures: figures.json + figure-01..25.json
        ├── shop/             product pictures per garment type for "Complete the look" (tinted on the page)
        ├── catalog/          garment catalog for the admin panel (`npm run catalog:sync` in the root)
        ├── ml/u2netp.onnx    mask model (Apache-2.0, license alongside)
        ├── garments/         sample garments from photos (CC0)
        └── ort/              onnxruntime runtime (not in git, `npm run ml:sync`)
```

## 4. The 3D part: how it works and what not to touch

- **Where the figures come from.** They're produced by the 3D module at the repository root (`imported-body/`): mesh
  import, segmentation into head, arms, top, bottom and shoes, plus intersection and slider checks. FitCast only holds
  the output (`frontend/public/models`). Never edit these JSON files by hand: rebuild them only in the
  3D module (`npm run ib:outfits` at the repository root), then run `npm run figure:sync` in `fitcast/`.
- **What's available.** `figures.json` lists the figures and the clothing type on each:
  - men (16): 01 T-shirt, 02 hoodie, 03 and 04 shirts, 05 V-neck sweater, 06 cardigan, 07 zip hoodie, 08 blazer,
    09 jacket, 10 coat, 14 sweatshirt, 15 long-sleeve tee, 17 polo, 19 turtleneck, 20 denim jacket, 24 bomber;
  - women (9, `sex: 'female'` in `figures.json`): 11 T-shirt (the base), 12 blazer, 13 cardigan, 16 V-neck
    sweater, 18 coat, 21 fitted T-shirt, 22 blouse, 23 crew sweater, 25 denim jacket;
  - every figure wears pants; the full list with labels is `imported-body/assets/outfits.json`.
- **Men / Women.** The fitting room has a Men / Women switch (shown when a women's figure exists). "Realistic
  proportions" (height and weight drive the whole body) use men's ANSUR II measurements only, so on the women's
  figure that option is disabled and the shape is set with the sliders directly.
- **Rule I-54.** An item only goes on a figure wearing the same clothing type. There are no figures for skirts,
  shorts or dresses, and the site says so.
- **Admin "3D garments".** `/admin` → "3D garments" (`app/admin/Garments3D.tsx`) shows every figure from
  `figures.json` and the garment catalog from `public/catalog` (rebuilt with `npm run catalog:sync` in the
  repository root).
- **Photo → 3D.** The full path from upload to garment on the body is described in `imported-body/docs/PIPELINE.md`
  (repository root). In short:
  1. U²-Netp builds the mask in the browser;
  2. points are found on the silhouette, and color and texture are computed;
  3. a "package" (`garment3d`) and the texture are sent to the server;
  4. in the fitting room, `photoMap.ts` maps the photo onto the figure's front faces.

  `lib/figure/photoMap.ts` is a verbatim copy of `imported-body/src/photoMap.ts` from the root. Don't edit it here,
  or it will drift from the module's checks.
- **The server doesn't trust the client.** `src/wardrobe/garment3d.ts` validates every field of the package and sets
  "needs review" itself. If you change the package format, change the client, the server and `test/wardrobe.e2e.cjs`
  together.
- **Working with the 3D models themselves (repository root).** Sources are in `imported-body/assets/*.fbx`,
  prepared meshes in `imported-body/out/*.json`, and the list of figures with their clothing types in
  `imported-body/assets/outfits.json`. The repository is private: the model license hasn't been verified, so don't
  publish them.

  The 3D module has its own `package.json` and `node_modules`. From the repository root:

  ```bash
  npm ci
  npm run ib:outfits
  ```

  `ib:outfits` rebuilds all figures from FBX and checks intersections and sliders (about 1–2 minutes; you need a
  `PASS`). Other commands:
  - `npm run ib:outfit-viewer` — view a figure in the browser;
  - `npm run ib:photo` — check photo transfer.

  To update the figures on the site, from the `fitcast/` folder:

  ```bash
  npm run figure:sync
  ```

  Then commit `frontend/public/models`. The 3D workflow and all decisions are in
  `imported-body/docs/STATUS.md`, `DECISIONS.md`, `PIPELINE.md` and `CLAUDE.md` at the root.
- **What 3D doesn't do:** it doesn't measure centimeters from a photo, doesn't reconstruct the back of a garment, and
  doesn't simulate fabric. Don't promise any of this in the UI.

## 5. Profile and sign-up frontend: where to start

- **Sign-up and sign-in:** `app/register/page.tsx`, `app/login/page.tsx` → `lib/api.ts`. On the API side:
  `src/auth/*`, with validated DTOs in `src/auth/dto`.
  - Only email + password for now.
  - No email verification, password reset or social login.
  - The JWT is stored in `localStorage`. Sessions are invalidated via `sessionVersion` when the password changes.
- **Profile:** `app/profile/page.tsx` (wardrobe, saved outfits) and `app/profile/settings/page.tsx` (name,
  city, bio, password). API: `GET/PATCH /users/me`, `PATCH /users/me/password`.
  - Profile fields: `name` up to 80 characters, `city` up to 100, `bio` up to 300 (see `prisma/schema.prisma`).
  - To add a new field:
    1. a Prisma migration;
    2. the DTO in `src/users/dto`;
    3. the `UserProfile` type in `lib/api.ts`;
    4. the form.
- **Styles:** a single `app/globals.css`, with page-prefixed classes (`wardrobe-*`, `fit-*`, `profile-*`). The mobile
  layout is in the same file, in media queries.
- **Next 16.** This is not the Next.js from older tutorials (see `frontend/AGENTS.md`). The docs for this version are
  in `frontend/node_modules/next/dist/docs/`.

## 6. Events, weather and outfit recommendations

- **Events and weather.** `/events` (`app/events/page.tsx`): the user creates events with an occasion, a start time
  and an optional city (empty = profile city). The API (`src/events`, `src/weather`) attaches the
  [Open-Meteo](https://open-meteo.com) forecast for the event's hour and city (no API key; up to 16 days ahead,
  otherwise a reason such as `TOO_FAR` or `NO_CITY`).
- **"What to wear today".** Pick an occasion and get outfits for the current weather in the profile city.
- **Outfit suggestions.** `src/recommendations` sends the user's wardrobe (type, color, fit, id only) plus weather and
  occasion to `recommendation-service`. Its rule-based engine (`app/engine/catalog.py`, `recommend.py`, `factors.py`; `learn.py` trains a small per-user taste model on the swipes)
  combines items with hard rules per occasion and weather and returns 3–5 outfits with a short reason. The user can
  like / dislike an outfit (`PUT /recommendations/feedback`; disliked outfits are hidden for that event) and save it
  (`/outfits`, shown on `/events` as saved outfits).
- **"Try on in 3D".** Each suggested or saved outfit links to `/fitting?top=&bottom=` with its items.
- **Running the service.** It needs Python 3.10+ (the code uses `X | None` type syntax). Locally the easiest way is
  Docker: `docker compose up -d recommendation` (port 8010). Its tests: `cd recommendation-service && python -m pytest`.

## 7. Checks before pushing

```bash
npm run test:wardrobe
npm run test:admin
npm run test:events            # events + weather against a local Open-Meteo mock, no internet needed
npm run test:recommendations   # needs recommendation-service running (e.g. the docker container on :8010)
npm run test:feed              # the swipe feed, taste and the men filter; same requirement
# all e2e inside the API container (its native modules are built for Linux):
#   docker compose cp test api:/app/test && docker compose exec api sh -c 'touch .env && node --test test/*.e2e.cjs'
cd frontend
npx tsc --noEmit
npx next build
```

The `test:*` commands need a database: `docker compose up -d postgres` and a `.env` with `DATABASE_URL`.

`npm run lint` doesn't work in the frontend: Next 16 has no `next lint` command. If you need a linter, set it up
separately (ESLint 9, flat config).

## 8. Known debt

- Recommendations are rules only: garment formality and warmth come from the item type (`catalog.py`); per-item
  style, season or warmth aren't stored yet. The recommendation service has no authentication of its own.
- The swipe feed (`/looks`, I-77) learns taste per garment type and colour only; "complete the look" suggests a
  type + colour with a catalogue picture, not a real product — there is no shop integration. The shopping list
  lives in the browser (localStorage). "Men / Women" is a feed filter, not a profile field (the profile is the
  teammates' zone).
- Photo analysis runs on the main thread, freezing the UI for about 2 s. A candidate for a Web Worker.
- No manual point editing for pants (tops have it).
- Photos are stored on the API's disk (`uploads/`, the `uploads` volume in Docker), not in the cloud.
- The wardrobe palette has 13 colors (the recommendation contract palette); the exact garment color is stored only in the 3D package.
- The root `README.md` is partly outdated (Windows instructions, MVP plan). This file is more up to date.
