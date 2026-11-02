# Этап 01 — Окружение и отдельный модуль
Статус: выполнено (проверено в облачном Linux-контейнере; на MacBook — см. раздел «Пути и воспроизведение»)

## Изменения
- Найден существующий FitCast: `~/Desktop/FitCast-architechtures` (NestJS backend в `src/`, Next.js 16 frontend в `frontend/`, Python `recommendation-service/`). 3D-код: `frontend/app/model/*` (React-Three-Fiber, three ^0.185.1, чиби-манекен из примитивов, placeholder-одежда). Отдельного Three.js-приложения не было.
- `git status` корня не выполнялся из контейнера (нет доступа к `.git` с этой стороны); изменения сводятся к НОВОЙ папке `photo-garments/`, существующие файлы не тронуты. `frontend/AGENTS.md` прочитан — относится только к Next.js (правило «читай docs в node_modules/next»), к модулю не применяется; корневого CLAUDE.md/AGENTS.md нет.
- Создан модуль `photo-garments/`: Vite 7.3.7 + TypeScript 5.9.3 + three 0.185.1 (та же версия, что во frontend), vitest 4.1.12, tsx, playwright 1.63.0 (dev). Все версии точные, `package-lock.json` в git, установка с `--legacy-peer-deps` (см. DECISIONS D-02 — обход бага npm 10.9 с опциональными peer-зависимостями vitest 4; `npm audit` → 0 уязвимостей). В контейнере использован `.npmrc`; на Mac файл `.npmrc` удалёнными инструментами не записывается — используйте флаг или создайте файл вручную.
- Документы: `CLAUDE.md` (постоянная инструкция), `docs/BRIEF.md`, `docs/PLAN.md`, `docs/DECISIONS.md`, `docs/STATUS.md`, `README.md`; копия плана `FITCAST_PHOTO_GARMENTS_CLAUDE_PLAN.md`.
- Dev-страница `index.html` + `src/main.ts` + `src/ui/app.ts`: тестовый объект (синий куб + оси, переключаемый), сетка, свет, OrbitControls; обработка ошибок: проверка WebGL с понятным сообщением, баннер `#pg-error` для `error`/`unhandledrejection`, `window.__pg` с `ready/error` для скриптов; `dispose()` ресурсов на `beforeunload`.
- Старый Blender-план не запускался.

## Реально запущенные проверки
Контейнер: Linux 6.18 x86_64, node v22.23.4, npm 10.9.9 (НЕ macOS).
- `npm install` — ок (после перехода на vitest 4 и `.npmrc`), `npm audit` — 0 уязвимостей.
- `npm run verify` = typecheck + vitest + check:tshirt + build — PASS, лог: `reports/stage-01-verify-log.txt`. Сборка: `dist/assets/index-*.js` 578 kB (149 kB gzip) — three целиком, предупреждение о размере чанка ожидаемо.
- Страница с тестовым объектом открыта headless Chromium (Playwright 1.63): рендер `renders/stage-03-iso.png` (куб и оси видны), ошибок консоли нет (`renders/stage-03-render-manifest.json → errors: []`).
- Путь «WebGL недоступен» проверен подменой `getContext` → `renders/stage-03-error-no-webgl.png`, текст сообщения в manifest (`noWebglMessage`).

На MacBook (Linux-VM приложения Claude, arm64, node 22.23.4 — не нативный macOS):
- `npm install --legacy-peer-deps` — ок (lockfile разрешился, те же 8 версий).
- `npm run verify` — PASS: typecheck, vitest 24/24, check:tshirt 20/20 случайных наборов, build 1.04 s. Лог: `reports/stage-01-verify-log-macbook-vm.txt`; отчёт проверок: `reports/stage-03-checks-macbook-vm.json`.
- `npm run dev` — сервер поднялся, `GET /` и `/src/main.ts` → HTTP 200: `reports/stage-01-dev-smoke-macbook-vm.txt`.

## Автоматические результаты и ручные исправления
Нет AI/авто-обработки на этом этапе. Ручные исправления в процессе: замена vitest 3→4 из-за audit; `.npmrc`.

## Версии модели, весов, шаблона и манекена
Модели/веса отсутствуют (этап 06+). three 0.185.1. Манекен — только тестовый (этап 02).

## Ограничения и ошибки
- Рендеры и браузерная проверка выполнены в Linux-контейнере с Chromium; сборка/тесты дополнительно пройдены в Linux-VM на MacBook. **Нативный macOS и браузеры Mac не проверялись** (см. STATUS → «Проверено на устройстве»).
- Playwright на Mac требует `npx playwright install chromium` один раз.
- Chunk 578 kB — приемлемо для dev-страницы, не для продакшена; код-сплиттинг не в объёме этапа.

## Пути и воспроизведение
```
cd ~/Desktop/FitCast-architechtures/photo-garments
npm install --legacy-peer-deps
npm run dev        # http://127.0.0.1:5174/
npm run verify
npm run render     # нужен playwright chromium
```
Файлы: `photo-garments/{package.json,.npmrc,tsconfig.json,vite.config.ts,index.html,src/main.ts,src/ui/app.ts,src/ui/styles.css,CLAUDE.md,README.md,docs/*}`.

## Следующий разрешённый шаг
Этап 02 (выполнен в этой же сессии, см. stage-02.md).
