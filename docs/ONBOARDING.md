# FitCast — онбординг для команды

Что есть в проекте, где что лежит, как запустить и как не сломать 3D-часть. Состояние на 2026-11-19.

## 1. Запуск за 5 минут (Docker)

Нужен только Docker Desktop. Node и Python не нужны.

```bash
git clone git@github.com:dabadeedabadae/FitCast-architechtures.git
cd FitCast-architechtures
git checkout client-web
docker compose up --build -d
```

Первая сборка занимает несколько минут. Потом откройте:
- сайт: http://localhost:3001
- API: http://localhost:3002
- сервис рекомендаций: http://localhost:8010/health
- Postgres: `localhost:5433` (пользователь, пароль и база — `fitcast`)

Миграции базы применяются сами при старте API.

**Демо-аккаунты с гардеробом из 7 вещей:**

```bash
docker compose exec api node scripts/seed-demo.cjs
docker compose exec api cat .demo-accounts.local.json
```

Вторая команда показывает логин и пароль. Это `demo@fitcast.test` и `admin@fitcast.test`, пароли случайные.
Файл живёт только в контейнере, в git его не кладите.

**Если порт занят**, создайте рядом с `docker-compose.yml` файл `.env` с нужными значениями:

```
WEB_PORT=3101
API_PORT=3102
DB_PORT=55433
REC_PORT=8110
```

Адрес API вшивается во фронт при сборке. После смены портов пересоберите:

```bash
docker compose up --build -d
```

**Полезное:**
- `docker compose logs -f api` — логи API;
- `docker compose down` — остановить;
- `docker compose down -v` — остановить и стереть базу и загруженные фото.

После правок фронта пересоберите его:

```bash
docker compose up --build -d web
```

## 2. Запуск для разработки (без Docker для фронта)

Удобнее для фронта: горячая перезагрузка. База и API остаются в Docker.

```bash
docker compose up -d postgres api recommendation
cd frontend
npm ci
echo "NEXT_PUBLIC_API_URL=http://localhost:3002" > .env.local
npm run dev
```

Сайт откроется на http://localhost:3001. Есть одноразовый шаг: распознавание фото в браузере требует рантайм
onnxruntime в `frontend/public/ort`. Из корня репозитория выполните:

```bash
npm ci
npm run ml:sync
```

API без Docker: `cp .env.example .env`, в `.env` поставьте `PORT=3002`, `DATABASE_URL` на вашу базу, затем
`npm run migrate:deploy && npm run build && node dist/main.js`.

## 3. Что где лежит

```
FitCast-architechtures/
├── docker-compose.yml        вся система: postgres, api, web, recommendation
├── Dockerfile                образ API
├── src/                      API на NestJS
│   ├── auth/                 POST /auth/register, /auth/login (JWT)
│   ├── users/                GET/PATCH /users/me, PATCH /users/me/password
│   ├── wardrobe/             GET/POST /wardrobe, PATCH/DELETE /wardrobe/:id
│   │   └── garment3d.ts      строгая проверка «пакета 3D-вещи» с клиента — не ослаблять
│   ├── admin/                /admin/* только для isAdmin, стенд рекомендаций
│   └── prisma/               PrismaService
├── prisma/schema.prisma      User, WardrobeItem (garment3d JSON, textureUrl), SavedOutfit, OutfitItem
├── prisma/migrations/        миграции: новые — через `npx prisma migrate dev --name ...`
├── test/*.e2e.cjs            e2e API: `npm run test:wardrobe`, `npm run test:admin` (нужна база)
├── scripts/
│   ├── seed-demo.cjs         демо-аккаунты и вещи (фото — scripts/demo-photos, CC0)
│   ├── set-admin.cjs         выдать или забрать права админа: `npm run admin:set -- email [revoke]`
│   ├── sync-figure.cjs       пересобрать 3D-фигуры из модуля 3dmodel (только у владельца 3D-модуля)
│   ├── sync-garments.cjs     пересобрать образцы вещей из 3dmodel
│   └── sync-ml.cjs           рантайм onnxruntime → frontend/public/ort
├── recommendation-service/   FastAPI; движок рекомендаций ещё НЕ реализован (отвечает 501)
└── frontend/                 Next.js 16 (App Router), React 19, three.js
    ├── app/
    │   ├── page.tsx, components/Landing.tsx    лендинг
    │   ├── components/SiteHeader.tsx, AppShell.tsx   шапка и каркас
    │   ├── login/, register/                   вход и регистрация
    │   ├── profile/page.tsx, use-profile.ts    личный кабинет
    │   ├── profile/settings/                   имя, город, о себе, смена пароля
    │   ├── profile/Wardrobe.tsx                гардероб + загрузка фото + редактор точек
    │   ├── fitting/                            3D-примерочная (FittingRoom.tsx, FigureViewer.tsx)
    │   ├── admin/                              админка
    │   └── globals.css                         все стили (один файл)
    ├── lib/
    │   ├── api.ts            все запросы к API, токен в localStorage, типы
    │   ├── labels.ts         подписи типов, цветов, посадки
    │   ├── garment/*         распознавание фото в браузере (маска, точки, цвет)
    │   └── figure/*          3D: загрузка фигуры, деформация ползунками, перенос фото (photoMap.ts)
    └── public/
        ├── models/           ГОТОВЫЕ 3D-фигуры: figures.json + figure-01..04.json
        ├── ml/u2netp.onnx    модель маски (Apache-2.0, лицензия рядом)
        ├── garments/         образцы вещей с фото (CC0)
        └── ort/              рантайм onnxruntime (не в git, `npm run ml:sync`)
```

