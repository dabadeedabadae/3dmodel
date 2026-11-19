# FitCast · photo-garments

> **Весь проект в этом репозитории.** Сайт, API и Docker — в папке [`fitcast/`](fitcast/): быстрый старт
> `cd fitcast && docker compose up --build -d` → http://localhost:3001. Онбординг для команды — устройство, где какие
> файлы, 3D-часть, проверки — [`fitcast/docs/ONBOARDING.md`](fitcast/docs/ONBOARDING.md). Корень — 3D-модуль.

Отдельный модуль FitCast: фото вещи → пиксельная low-poly одежда на манекене.
Этапы 01–03 (шаблон) и 05–07 (фото → категория → маска, точка B) — см. `docs/STATUS.md`. Этапы 04/13 (манекен) отложены.

## Запуск на MacBook

Требуется Node.js ≥ 20.19 (проверено на 22.x). Blender и CUDA не нужны.

```bash
cd photo-garments
npm ci               # lockfile закоммичен; флаги не нужны (см. docs/DECISIONS.md D-02 про npm 10 и vitest 4)
npm run dev          # http://127.0.0.1:5174/            — страница шаблона
                     # http://127.0.0.1:5174/garment.html — цепочка фото → категория → маска → ориентиры → параметры → UV → цвет → пиксели → 3D
```

Проверки:

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest (pipeline, манекен, геометрия футболки, типы)
npm run check:tshirt # блокирующая геометрическая проверка, exit 1 при провале → reports/stage-03-checks.json
npm run build        # dist/
npm run verify       # всё выше по порядку
```

Рендеры (headless Chromium через Playwright; один раз: `npx playwright install chromium`):

```bash
npm run render       # renders/stage-03-*.png + render-manifest.json
npm run eval:fixtures  # реальные модели на fixtures/photos (node) → reports/stage-06-07-eval.json
npm run e2e:pipeline   # сквозной прогон garment.html до маски (+ EXIF/большие файлы) → reports/stage-05-07-e2e.json
npm run check:body     # блокирующая проверка процедурного манекена (300 случайных фигур)
npm run check:fit      # блокирующая проверка посадки футболки на пресеты манекена
npm run e2e:fit        # футболки на манекене в Chromium → reports/stage-F04-e2e.json, renders/stage-F/
npm run render:body    # рендеры body.html → renders/stage-M/
npm run e2e:chain      # полная цепочка до 3D на 4 футболках → reports/stage-08-12-e2e.json, renders/stage-08-12/
```

## Dev-страница

- Виды: front / back / left / right / iso; UV checker с буквами; wireframe; flat shading.
- Ползунки параметров футболки (ограниченные) и ТЕСТОВОГО манекена.
- Отчёт геометрических проверок прямо на странице.
- Экспорт UV-раскладки, checker-текстуры и JSON с параметрами/метаданными.
- URL-параметры для скриптов: `?view=front&checker=1&wire=1&mannequin=0&flat=1&params={"length":0.8}`.

## Модели и данные

`public/models/README.md` — веса (ImageNet MobileNetV2-12, U²-Netp; Apache-2.0, sha256), `fixtures/photos/README.md` — 26 CC0-фото. Всё считается локально в браузере (Web Worker, onnxruntime-web wasm).

## Важно

`TestMannequinAdapter` — тестовый манекен, численно повторяющий `frontend/app/model/Body.tsx`. Это НЕ интеграция с реальным телом FitCast; путь интеграции — `Object3DBodyAdapter`, см. `docs/INTEGRATION_BODY.md` и `docs/STATUS.md → Integration blocker`.

Стороны (`*_left`/`*_right`) во всех ID — стороны носителя; левая = +X. Соответствие сторонам снимка — `src/domain/sides.ts`.
