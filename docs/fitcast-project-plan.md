# FitCast Product Architecture and Development Plan

A plan for a team of four. Proposed approach as of 16 October 2026: one responsive web product with a mobile interface, an admin panel, and two small Python services. The main user journey is to add real clothing items, confirm detection results, receive a suitable outfit, and save it. The responsibilities and new fields below require team agreement and have not been implemented in the application.

## Repository Status

NestJS contains registration, login, and a user profile endpoint. Prisma defines User, WardrobeItem, SavedOutfit, and OutfitItem, but wardrobe and outfit CRUD endpoints are absent from the reviewed code. The frontend contains authentication pages. Docker Compose starts only PostgreSQL. The Recommendation Service contains a contract, validation, and a FastAPI scaffold; recommendation requests currently return 501. Redis, detection, weather integration, 3D, and the admin panel are not implemented in the reviewed code.

## Product and MVP Scope

FitCast helps people use clothing they already own. On the home screen, the user sees the weather, selects an occasion, and receives up to five outfits with explanations. Scores represent the system's rules, rather than the probability that a user will like an outfit.

| Included in the MVP | After the core user journey is stable |
|---|---|
| Registration, login, logout, and profile | Separate iOS and Android applications |
| One item per photo, category and color detection | Training a large custom model |
| Confirmation and manual item entry | An LLM stylist and neural personalization |
| Wardrobe, item editing, and deletion | Travel Packing and Outfit Sharing from the proposal |
| Matching by weather, occasion, fit, and color | Social feed, shopping, and a store |
| Up to five outfits, explanations, and saving | Realistic virtual try-on |
| A preset body model with basic garment shapes | Transferring arbitrary photo patterns onto 3D garments |
| Wear history and basic statistics | An advanced analytics platform |
| A minimal admin panel and daily reminder | Advanced notifications and campaigns |

The mobile product is a responsive Next.js application. PWA installation can be added after checking support on the team's devices. A separate mobile codebase would currently increase the workload without improving the core journey.

## User Journeys

### First Launch

Registration → manual city selection → a short privacy explanation → adding the first item. Geolocation is optional. The application suggests adding a top, bottoms, and footwear, while also supporting a dress with footwear. Wardrobe readiness depends on the availability of suitable outfit roles, rather than the number of photos.

### Adding an Item

The user photographs one item against a simple background or selects a file. NestJS stores the image privately and creates a processing job. The frontend shows Uploading, Detecting, and Review Result. The user confirms the category, color, fit, and additional suitability information. Only confirmed items participate in recommendations.

If processing fails, the photo and draft remain available for retry or manual entry. Low detection confidence prompts confirmation instead of removing the item. Multiple garments in one photo prompt the user to photograph a single item again; splitting a complete outfit into individual items is outside the first version.

### Getting an Outfit

The home screen shows the city, temperature, precipitation, and last update time. The user selects CASUAL, GYM, BUSINESS, FORMAL, or OUTDOOR. NestJS reads only that user's confirmed items, sends normalized weather data to Python, and returns recommendations. The user can open the explanation, preview the outfit on the model, save it, and mark it as Worn Today.

When information or clothing is missing, the application explains the specific reason: Add Footwear, No Suitable Outerwear, or No Complete Outfit for This Occasion. An insufficient wardrobe and an unavailable Python service are different states. Five results are a maximum, not a required count.

### Manual Outfit Builder

The user selects items by outfit role. The system reports incomplete outfits and questionable color combinations. The user can override a color warning, as described in the proposal. Manually saving an outfit does not establish that it passed automatic weather constraints. Replacing an item requires recalculating its evaluation.

## Mobile Interface

The design direction is a calm digital wardrobe: warm neutral surfaces, a green accent, large item images, and short explanations. Garment colors retain their actual hues regardless of the interface theme. The interactive concept uses illustrative garment shapes and demo data.

| Screen | Main content | Primary action |
|---|---|---|
| Today | Weather, occasion, recommended outfit, alternatives | Find an Outfit |
| Wardrobe | Item grid, categories, and fit | Add Item |
| Add Item | Photo, detection result, and confirmation form | Save Item |
| Item Details | Photo, attributes, and availability | Edit |
| Outfit Details | Items, overall score, explanation, and 2D or 3D preview | Save / Worn Today |
| Saved | Personal outfits | Open Outfit |
| Profile | City, reminders, history, and logout | Edit Settings |