## 4. 3D-часть: как устроена и что нельзя трогать

- **Откуда фигуры.** Их готовит отдельный репозиторий `3dmodel` (модуль `imported-body`): импорт сетки, разметка на
  голову, руки, верх, низ и обувь, проверки пересечений и ползунков. В FitCast лежит только результат
  (`frontend/public/models`). Менять эти JSON руками нельзя: пересобирают их только в 3dmodel
  (`npm run ib:outfits`), затем здесь — `npm run figure:sync`.
- **Какие есть.** `figures.json` перечисляет фигуры и тип одежды на каждой:
  - 01 — футболка + брюки;
  - 02 — худи + брюки;
  - 03 и 04 — рубашка + брюки.
- **Правило I-54.** Вещь надевается только на фигуру с таким же типом одежды. Для курток, юбок, шорт и платьев фигур
  нет: сайт так и пишет.
- **Фото → 3D.** Весь путь от загрузки до вещи на теле описан в `3dmodel/imported-body/docs/PIPELINE.md`.
  Кратко:
  1. в браузере U²-Netp строит маску;
  2. по силуэту находятся точки, считаются цвет и текстура;
  3. на сервер уходит «пакет» (`garment3d`) и текстура;
  4. в примерочной `photoMap.ts` раскладывает фото по лицевым граням фигуры.

  `lib/figure/photoMap.ts` — дословная копия файла из 3dmodel. Не правьте его тут, иначе разойдётся с проверками
  модуля.
- **Сервер не доверяет клиенту.** `src/wardrobe/garment3d.ts` проверяет каждое поле пакета и сам ставит
  «нужна проверка». Если меняете формат пакета, меняйте клиент, сервер и `test/wardrobe.e2e.cjs` вместе.
- **Работа с самими 3D-моделями (репозиторий `3dmodel`).** Исходники лежат в `imported-body/assets/*.fbx`,
  подготовленные сетки — в `imported-body/out/*.json`, список фигур и тип одежды на них — в
  `imported-body/assets/outfits.json`. Репозиторий приватный: лицензия на модели не проверена, наружу их не
  выкладывать.

  Клонировать рядом с FitCast (`Проекты/3dmodel` и `Проекты/FitCast-architechtures`), затем:

  ```bash
  cd 3dmodel
  npm ci
  npm run ib:outfits
  ```

  `ib:outfits` пересобирает все фигуры из FBX и проверяет пересечения и ползунки (примерно 1–2 минуты, нужен
  `PASS`). Остальные команды:
  - `npm run ib:outfit-viewer` — просмотр фигуры в браузере;
  - `npm run ib:photo` — проверка переноса фото.

  Обновить фигуры на сайте — из корня FitCast:

  ```bash
  npm run figure:sync
  ```

  Затем закоммитить `frontend/public/models`. Порядок работы и все решения по 3D:
  `3dmodel/imported-body/docs/STATUS.md`, `DECISIONS.md`, `PIPELINE.md`, `3dmodel/CLAUDE.md`.
- **Чего 3D не делает:** не меряет сантиметры по фото, не восстанавливает спинку вещи, не симулирует ткань. В
  интерфейсе это не обещать.

## 5. Фронт профилей и регистрации: с чего начать

- **Регистрация и вход:** `app/register/page.tsx`, `app/login/page.tsx` → `lib/api.ts`. В API —
  `src/auth/*`, DTO с валидацией в `src/auth/dto`.
  - Сейчас есть только email + пароль.
  - Нет подтверждения почты, сброса пароля и входа через соцсети.
  - JWT хранится в `localStorage`. Сессии сбрасываются через `sessionVersion` при смене пароля.
- **Профиль:** `app/profile/page.tsx` (гардероб, сохранённые образы) и `app/profile/settings/page.tsx` (имя,
  город, «о себе», пароль). API: `GET/PATCH /users/me`, `PATCH /users/me/password`.
  - Поля профиля: `name` до 80 символов, `city` до 100, `bio` до 300 (см. `prisma/schema.prisma`).
  - Новое поле добавляется так:
    1. миграция Prisma;
    2. DTO в `src/users/dto`;
    3. тип `UserProfile` в `lib/api.ts`;
    4. форма.
- **Стили:** один `app/globals.css`, классы с префиксами страниц (`wardrobe-*`, `fit-*`, `profile-*`). Мобильная
  вёрстка там же, в media-запросах.
- **Next 16.** Это не тот Next, что в старых туториалах (см. `frontend/AGENTS.md`). Документация версии лежит в
  `frontend/node_modules/next/dist/docs/`.

## 6. Проверки перед пушем

```bash
npm run test:wardrobe
npm run test:admin
cd frontend
npx tsc --noEmit
npx next build
```

Для `test:wardrobe` и `test:admin` нужна база: `docker compose up -d postgres` и `.env` с `DATABASE_URL`.

`npm run lint` во frontend не работает: в Next 16 команды `next lint` нет. Если нужен линтер, его надо
настроить отдельно (ESLint 9, flat config).

## 7. Известные долги

- Движок рекомендаций не реализован: сервис отвечает 501, стенд в админке это показывает.
- Распознавание фото идёт в основном потоке: интерфейс замирает примерно на 2 с. Кандидат на Web Worker.
- Нет ручной правки точек для брюк (для верха есть).
- Фото хранятся на диске API (`uploads/`, в Docker — том `uploads`), не в облаке.
- Палитра гардероба — 16 цветов: точный цвет вещи хранится только в 3D-пакете.
- Корневой `README.md` местами устарел (Windows-инструкции, план MVP). Этот файл актуальнее.
