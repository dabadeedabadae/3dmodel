'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ApiError, FitTag, GarmentType, WardrobeItem, addWardrobeItem, deleteWardrobeItem, getWardrobe, mediaUrl,
  updateWardrobeItem,
} from '../../lib/api';
import { COLORS, FIT_LABELS, GARMENT_LABELS, colorById, nearestPaletteColor, suggestColor } from '../../lib/labels';
import type { Analysis } from '../../lib/garment/analyze';
import type { PhotoPointName } from '../../lib/figure/photoMap';

const MAX_BYTES = 8 * 1024 * 1024;
/** garment types whose photo is turned into a 3D print on the figure */
const ANALYSABLE: GarmentType[] = ['TSHIRT', 'SHIRT', 'HOODIE', 'SWEATER', 'PANTS', 'JEANS'];
const LONG_TOPS: GarmentType[] = ['SHIRT', 'HOODIE', 'SWEATER'];
/** what the form says it is recognising, in the accusative */
const ANALYSING_LABEL: Partial<Record<GarmentType, string>> = { TSHIRT: 'футболку', SHIRT: 'рубашку', HOODIE: 'худи', SWEATER: 'свитер', PANTS: 'брюки', JEANS: 'джинсы' };
const ACCEPT = 'image/jpeg,image/png,image/webp';

type Filter = 'ALL' | GarmentType;

