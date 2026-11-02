# Этап 02 — Контракт манекена и данных
Статус: выполнено для тестового манекена; **интеграция с реальным FitCast Body заблокирована** (блокер описан ниже и в STATUS)

## Изменения
### Фактический API текущего манекена (исследование)
`frontend/app/model/Body.tsx`: функция-компонент R3F, возвращает `<group>` из примитивов — голова сфера r 0.62 (y 1.95, scale 1/1.02/0.98), уши, шея цилиндр, торс капсула r 0.36 len 0.34 (y 1.0), руки капсулы r 0.135 len 0.3 (x ±0.46, y 0.98, наклон ±0.28 рад), ноги капсулы r 0.16 (x ±0.2, y 0.32), стопы эллипсоиды. Стопы на y = 0.
- Система координат: Y вверх, +Z перёд (камера в `Scene.tsx` на +Z), единицы — условные «метры» чиби-масштаба (рост ≈ 2.58).
- Параметры: **нет**. Нейтральная поза: стоя, руки вниз с лёгким наклоном. Семантические области: **нет** (только порядок примитивов). Кости: **нет**. Версии: **нет**. События изменения: **нет**. Доступ к поверхности: **нет** (геометрии живут внутри React-дерева).
- `templates.ts` строит placeholder-одежду цилиндрами с зазором ≥ 0.03 и описывает тело комментариями-числами — это и есть единственный «контракт» сегодня.

### Контракт `AvatarAdapter` — `src/fitting/AvatarAdapter.ts`
`id`, `version`, `kind: 'test'|'production'`, `conventions` (units/up/forward/origin/pose), `getParamSpec/getParams/setParams` (с clamp), `getSurfaceVersion`, `getSurface()` (индексированная треугольная поверхность + регионы head/neck/torso/arm_*/leg_*/foot_*), `getLandmarks()/getLandmark()` (15 именованных точек), `getBones()` (null = позы не поддерживаются), `onChange`, опционально `createDisplayObject()`, `dispose()`.

### Тестовый манекен — `src/fitting/TestMannequinAdapter.ts`
`id = test-chibi`, `kind = test`, `version = 1.0.0+src.frontend.app.model.Body.tsx@2026-10-29`. Примитивы Body.tsx повторены численно через three (Sphere/Capsule/CylinderGeometry) и слиты в одну поверхность с регионами. Ориентиры вычисляются из тех же чисел. Тестовые параметры `height`, `torsoScale`, `shoulderWidth` (у реального тела их нет) — чтобы этапы 04+ можно было проверять на меняющейся фигуре. Изменение параметров → `surfaceVersion++`, кэш сброшен, событие.

### `GarmentRecord` — `src/domain/types.ts`
`schemaVersion`, `id`, `category: {suggestions[] (AI, uncalibrated score, providerId/version), confirmed (null пока пользователь не подтвердил), manual}`, `template {templateId, templateVersion, topologyVersion} | null`, `photos[] (оригинал + нормализованная копия + матрица в оригинал)`, `masks[] (координаты нормализованного фото, source, confirmed, provider)`, `landmarks[] (status ok/uncertain/unknown)`, `params: Record<name, Sourced<number>>` (`default | estimated | user_measured | user_adjusted`), `scale: none | user_measured | reference_object` (без масштаба — сантиметров нет), `textures[] (kind, coveredIslands, conditionalIslands, processingVersion)`, `tags`, `baseColor: Sourced`, `processingVersion`, `avatar {avatarId, avatarVersion, avatarKind: test|production, fit}`.
Версии: `src/domain/versions.ts` (MODULE 0.1.0, PROCESSING 0, AVATAR_CONTRACT 1, SCHEMA 1).

### Состояние pipeline — `src/domain/pipeline.ts`
Стадии `photo_loaded → category_confirmed → mask_confirmed → shape_confirmed → texture_ready → preview_ready → saved`, статусы idle/running/success/error/cancelled, версия входов на стадию. `setInput(stage)` инвалидирует стадию и все зависимые (значения стираются, задачи отменяются через AbortSignal). `run(stage, work)` отбрасывает результат, если за время работы сменился вход или пришла новая задача (stale jobId не пишет в store). `cancel`, события.