Bottom navigation: Today, Wardrobe, Saved, and Profile. A prominent Add Item button is available in the wardrobe and empty states. Separate camera and analytics tabs would overload the navigation.

Design loading, empty, error, and success states for each screen. Controls support keyboard use, touch targets are approximately 44 px, and messages do not rely only on color. On narrow screens, explanations expand on tap. Load 3D on request while making the ordinary item list available immediately.

## Admin Panel

The admin panel supports product operations and displays aggregate statistics. NestJS checks the ADMIN role; hiding a frontend link is insufficient. Users cannot assign themselves this role during registration.

Create the first administrator through a controlled server seed or a separate operational command. Registration and profile forms do not accept a role field. Record role changes and support ticket status changes with the administrator's ID and the action time.

| Section | Content | MVP actions |
|---|---|---|
| Overview | Active users, confirmed items, recommendation requests, and processing failures | Select a 7 or 30 day period |
| Model Catalog | Category, preset, 3D asset version, and preview availability | View category mappings |
| Support Tickets | Problem category, status, and a pseudonymous identifier | Open, assign, and resolve |
| Services | Latest checks for API, CV, Recommendation, and weather | Inspect errors and check times |

The first version does not need a browser of every user's private photographs. Users may separately attach material to a support ticket. Service status distinguishes process availability from algorithm readiness: the current /health endpoint does not establish that the Recommendation Service can produce outfits.

User statistics are based on Worn Today. Saving an outfit does not count as wearing it. DAU means unique authenticated users performing a defined action during a day. The detection failure rate is failed jobs / completed jobs, excluding pending jobs. Define metrics before implementation.

## Architecture

```text
Next.js
├── mobile and desktop user interface
└── /admin with separate navigation
          │ HTTPS
          ▼
NestJS — owns user data and authorization
├── PostgreSQL / Prisma
├── private file storage
├── Weather Adapter → weather provider
├── HTTP → Recommendation Service / FastAPI
└── HTTP → Vision Service / FastAPI
```

NestJS remains a modular application. Modules: Auth, Users, Wardrobe, Uploads, Detection, Weather, Recommendations, Outfits, WearHistory, Statistics, Support, and Admin. Python services are separated by purpose so running recommendation rules does not require heavy CV dependencies.

Photos reside in private file storage; PostgreSQL stores object keys and metadata. A local directory outside the public folder is sufficient for development. A deployed version can use S3-compatible storage. Image access follows an ownership check; possession of a URL is not the authorization mechanism.

Initially, detection jobs can reside in a table and run through one worker with bounded concurrency. Jobs survive restarts, and unfinished leases return to the queue. Add Redis for weather caching and queuing when concurrent processing justifies it. Redis must not contain the only copy of user data. Avoid introducing two queue systems simultaneously.

Service calls have timeouts, a requestId, and explicit statuses. Repeating recommendation generation is acceptable; repeated item creation and wear logging require an idempotency key. Python neither accepts the user's public JWT nor reads PostgreSQL. Before deployment, restrict Python access through an internal network and service authorization.

The current frontend stores its token in localStorage. For deployment, the proposal is a shared origin for frontend and API, with a session in an HttpOnly cookie using Secure and an appropriate SameSite policy. Check Origin and CSRF protection for state-changing requests. HttpOnly prevents JavaScript from reading the cookie but does not replace XSS protection: [MDN Set Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie). Rate-limit login, uploads, and recommendations; exclude secrets and photographs from logs.

Validate the actual image contents rather than only the extension. The proposed upload limit is 10 MB, with a decoded pixel count limit. Remove EXIF before storing the derived image. A failed database write cleans up its temporary file; periodic cleanup removes abandoned, unconfirmed objects according to a defined retention period. Apply CV results only to the current draft version: repeated or late responses must not overwrite a user's manual corrections.

## Data

Preserve the existing enums and UUIDs. The following extensions are proposed migrations; these fields are not currently present in Prisma.

| Entity | Proposed addition | Purpose |
|---|---|---|
| User | role, cityId, timezone, reminderEnabled, reminderLocalTime | Admin access, weather, and local time |
| WardrobeItem | name, imageKey, status, available, deletedAt | Drafts, private photos, and history |
| WardrobeItem | subtype, occasionTags[], thermalTags[], rainSuitable | Distinguish boots from sneakers and winter jackets from light jackets |
| WardrobeItem | colorHex?, detectionConfidence?, confirmedAt | Numeric color and user confirmation |
| DetectionJob | itemId, status, attempts, errorCode, leaseUntil, timestamps | Reliable processing and retries |
| WearLog | userId, outfitId?, wornAt, idempotencyKey | Actual usage history |
| WearLogItem | wearLogId, itemId, snapshot | Preserve history after editing an item |
| SupportTicket | userId, category, message, status, timestamps | User support |

