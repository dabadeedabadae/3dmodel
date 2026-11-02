# PLAN — карта этапов (кратко)

Полный план с промптами: `../FITCAST_PHOTO_GARMENTS_CLAUDE_PLAN.md` (версия 1.0, 29.10.2026).

**Изменение приоритетов 2026-10-29 (DECISIONS D-11):** цель — одна полностью работающая цепочка для футболки без манекена: фото → категория → фон → маска → форма → подгонка шаблона → UV → пикселизация → просмотр (отдельно, без тела) и сохранение. Этапы 04 и 13 отложены; `AvatarAdapter` и данные совместимости сохраняются для будущей интеграции, тестовый манекен не развивается.

| № | Работа | Контроль | Статус |
|---|---|---|---|
| 01 | Окружение и отдельный модуль | проверки этапа | выполнено (контейнер) · см. reports/stage-01.md |
| 02 | Контракт манекена и данных | проверки этапа | выполнено, интеграция с реальным Body заблокирована · reports/stage-02.md |
| 03 | Одна ручная параметрическая футболка | **A: шаблон** | выполнено; горловина исправлена (1.1.0) · reports/stage-03.md |
| 04 | Подгонка футболки под фигуру | проверки этапа | **ОТЛОЖЕНО** (решение 2026-10-29: манекен не готов; не блокирует обработку фото) |
| 05 | Загрузка и нормализация фото | проверки этапа | выполнено · reports/stage-05.md |
| 06 | Выбор и проверка распознавания | проверки этапа | выполнено (реальный локальный классификатор) · reports/stage-06.md |
| 07 | Удаление фона и маска | **B** | выполнено, ревизия B-1 (замечания B учтены) · reports/stage-07.md |
| 08 | Ориентиры и оценка формы | проверки этапа | выполнено · reports/stage-08.md |
| 09 | Выбор шаблона и параметров вещи | проверки этапа | выполнено · reports/stage-09.md |
| 10 | Перенос фото в UV | проверки этапа | выполнено (перёд + передняя половина рукавов) · reports/stage-10.md |
| 11 | Цвет и осторожная коррекция освещения | проверки этапа | выполнено · reports/stage-11.md |
| 12 | Пикселизация текстуры | C | выполнено, ждёт утверждения C · reports/stage-12.md |
| 13 | Обновление одежды с фигурой и позами | проверки этапа | **ОТЛОЖЕНО** (вместе с 04) |
| 14 | Сохранение гардероба по ID | проверки этапа | не начато |
| 15 | Полная цепочка и обработка ошибок | проверки этапа | не начато |
| 16 | Набор данных, качество и скорость | проверки этапа | не начато |
| 17 | Брюки и юбка после футболки | D | не начато; другие категории сейчас не начинаем |
| 18 | Финальный пакет и передача | финальный отчёт | не начато |

Структура модуля (фактическая):

```
photo-garments/
  CLAUDE.md                       постоянная инструкция
  FITCAST_PHOTO_GARMENTS_CLAUDE_PLAN.md
  docs/        BRIEF, PLAN, DECISIONS, STATUS
  src/
    domain/    types.ts (GarmentRecord, provenance), pipeline.ts (состояния, отмена, инвалидация), versions.ts
    fitting/   AvatarAdapter.ts (контракт), TestMannequinAdapter.ts (ТЕСТОВЫЙ, заморожен), Object3DBodyAdapter.ts (путь к Body.tsx, отложен)
    templates/ tshirt/{params,rows,buildTShirt}.ts, registry.ts, checks.ts
    ui/        app.ts, styles.css (dev-страница)
    providers/ onnx.ts, CategoryProvider.ts (ImageNet MobileNetV2-12), SegmentationProvider.ts (U²-Netp)
    image/     raster.ts (resize, тензоры, морфология масок), uvChecker.ts
    pipeline/  worker.ts (инференс в Web Worker), inferenceClient.ts, photo.ts (05), maskEditor.ts (07), landmarkEditor.ts (08), viewer.ts (12), garmentApp.ts (страница garment.html)
    shape/     landmarks.ts (08), params.ts (09)
    image/     maskOps.ts, uvTransfer.ts (10), color.ts (11), pixelate.ts (12)
    storage/   — пусто, этап 14
  tests/       vitest
  scripts/     check-tshirt.ts (блокирующая проверка, exit 1), render.mjs (Playwright), eval-fixtures.ts (модели на фикстурах, node), e2e-pipeline.mjs (сквозной прогон garment.html)
  reports/     stage-NN.md, stage-03-checks.json
  renders/     PNG + manifest
  fixtures/photos/  26 реальных CC0-фото (clothing-dataset), README с происхождением
  public/models/    u2netp.onnx, mobilenetv2-12.onnx, synset.txt, лицензии, README
  garment.html      страница цепочки фото → категория → маска (точка B)
```