export default function Wardrobe({ onCountChange, onAuthExpired }: {
  onCountChange?: (count: number) => void;
  onAuthExpired: () => void;
}) {
  const [items, setItems] = useState<WardrobeItem[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');

  useEffect(() => {
    let active = true;
    setLoadError('');
    getWardrobe().then((list) => { if (active) setItems(list); }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить гардероб.');
    });
    return () => { active = false; };
  }, [attempt, onAuthExpired]);

  useEffect(() => { if (items) onCountChange?.(items.length); }, [items, onCountChange]);

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
    setRowError(err instanceof Error ? err.message : 'Не удалось выполнить действие.');
  }

  async function changeFit(item: WardrobeItem, fitTag: FitTag) {
    setBusyId(item.id); setRowError('');
    try {
      const updated = await updateWardrobeItem(item.id, { fitTag });
      setItems((list) => list?.map((x) => (x.id === item.id ? updated : x)) ?? null);
    } catch (err) { fail(err); } finally { setBusyId(null); }
  }

  async function remove(item: WardrobeItem) {
    if (!window.confirm(`Удалить «${GARMENT_LABELS[item.type]}» из гардероба? Фото тоже будет удалено.`)) return;
    setBusyId(item.id); setRowError('');
    try {
      await deleteWardrobeItem(item.id);
      setItems((list) => list?.filter((x) => x.id !== item.id) ?? null);
    } catch (err) { fail(err); } finally { setBusyId(null); }
  }

  const types = items ? Array.from(new Set(items.map((i) => i.type))) : [];
  const visible = items?.filter((i) => filter === 'ALL' || i.type === filter) ?? [];

  return (
    <section className="profile-panel wardrobe" aria-labelledby="wardrobe-title">
      <div className="wardrobe-head">
        <div>
          <span className="profile-kicker">ГАРДЕРОБ</span>
          <h2 id="wardrobe-title">Мои вещи</h2>
          <p>Одна вещь — одно фото. Тип, цвет и посадку можно поменять в любой момент.</p>
        </div>
        {!adding && !!items?.length && <button type="button" className="wardrobe-add-btn" onClick={() => setAdding(true)}>+ Добавить вещь</button>}
      </div>

      {adding && (
        <AddItemForm
          onCancel={() => setAdding(false)}
          onAdded={(item) => { setItems((list) => [item, ...(list ?? [])]); setAdding(false); setFilter('ALL'); }}
          onAuthExpired={onAuthExpired}
        />
      )}

      {loadError ? (
        <div className="wardrobe-empty" role="alert"><p>{loadError}</p><button className="secondary" onClick={() => setAttempt((v) => v + 1)}>Повторить</button></div>
      ) : !items ? (
        <p className="profile-loading" role="status">Загрузка гардероба…</p>
      ) : items.length === 0 ? (
        !adding && (
          <div className="wardrobe-empty">
            <strong>Гардероб пока пуст</strong>
            <p>Начните с вещи, которую носите чаще всего — футболки или джинсов.</p>
            <button type="button" className="wardrobe-add-btn" onClick={() => setAdding(true)}>+ Добавить первую вещь</button>
          </div>
        )
      ) : (
        <>
          {types.length > 1 && (
            <div className="wardrobe-filters" role="group" aria-label="Фильтр по типу">
              <button type="button" className={filter === 'ALL' ? 'is-active' : ''} aria-pressed={filter === 'ALL'} onClick={() => setFilter('ALL')}>Все · {items.length}</button>
              {types.map((t) => (
                <button key={t} type="button" className={filter === t ? 'is-active' : ''} aria-pressed={filter === t} onClick={() => setFilter(t)}>
                  {GARMENT_LABELS[t]} · {items.filter((i) => i.type === t).length}
                </button>
              ))}
            </div>
          )}
          {rowError && <p className="error" role="alert">{rowError}</p>}
          <ul className="wardrobe-grid">
            {visible.map((item) => {
              const color = colorById(item.dominantColor);
              return (
                <li key={item.id} className={`wardrobe-card${busyId === item.id ? ' is-busy' : ''}`}>
                  <div className="wardrobe-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element -- user uploads served by the API */}
                    <img src={mediaUrl(item.imageUrl)} alt={`${GARMENT_LABELS[item.type]}, ${color?.label.toLowerCase() ?? item.dominantColor}`} loading="lazy" />
                    <span className={`wardrobe-fit fit-${item.fitTag.toLowerCase()}`}>{FIT_LABELS[item.fitTag]}</span>
                    {item.garment3d && <span className={`wardrobe-3d${item.garment3d.needsReview ? ' is-review' : ''}`} title={item.garment3d.needsReview ? 'Перенесено на 3D, но точки нужно проверить' : 'Фото перенесено на 3D-модель'}>3D</span>}
                  </div>
                  <div className="wardrobe-info">
                    <strong>{GARMENT_LABELS[item.type]}</strong>
                    <span className="wardrobe-color"><i style={{ background: color?.hex ?? '#ccc' }} aria-hidden />{color?.label ?? item.dominantColor}</span>
                    <Link className="wardrobe-try" href={`/fitting?item=${encodeURIComponent(item.id)}`}>Примерить на 3D →</Link>
                  </div>
                  <div className="wardrobe-actions">
                    <label className="wardrobe-sr" htmlFor={`fit-${item.id}`}>Посадка</label>
                    <select id={`fit-${item.id}`} value={item.fitTag} disabled={busyId === item.id} onChange={(e) => changeFit(item, e.target.value as FitTag)}>
                      {(Object.keys(FIT_LABELS) as FitTag[]).map((f) => <option key={f} value={f}>{FIT_LABELS[f]}</option>)}
                    </select>
                    <button type="button" className="wardrobe-remove" disabled={busyId === item.id} onClick={() => remove(item)} aria-label={`Удалить: ${GARMENT_LABELS[item.type]}`}>Удалить</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

type Pt = { x: number; y: number };
/** names as the person sees them on the photo: left/right are IMAGE sides (photo of the front, as lying) */
const POINT_LABELS: Record<PhotoPointName, string> = {
  neck_left: 'Ворот слева', neck_right: 'Ворот справа', neck_bottom: 'Низ выреза', shoulder_left: 'Плечо слева', shoulder_right: 'Плечо справа',
  armpit_left: 'Подмышка слева', armpit_right: 'Подмышка справа', cuff_left_top: 'Манжета слева, верх', cuff_left_bottom: 'Манжета слева, низ',
  cuff_right_top: 'Манжета справа, верх', cuff_right_bottom: 'Манжета справа, низ', hem_left: 'Низ слева', hem_right: 'Низ справа',
};

/**
 * Point editor for a top (I-63): the photo with the mask, the 13 points draggable with a mouse or a finger. The
 * anchors are recomputed from the moved points by the same code as from the estimated ones (withUserPoints).
 */
function PointEditor({ analysis, onDone, onCancel }: { analysis: Analysis; onDone: (points: Record<PhotoPointName, Pt>) => void; onCancel: () => void }) {
  const edit = analysis.edit!;
  const [points, setPoints] = useState(edit.points);
  const [drag, setDrag] = useState<PhotoPointName | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const r = Math.max(6, Math.min(edit.width, edit.height) * 0.018);
  function toImage(e: React.PointerEvent): Pt | null {
    const m = svg.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.max(0, Math.min(edit.width, p.x)), y: Math.max(0, Math.min(edit.height, p.y)) };
  }
  const line = (a: PhotoPointName, b: PhotoPointName) => <line key={a + b} x1={points[a].x} y1={points[a].y} x2={points[b].x} y2={points[b].y} />;
  return (
    <div className="point-editor">
      <p><b>Поправьте точки.</b> Перетащите каждую точку на своё место: ворот, плечи, подмышки, края манжет, углы низа. «Слева» и «справа» — как на фото.</p>
      <svg
        ref={svg} viewBox={`0 0 ${edit.width} ${edit.height}`} role="img" aria-label="Фото вещи с точками"
        onPointerMove={(e) => { if (!drag) return; const p = toImage(e); if (p) setPoints((ps) => ({ ...ps, [drag]: p })); }}
        onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}
      >
        <image href={edit.backdrop} width={edit.width} height={edit.height} />
        <g className="point-editor-lines">
          {line('neck_left', 'shoulder_left')}{line('shoulder_left', 'cuff_left_top')}{line('cuff_left_top', 'cuff_left_bottom')}
          {line('cuff_left_bottom', 'armpit_left')}{line('armpit_left', 'hem_left')}{line('hem_left', 'hem_right')}
          {line('hem_right', 'armpit_right')}{line('armpit_right', 'cuff_right_bottom')}{line('cuff_right_bottom', 'cuff_right_top')}
          {line('cuff_right_top', 'shoulder_right')}{line('shoulder_right', 'neck_right')}{line('neck_right', 'neck_bottom')}{line('neck_bottom', 'neck_left')}
        </g>
        {(Object.keys(POINT_LABELS) as PhotoPointName[]).map((k) => (
          <circle
            key={k} cx={points[k].x} cy={points[k].y} r={drag === k ? r * 1.4 : r} className={drag === k ? 'is-drag' : ''}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(k); }}
          ><title>{POINT_LABELS[k]}</title></circle>
        ))}
      </svg>
      <div className="profile-save-row">
        <button type="button" className="primary" onClick={() => onDone(points)}>Точки на месте</button>
        <button type="button" className="profile-reset" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

function AddItemForm({ onCancel, onAdded, onAuthExpired }: {
  onCancel: () => void;
  onAdded: (item: WardrobeItem) => void;
  onAuthExpired: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [type, setType] = useState<GarmentType>('TSHIRT');
  const [color, setColor] = useState('black');
  const [colorHint, setColorHint] = useState<string | null>(null);
  const [fitTag, setFitTag] = useState<FitTag>('GOOD');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [editing, setEditing] = useState(false);
  const runId = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  // photo → mask, points, base colour and texture, on this device: T-shirts (I-52), trousers and jeans (I-53),
  // shirts, hoodies and sweaters (I-63)
  useEffect(() => {
    const id = ++runId.current;
    setAnalysis(null); setAnalysisError(''); setEditing(false);
    if (!file || !ANALYSABLE.includes(type)) { setAnalysing(false); return; }
    setAnalysing(true);
    import('../../lib/garment/analyze').then((m) => (type === 'TSHIRT' ? m.analyzeTShirtPhoto(file) : LONG_TOPS.includes(type) ? m.analyzeTShirtPhoto(file, 'top') : m.analyzePantsPhoto(file))).then((a) => {
      if (id !== runId.current) return;
      setAnalysis(a);
      const snapped = nearestPaletteColor(a.pkg.baseColor);
      setColor(snapped); setColorHint(snapped);
    }).catch((e: unknown) => {
      if (id === runId.current) setAnalysisError(e instanceof Error ? e.message : 'Не удалось распознать фото.');
    }).finally(() => { if (id === runId.current) setAnalysing(false); });
  }, [file, type]);

  // Object URLs must be released when the preview changes or the form closes.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(next: File | undefined) {
    setError('');
    if (!next) return;
    if (!ACCEPT.split(',').includes(next.type)) { setError('Нужен файл JPEG, PNG или WebP.'); return; }
    if (next.size > MAX_BYTES) { setError('Фото больше 8 МБ — уменьшите его и попробуйте снова.'); return; }
    setFile(next);
    setPreview(URL.createObjectURL(next));
    const suggested = await suggestColor(next);
    if (suggested) { setColor(suggested); setColorHint(suggested); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) { setError('Выберите фото вещи.'); return; }
    setSaving(true); setError('');
    try {
      const model = analysis && ANALYSABLE.includes(type) ? { pkg: analysis.pkg, texture: analysis.texture } : undefined;
      onAdded(await addWardrobeItem(file, { type, dominantColor: color, fitTag }, model));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setError(err instanceof Error ? err.message : 'Не удалось добавить вещь.');
    } finally { setSaving(false); }
  }

  return (
    <form className="wardrobe-form" onSubmit={submit}>
      <fieldset disabled={saving}>
        <legend>Новая вещь</legend>
        <div className="wardrobe-form-grid">
          <button
            type="button"
            className={`wardrobe-drop${preview ? ' has-image' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
            {preview ? <img src={preview} alt="Выбранное фото" /> : <span><b>Выберите фото</b><small>или перетащите сюда · JPEG, PNG, WebP до 8 МБ</small></span>}
          </button>
          <input ref={input} type="file" accept={ACCEPT} capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />

          <div className="wardrobe-form-fields">
            <div className="field">
              <label htmlFor="new-type">Тип вещи</label>
              <select id="new-type" value={type} onChange={(e) => setType(e.target.value as GarmentType)}>
                {(Object.keys(GARMENT_LABELS) as GarmentType[]).map((t) => <option key={t} value={t}>{GARMENT_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="wardrobe-label" id="new-color-label">Основной цвет</span>
              <div className="wardrobe-swatches" role="radiogroup" aria-labelledby="new-color-label">
                {COLORS.map((c) => (
                  <button
                    key={c.id} type="button" role="radio" aria-checked={color === c.id} title={c.label} aria-label={c.label}
                    className={color === c.id ? 'is-active' : ''} style={{ background: c.hex }} onClick={() => setColor(c.id)}
                  />
                ))}
              </div>
              <small>
                {colorById(color)?.label}
                {colorHint && colorHint === color ? ' — подсказка по фото, проверьте' : ''}
              </small>
            </div>
            <div className="field">
              <span className="wardrobe-label" id="new-fit-label">Как сидит</span>
              <div className="wardrobe-segment" role="radiogroup" aria-labelledby="new-fit-label">
                {(Object.keys(FIT_LABELS) as FitTag[]).map((f) => (
                  <button key={f} type="button" role="radio" aria-checked={fitTag === f} className={fitTag === f ? 'is-active' : ''} onClick={() => setFitTag(f)}>{FIT_LABELS[f]}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {ANALYSABLE.includes(type) && file && (
          <div className={`wardrobe-analysis${analysis?.pkg.needsReview ? ' is-review' : analysis ? ' is-ok' : ''}`} role="status" aria-live="polite">
            {analysing && <p><b>Распознаём {ANALYSING_LABEL[type]} на фото…</b> Маска, точки и цвет считаются прямо на этом устройстве, фото никуда не отправляется.</p>}
            {analysisError && <p><b>Не удалось распознать фото.</b> Вещь сохранится без 3D-принта. {analysisError}</p>}
            {analysis && editing && (
              <PointEditor
                analysis={analysis} onCancel={() => setEditing(false)}
                onDone={(points) => { import('../../lib/garment/analyze').then((m) => { setAnalysis(m.withUserPoints(analysis, points)); setEditing(false); }); }}
              />
            )}
            {analysis && !editing && (
              <div className="wardrobe-analysis-row">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img src={analysis.preview} alt="Маска и найденные точки вещи" />
                <div>
                  {analysis.pkg.needsReview
                    ? <p><b>Принт перенесётся на 3D, но точки нужно проверить.</b> {[analysis.pkg.landmarkStatus !== 'ok' && 'Точки найдены неуверенно.', analysis.pkg.maskQuality !== 'ok' && 'Маска сомнительная.', ...analysis.pkg.anchorIssues].filter(Boolean).join(' ')}</p>
                    : <p><b>Готово: фото будет перенесено на 3D-модель.</b> Перёд — с фото, {type === 'PANTS' || type === 'JEANS' ? 'сзади и по бокам' : 'спинка и бока'} — основным цветом.</p>}
                  <small>
                    {analysis.pkg.pointsSource === 'user' ? 'Точки расставлены вручную' : `Распознано за ${(analysis.ms / 1000).toFixed(1)} с`} · основной цвет {analysis.pkg.baseColor}
                  </small>
                  {analysis.edit && <button type="button" className="wardrobe-edit-points" onClick={() => setEditing(true)}>{analysis.pkg.needsReview ? 'Поправить точки' : 'Проверить точки'}</button>}
                </div>
              </div>
            )}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="profile-save-row">
          <button className="primary" type="submit" disabled={!file || analysing || editing}>{saving ? 'Сохраняем…' : analysing ? 'Распознаём…' : 'Добавить в гардероб'}</button>
          <button type="button" className="profile-reset" onClick={onCancel}>Отмена</button>
        </div>
      </fieldset>
    </form>
  );
}