For each city, store a stable identifier, name, center coordinates, and IANA timezone, potentially in a small City table. Recommendations do not require precise user coordinates. Also record recommendation request times and statuses for aggregate metrics; do not copy photographs or complete wardrobes into request logs.

The first algorithm requires the existing item fields. Add refinements gradually. UNKNOWN in new weather attributes means missing knowledge, rather than suitable. Category defaults retain their source as category_default so guesses are distinguishable from manual confirmation. Add support for new attributes to Python and NestJS together: the current contract rejects unknown fields.

Season can be displayed, but temperature and precipitation are more informative than the calendar season. FitTag describes fit on the individual user; GOOD does not specify a garment's cut.

Deleting an item immediately excludes it from recommendations. A saved outfit containing an unavailable item displays a warning. History uses a snapshot of the name and category; deleting an account removes photographs and personal history. Review the current Prisma cascade behavior when adding wear history.

## API and Integration Contracts

These are target endpoints. Only authentication and users/me are implemented; the internal /recommendations endpoint remains a scaffold.

| Layer | Endpoint | Purpose |
|---|---|---|
| NestJS | POST /auth/register, POST /auth/login | Existing authentication |
| NestJS | GET /users/me, PATCH /users/me | Profile and settings |
| NestJS | GET /wardrobe, POST /wardrobe | List and manual item entry |
| NestJS | GET, PATCH, DELETE /wardrobe/:id | A single owned item |
| NestJS | POST /wardrobe/upload | Photo, draft, and detection job |
| NestJS | GET /detection-jobs/:id | Status of an owned job |
| NestJS | POST /wardrobe/:id/confirm | Detection confirmation |
| NestJS | GET /weather?cityId=... | Normalized weather |
| NestJS | POST /recommendations | Occasion and limit; the server supplies the wardrobe |
| NestJS | GET, POST /outfits; PATCH, DELETE /outfits/:id | Personal saved outfits |
| NestJS | POST /outfit-evaluations | Evaluate a manually assembled outfit |
| NestJS | POST /wear-logs; GET /statistics/me | Wear logging and personal statistics |
| NestJS | POST /support-tickets | Submit a support ticket |
| NestJS | GET /admin/overview, /admin/services, /admin/model-mappings | Administrative data |
| NestJS | GET /admin/support-tickets; PATCH /admin/support-tickets/:id | Support ticket handling |
| Python Recommendation | POST /recommendations | Wardrobe and conditions → up to five outfits |
| Python Recommendation | POST /evaluations | One outfit → scores and warnings |
| Python Vision | POST /detect | Internal image stream → category, color, and confidence |

Public recommendation requests do not accept a userId or another user's complete wardrobe. NestJS verifies ownership of every outfit item ID. Updates and deletions also check ownership. Lists use pagination. 401 indicates no session, 403 a missing role, 422 invalid input, and 503 an unavailable dependent service. A valid request with no suitable outfits returns 200 with NO_VALID_OUTFITS. The current internal 501 response will be removed once the algorithm is implemented.

Store contracts as OpenAPI and a small shared set of JSON examples. Changes to enums, temperature units, or required fields require joint review by both sides. The frontend starts with these examples while the backend is implemented.

## Garment Detection

Use a pretrained model with a suitable license and a verified set of classes. Select a specific model after a small comparative experiment; the name ResNet alone does not establish that its weights recognize clothing. Explicitly map model classes to GarmentType. Unknown classes require manual selection.

Pipeline: validate image → resize → isolate garment region → classify → extract dominant color only from that region → map to the palette → user confirmation. If no mask is available, offer cropping; the background color must not automatically become the T-shirt color. For multicolored garments, the MVP stores the dominant color and explains this limitation to the user.

Evaluate using permitted photographs with different lighting, backgrounds, colors, and categories. Measure category and color quality separately. Choose the low-confidence threshold using validation examples; do not treat it as a guaranteed probability. Do not automatically include personal photographs in training or demonstration datasets.