### Реестр шаблонов — `src/templates/registry.ts`
`CATEGORY_TEMPLATE = { tshirt: 'tshirt-basic', pants: null, skirt: null, other: null }` — брюки/юбка явно без шаблона.

## Реально запущенные проверки
`npx vitest run` (контейнер, node 22.23.4): **24/24 passed**, в т.ч.
- `tests/pipeline.test.ts` (9): смена фото стирает маску/форму/текстуру; смена категории сохраняет фото, стирает остальное; устаревший асинхронный ответ не перезаписывает новый вход; замещённая задача abort-ится и отбрасывается; cancel → `cancelled`; ошибки фиксируются; нельзя запустить стадию без успешной предыдущей; порядок событий.
- `tests/mannequin.test.ts` (4): kind=test, конвенции, нет костей; поверхность конечна, низ стоп y = 0.08−0.17·0.7, верх головы 1.95+0.62·1.02 (числа Body.tsx), регионы в порядке; ориентиры симметричны; clamp параметров, surfaceVersion, события, торс реально меняется.
- `tests/types.test.ts` (2): пустая запись — ничего не подтверждено, масштаба нет, provenance сохраняется.

## Автоматические результаты и ручные исправления
Нет AI. Исправление в ходе этапа: порядок регионов (ноги, затем стопы) и знак наклона рук приведены к Body.tsx.

## Версии модели, весов, шаблона и манекена
Манекен: `test-chibi 1.0.0+src.frontend.app.model.Body.tsx@2026-10-29` (kind test). Шаблон: `tshirt-basic 1.0.0 / tshirt-basic-topo-1` (этап 03). Моделей/весов нет.

## Ограничения и ошибки
**Интеграционный блокер (BLOCKED):** у реального тела FitCast нет программного API. Пока `frontend/app/model/Body.tsx` не экспортирует геометрию/ориентиры/версию (или не появится GLB с теми же конвенциями и именованными узлами), `avatarKind` остаётся `test`, и итоговый проход (этап 18) не может быть назван интеграцией с FitCast. Что нужно: функция или GLB тела с конвенциями D-04; ориентиры `neck_base, shoulder_*, armpit_*, chest/waist/hip, wrist_*`; версия; событие изменения параметров (если параметры появятся).
Прочее: тестовые параметры манекена — выдумка для тестов, не свойства продукта. Поверхность тестового манекена — слитые примитивы без сшивки (пересекающиеся капсулы), для проверок зазора на этапе 04 это допустимо, для «честной» поверхности — нет.

## Пути и воспроизведение
`src/fitting/AvatarAdapter.ts`, `src/fitting/TestMannequinAdapter.ts`, `src/domain/{types,pipeline,versions}.ts`, `src/templates/registry.ts`, `tests/{pipeline,mannequin,types}.test.ts`. Команда: `npm test`.

## Следующий разрешённый шаг
Этап 03 (выполнен, см. stage-03.md) → контрольная точка A.

---

# Ревизия A-1 (2026-10-29)
- Конвенция сторон: все ориентиры/регионы манекена — стороны **носителя**, левая = +X (D-04). Тесты обновлены.
- Ориентир `shoulder_*` переопределён как высшая точка руки (верх капсулы), чтобы совпадать с тем, что можно извлечь из реального `Object3D` (раньше — центр верхней полусферы).
- Добавлен `Object3DBodyAdapter` — минимальный путь к реальному `Body.tsx` без его переписывания; `docs/INTEGRATION_BODY.md` перечисляет, что доступно сейчас (поверхность, регионы по эвристике/именам, ориентиры из bbox) и чего не хватает (имена мешей, версия, параметры, скелет). Проверено на точной three.js-копии Body.tsx: 11/11 мешей распознаны, ориентиры совпадают с тестовым манекеном по Y в пределах 0.06. Интеграция по-прежнему не выполнена — модуль не запущен внутри фронтенда.
