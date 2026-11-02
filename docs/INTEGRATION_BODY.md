# Интеграция с реальным телом FitCast (`frontend/app/model/Body.tsx`)

Статус: **путь подготовлен, интеграция не выполнена** (модуль пока не запускался внутри Next.js-фронтенда). Манекен не переписывается.

## Что есть в Body.tsx сегодня

`Body()` — React-Three-Fiber компонент, возвращает `<group>` из 11 примитивов без имён, без props, без ref. Числа фиксированы в JSX. Нет: параметров, версии, ориентиров, костей, событий, экспорта геометрии.

## Минимальный путь: `Object3DBodyAdapter`

`src/fitting/Object3DBodyAdapter.ts` реализует `AvatarAdapter` поверх любого `THREE.Object3D`. Ему нужен только отрендеренный группой объект — его даёт React ref вокруг `<Body/>`, **без изменения Body.tsx**:

```tsx
// frontend/app/model/Scene.tsx (набросок, не применён)
const bodyRef = useRef<THREE.Group>(null);
...
<group ref={bodyRef}><Body /></group>
...
useEffect(() => {
  if (!bodyRef.current) return;
  const adapter = new Object3DBodyAdapter(bodyRef.current, {
    id: 'fitcast-body',
    version: 'Body.tsx@<git sha>',      // версию задаёт вызывающая сторона
    kind: 'production',
    regionOf: chibiRegionHeuristic,    // пока у мешей нет имён
  });
  ...
  return () => adapter.dispose();
}, []);
```

### Что можно получить сейчас (проверено тестом `tests/object3dBodyAdapter.test.ts` на точной three.js-копии Body.tsx)
| Данные | Как | Качество |
|---|---|---|
| Поверхность тела (`getSurface`) | обход мешей, `matrixWorld`, слияние | полная, как рендерится |
| Регионы head/neck/torso/arm_*/leg_*/foot_* | `chibiRegionHeuristic` (по bbox) — **временная эвристика**, валидна только для текущей чиби-раскладки; `adapter.regionSource` и `getUnassignedMeshes()` показывают, что осталось без региона | 11/11 мешей распознаны |
| Ориентиры: head_top, neck_base, shoulder_*, armpit_*, wrist_*, knee_*, chest/waist/hip, crotch, floor | из bbox регионов (плечо = верх руки, запястье = низ руки, шея = низ детали «шея») | совпадают с `TestMannequinAdapter` по Y в пределах 0.06, стороны верные (+X = левая сторона носителя) |
| Версия поверхности, события | `notifyChanged()` при внешнем изменении объекта | работает, но вызывать некому — тело статично |

### Чего действительно не хватает (нужно от команды FitCast)
1. **Имена мешей** в Body.tsx (`name="head"`, `name="arm_left"`…, 11 строк) — чтобы убрать эвристику. Единственная правка, которую стоит внести в сам файл. Стороны — стороны носителя: рука на `x = +0.46` — `arm_left`.
2. **Версия тела** (константа `BODY_VERSION` рядом с компонентом или git sha) — сейчас её нет; адаптер требует передать строку.
3. **Параметры фигуры** — их нет вообще; пока их нет, этапы 04/13 проверяются только на `TestMannequinAdapter` (у него есть тестовые `height/torsoScale/shoulderWidth`). Если параметры появятся, тело должно вызывать `adapter.notifyChanged(changedParams)`.
4. **Скелет/позы** — отсутствуют; `getBones()` возвращает `null`, позы недоступны.
5. **Масштаб**: тело в условных единицах (рост ≈ 2.58); подгонка относительная, сантиметров нет.

Пока пункты 1–2 не сделаны, а модуль не запущен внутри фронтенда, `GarmentRecord.avatar.avatarKind` остаётся `test`, и интеграция не считается выполненной.