## Recommendation Algorithm

### Filtering and Generation

Exclude deleted, unconfirmed, unavailable, and TIGHT/LOOSE items. Initially allow GOOD, following the README and proposal. A complete outfit consists of a top + bottoms + footwear, or a dress + footwear. Additional layers depend on weather. HOODIE and SWEATER have explicit roles and cannot be combined arbitrarily.

Apply weather constraints to complete outfits rather than individual T-shirts: a T-shirt underneath a warm layer may be acceptable. Cold conditions require confirmed warm layers and suitable footwear. Insufficient metadata must not produce promises of cold or rain protection. Temperature thresholds remain MVP rules, rather than medical safety assessments.

Occasion handling follows a category eligibility table and occasionTags. For GYM, do not substitute business clothing merely because its colors match. The application may suggest another occasion, but must not change it silently.

To limit combinatorial growth, first rank items within roles, then use bounded search over partial outfits. Proposed budget: up to 200 items, up to 20 candidates per role, beam width 100, and up to 2,000 completed outfits. Verify these values with a load test dataset. When search is truncated, results are the best outfits found, rather than a proven global TOP-5.

### Scoring and Diversity

Each component ranges from 0 to 100. With GOOD-only filtering, fit scores are constant, so the proposed MVP formula is:

`Score = (0.35 × Weather + 0.25 × Occasion + 0.25 × Color) / 0.85`

This preserves the relative original weights and removes constant Fit. Reintroduce the original formula only when allowing different fit values has a meaningful interpretation. This is a proposal for agreement, not a change to an existing working algorithm.

Use a numeric palette and hue circle for color matching; handle low saturation and brightness separately. Beige, brown, and navy need explicit rules rather than automatically classifying them as neutral. Outfit scoring considers all pairs, with role weights and strong conflicts. Explanations use the same rules.

After sorting, remove duplicate sets of item IDs. For diversity, use Jaccard similarity: shared items / distinct items in the union. Select the next eligible outfit using `0.8 × Score/100 − 0.2 × maxSimilarity`. The coefficients are experimental. The displayed score remains the original Score, without the diversity penalty. Results are deterministic for identical inputs and rule versions.

Retain reason codes such as NEUTRAL_BASE, OUTER_LAYER_REQUIRED, and MISSING_FOOTWEAR. The frontend translates them into short messages; the MVP may also return a complete explanation. Include the rule version in technical metadata for reproducibility.

## Weather and Reminders

Open-Meteo is proposed for the educational MVP. The Weather Adapter obtains temperature_2m, apparent_temperature, and weather_code, explicitly normalizing units and precipitation conditions. The provider documents these variables: [Weather Forecast API](https://open-meteo.com/en/docs). The free API has noncommercial use and attribution conditions: [Terms](https://open-meteo.com/en/terms).

The proposed weather cache TTL is 15 minutes per city. If the provider is unavailable, show the age of cached data. Beyond a defined staleness threshold, ask the user to supply conditions manually or retry. Do not default to sunny weather. Actual and apparent temperature must not be silently mixed in temperatureC; update the contract explicitly.

Initially, show the daily reminder inside the application once per local day. This is not equivalent to push delivery when the application is closed. Fulfilling the proposal's push feature requires a separate task: user permission, HTTPS, a service worker, Push API, subscriptions, server delivery, and testing on real phones. Notifications API requires permission and has platform restrictions: [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API). Do not promise delivery at an exact minute. If the team keeps only an in-app reminder, record this scope change in the proposal.

Show reminders only when enabled and while the wardrobe cannot produce at least one complete outfit. The user can disable them sooner. Use the user's IANA timezone rather than server time. Repeating a scheduled job must not send a second notification for the same local day.

## Body Model Preview

The preset consists of one abstract body and a small set of prepared garment models. Each GarmentType maps to an asset and a layer. Selecting an item changes the basic shape and color. Display the uploaded photograph alongside the model without promising exact reproduction of patterns or fabric.

Assets use GLB/glTF with a shared scale, position, and node naming convention. Three.js loads glTF through GLTFLoader: [official guide](https://threejs.org/manual/pages/loading-3d-models.html). Check asset licenses and release resources when switching scenes.

Rotation, zoom, and camera reset are sufficient for the MVP. If WebGL is unavailable, retain the 2D outfit view. Fit is a user-provided tag rather than a conclusion from model geometry. Show the photograph and explain preview limitations for unsupported categories.

## Proposed Team Responsibilities

This distribution differs from the original proposal and requires discussion. One owner per outcome matters more than an equal task count.

| Member | Main responsibility | Verifiable outcome |
|---|---|---|
| Yelnur | Recommendation Engine, Python and NestJS contract, integration | Valid, explainable outfits and an API by 6 November |
| Timur | NestJS, Prisma, wardrobe, uploads, weather, admin API, deployment | User API and data for both frontend interfaces |
| Alexandr | User frontend, mobile adaptation, preset 3D | Complete journey from photo to saved outfit |
| Daniil | CV baseline and evaluation, minimal admin frontend, user testing | Confirmable detection, admin panel, and test report |

Assigning CV to Daniil is a proposed extension of his earlier research role. If CV remains with Yelnur, Daniil takes the dataset, experiments, testing, and admin panel, while CV scope is limited to a pretrained model without training. Developing custom CV, Recommendation, and the entire backend simultaneously would overload one person within the schedule.

Timur and Yelnur agree on enums and errors; Alexandr and Daniil agree on design components. The team demonstrates one complete user journey each week. The team handles commits, PRs, and publishing through its own process; this plan publishes nothing.

## Schedule and Dependencies

| Period in 2026 | Yelnur | Timur | Alexandr | Daniil | Shared milestone |
|---|---|---|---|---|---|
| 16–18 October | Contract and color review | Migration and upload plan | Screens and 3D status check | CV experiment and photo dataset | Shared JSON examples and responsibilities |
| 19–23 October | Color Matching | Wardrobe CRUD, uploads, weather | Wardrobe and manual entry | CV baseline, admin shell | Photo or manual entry → item in database |
| 24–30 October | Generation and eligibility | Detection orchestration, outfit saving | CV confirmation, preset, and builder | CV evaluation and processing failures | Detection and 3D per proposal |
| 31 October – 6 November | Scoring, diversity, API | Recommendation adapter and roles | Outfit screen and explanations | Admin API integration, test scenarios | Working Recommendation Logic |
| 7–13 November | Rule and performance checks | Wear logs, statistics, failures | History and empty states | Admin panel, CV and UX checks | Subsystems pass checks |
| 14–20 November | Joint integration | Deployment and internal calls | Complete user journey | Device testing | Frontend and backend integrated |
| 21–27 November | Edge cases | Reliability and recovery | Accessibility and performance | Complete system testing | System checks complete |
| 28 November – 4 December | Fixes and algorithm explanation | Fixes and demo data | Fixes and presentation | User testing and poster | Poster Demo on 4 December |
| 5–10 December | Defense rehearsal | Backup deployment | Interface rehearsal | Final scenario checks | iShowcase on 10 December |

Milestone dates come from the Project Proposal. Check 3D status in the first week: the proposal scheduled a prototype for 2 October, but the reviewed repository contains no implementation. It may exist in another branch; the team should check immediately.

The recommender develops against a synthetic wardrobe without waiting for CV. The frontend uses shared examples without waiting for the API. Start integration with manual item entry so detection errors do not block the entire product.

## First Integration Sprint

The first sprint ends on 23 October. Its outcome is a working manual wardrobe and weather integration. CV and recommendations proceed separately without blocking this journey.

| Task | Owner | Dependency | Completion criterion |
|---|---|---|---|
| Shared item, weather, and error JSON examples | Yelnur and Timur | Team decisions | Both sides interpret enums and units identically |
| Wardrobe CRUD with ownership checks | Timur | Prisma models | Create, edit, list, and delete owned items |
| Private photo uploads | Timur | Storage | Photos belong to an owner; invalid files are rejected |
| Weather for the selected city | Timur | Provider selection | Update time, normalization, and failure handling |
| Wardrobe screen and manual form | Alexandr | JSON examples | Add, edit, and display items |
| 3D prototype check | Alexandr | Licensed asset | Model renders on a phone, with 2D fallback |
| Independent Color Matching module | Yelnur | Palette | Reproducible scores and verified edge cases |
| Recommendation scenario dataset | Yelnur | Contract | Empty, small, cold-weather, and formal wardrobes |
| CV baseline and manual correction | Daniil | Permitted images | Measurements and a class error list |
| Minimal admin navigation | Daniil | Design and JSON examples | Sections work on examples without browsing private photos |
| Complete wardrobe demonstration | Entire team | CRUD and user form | A new user adds an item from a phone |

The next sprint replaces examples with real integrations: CV → confirmed item, then Recommendation → outfit screen. Accept features through demonstrated journeys rather than file counts.

## Target Repository Structure

```text
FitCast-architechtures/
├── frontend/
│   ├── app/                 user routes and /admin
│   ├── components/          navigation, items, outfits, and forms
│   ├── features/            wardrobe, outfits, weather, admin
│   └── lib/                 HTTP client and shared types
├── src/
│   ├── auth/ users/ prisma/ existing modules
│   ├── wardrobe/ uploads/ detection/
│   ├── weather/ recommendations/ outfits/
│   └── wear-history/ statistics/ support/ admin/
├── prisma/                  schema and sequential migrations
├── recommendation-service/  models, rules, routes, and Python tests
├── vision-service/          photo processing and separate CV dependencies
├── contracts/               shared JSON examples and OpenAPI
└── docs/                    decisions, setup, and demo scenarios
```

This is the target structure, rather than a list of existing modules. Shared frontend components include buttons, fields, item cards, outfit cards, errors, and empty states. Mobile and admin interfaces share a palette but differ in density: photographs and one primary next step for users, tables and statuses for administrators.

## Verification and Acceptance Criteria

| Area | Check before the demonstration |
|---|---|
| Access | User A cannot read or change B's items, outfits, or jobs; USER cannot access admin APIs |
| Uploads | Size limits, image decoding, errors, retries, and worker restart |
| CV | Manual category and color correction, low confidence, unsupported classes |
| Recommendation | Empty wardrobe, dresses, layers, missing footwear, precipitation, cold, occasions, identical colors |
| Ranking | No repeated item IDs or duplicate outfits; scores 0–100; at most limit; explanations match rules |
| API | Shared contracts pass on both sides; unavailable Python is not reported as an empty wardrobe |
| History | Repeated clicks do not duplicate wear logs; deleting an item does not distort recorded statistics |
| UI and 3D | Narrow screens, real phones, keyboard use, loading, unavailable WebGL, and image failures |
| Deployment | Clean database migrations, secrets outside Git, restart, backup, and recovery |

Proposed measurement targets: rule processing p95 below 1 second for up to 200 items on a documented test computer; complete recommendation requests p95 below 2 seconds with a warm weather cache. Measure the CV baseline on the selected model and hardware before setting its target. These are project targets, not measured results.

MVP acceptance: a new user can independently add or confirm items, receive an eligible outfit, understand its reasons, open 2D or 3D, save it, and record wearing it. An external service failure preserves data and provides a clear next action.

## Deployment and Demonstration

One server with a reverse proxy and HTTPS is sufficient for the educational version. PostgreSQL and Python are not directly exposed to the internet; the frontend and NestJS are served through the proxy. Photo storage and the database use persistent volumes. Verify restoring from a backup before the demonstration, rather than only creating one.

CI runs NestJS and Next.js builds, Python tests, and integration contract checks. Avoid tools the team cannot maintain. Pin tested dependency versions in the repository before stabilization.

Main demonstration: test user → upload one item → confirmation → wardrobe → CASUAL → explanation → model → saving → wear logging → aggregate admin panel. The backup scenario uses a prepared, permitted wardrobe and explicitly labeled weather data. Demonstrate CV failure through manual confirmation rather than presenting it as successful detection.

## Decisions for the First Team Meeting

1. Confirm task owners, especially the split between CV and Recommendation.
2. Agree on the palette, fit filter, formula, and minimum weather attributes.
3. Locate the existing 3D prototype or confirm the revised scope.
4. Agree on private storage, the weather provider, and error formats.
5. Decide push reminder scope and record proposal changes if reduced.
6. Approve one demo journey and shared test data.

The Project Proposal describes AI as a support tool and reserves core logic and architecture for the team. Use this plan for discussion, revise the decisions yourselves, and record AI contributions in the project disclosure. The revised responsibilities and separate Python services should reflect the team's updated agreement.

## References

- Current code: `src/`, `prisma/schema.prisma`, `frontend/`, `recommendation-service/`.
- Project Proposal: `/Users/yelnurayagan/Desktop/Project Proposal Template_Software_Updated1.pdf`, sections 3, 4, and AI Ground Rules.
- User context: the supplied Recommendation Engine description.
- Interactive concepts contain synthetic metrics and illustrative images; they do not measure the current application.
