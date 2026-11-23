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
/** what the form says it is recognising */
const ANALYSING_LABEL: Partial<Record<GarmentType, string>> = { TSHIRT: 'T-shirt', SHIRT: 'shirt', HOODIE: 'hoodie', SWEATER: 'sweater', PANTS: 'pants', JEANS: 'jeans' };
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
      setLoadError(err instanceof Error ? err.message : 'Could not load your wardrobe.');
    });
    return () => { active = false; };
  }, [attempt, onAuthExpired]);

  useEffect(() => { if (items) onCountChange?.(items.length); }, [items, onCountChange]);

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
    setRowError(err instanceof Error ? err.message : 'Could not complete the action.');
  }

  async function changeFit(item: WardrobeItem, fitTag: FitTag) {
    setBusyId(item.id); setRowError('');
    try {
      const updated = await updateWardrobeItem(item.id, { fitTag });
      setItems((list) => list?.map((x) => (x.id === item.id ? updated : x)) ?? null);
    } catch (err) { fail(err); } finally { setBusyId(null); }
  }

  async function remove(item: WardrobeItem) {
    if (!window.confirm(`Remove "${GARMENT_LABELS[item.type]}" from your wardrobe? The photo will be deleted too.`)) return;
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
          <span className="profile-kicker">WARDROBE</span>
          <h2 id="wardrobe-title">My items</h2>
          <p>One item per photo. You can change the type, color and fit at any time.</p>
        </div>
        {!adding && !!items?.length && <button type="button" className="wardrobe-add-btn" onClick={() => setAdding(true)}>+ Add item</button>}
      </div>

      {adding && (
        <AddItemForm
          onCancel={() => setAdding(false)}
          onAdded={(item) => { setItems((list) => [item, ...(list ?? [])]); setAdding(false); setFilter('ALL'); }}
          onAuthExpired={onAuthExpired}
        />
      )}

      {loadError ? (
        <div className="wardrobe-empty" role="alert"><p>{loadError}</p><button className="secondary" onClick={() => setAttempt((v) => v + 1)}>Try again</button></div>
      ) : !items ? (
        <p className="profile-loading" role="status">Loading wardrobe…</p>
      ) : items.length === 0 ? (
        !adding && (
          <div className="wardrobe-empty">
            <strong>Your wardrobe is empty</strong>
            <p>Start with what you wear most often, like a T-shirt or jeans.</p>
            <button type="button" className="wardrobe-add-btn" onClick={() => setAdding(true)}>+ Add your first item</button>
          </div>
        )
      ) : (
        <>
          {types.length > 1 && (
            <div className="wardrobe-filters" role="group" aria-label="Filter by type">
              <button type="button" className={filter === 'ALL' ? 'is-active' : ''} aria-pressed={filter === 'ALL'} onClick={() => setFilter('ALL')}>All · {items.length}</button>
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
                    {item.garment3d && <span className={`wardrobe-3d${item.garment3d.needsReview ? ' is-review' : ''}`} title={item.garment3d.needsReview ? 'Transferred to 3D, but the points need checking' : 'Photo transferred to the 3D model'}>3D</span>}
                  </div>
                  <div className="wardrobe-info">
                    <strong>{GARMENT_LABELS[item.type]}</strong>
                    <span className="wardrobe-color"><i style={{ background: color?.hex ?? '#ccc' }} aria-hidden />{color?.label ?? item.dominantColor}</span>
                    <Link className="wardrobe-try" href={`/fitting?item=${encodeURIComponent(item.id)}`}>Try on in 3D →</Link>
                  </div>
                  <div className="wardrobe-actions">
                    <label className="wardrobe-sr" htmlFor={`fit-${item.id}`}>Fit</label>
                    <select id={`fit-${item.id}`} value={item.fitTag} disabled={busyId === item.id} onChange={(e) => changeFit(item, e.target.value as FitTag)}>
                      {(Object.keys(FIT_LABELS) as FitTag[]).map((f) => <option key={f} value={f}>{FIT_LABELS[f]}</option>)}
                    </select>
                    <button type="button" className="wardrobe-remove" disabled={busyId === item.id} onClick={() => remove(item)} aria-label={`Remove: ${GARMENT_LABELS[item.type]}`}>Remove</button>
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
  neck_left: 'Collar, left', neck_right: 'Collar, right', neck_bottom: 'Neckline bottom', shoulder_left: 'Shoulder, left', shoulder_right: 'Shoulder, right',
  armpit_left: 'Armpit, left', armpit_right: 'Armpit, right', cuff_left_top: 'Cuff left, top', cuff_left_bottom: 'Cuff left, bottom',
  cuff_right_top: 'Cuff right, top', cuff_right_bottom: 'Cuff right, bottom', hem_left: 'Hem, left', hem_right: 'Hem, right',
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
      <p><b>Adjust the points.</b> Drag each point into place: collar, shoulders, armpits, cuff edges, hem corners. "Left" and "right" are as seen in the photo.</p>
      <svg
        ref={svg} viewBox={`0 0 ${edit.width} ${edit.height}`} role="img" aria-label="Garment photo with points"
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
        <button type="button" className="primary" onClick={() => onDone(points)}>Points look good</button>
        <button type="button" className="profile-reset" onClick={onCancel}>Cancel</button>
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
      if (id === runId.current) setAnalysisError(e instanceof Error ? e.message : 'Could not analyze the photo.');
    }).finally(() => { if (id === runId.current) setAnalysing(false); });
  }, [file, type]);

  // Object URLs must be released when the preview changes or the form closes.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(next: File | undefined) {
    setError('');
    if (!next) return;
    if (!ACCEPT.split(',').includes(next.type)) { setError('Please use a JPEG, PNG or WebP file.'); return; }
    if (next.size > MAX_BYTES) { setError('The photo is larger than 8 MB. Make it smaller and try again.'); return; }
    setFile(next);
    setPreview(URL.createObjectURL(next));
    const suggested = await suggestColor(next);
    if (suggested) { setColor(suggested); setColorHint(suggested); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) { setError('Choose a photo of the item.'); return; }
    setSaving(true); setError('');
    try {
      const model = analysis && ANALYSABLE.includes(type) ? { pkg: analysis.pkg, texture: analysis.texture } : undefined;
      onAdded(await addWardrobeItem(file, { type, dominantColor: color, fitTag }, model));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setError(err instanceof Error ? err.message : 'Could not add the item.');
    } finally { setSaving(false); }
  }

  return (
    <form className="wardrobe-form" onSubmit={submit}>
      <fieldset disabled={saving}>
        <legend>New item</legend>
        <div className="wardrobe-form-grid">
          <button
            type="button"
            className={`wardrobe-drop${preview ? ' has-image' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
            {preview ? <img src={preview} alt="Selected photo" /> : <span><b>Choose a photo</b><small>or drag it here · JPEG, PNG, WebP up to 8 MB</small></span>}
          </button>
          <input ref={input} type="file" accept={ACCEPT} capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />

          <div className="wardrobe-form-fields">
            <div className="field">
              <label htmlFor="new-type">Item type</label>
              <select id="new-type" value={type} onChange={(e) => setType(e.target.value as GarmentType)}>
                {(Object.keys(GARMENT_LABELS) as GarmentType[]).map((t) => <option key={t} value={t}>{GARMENT_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="wardrobe-label" id="new-color-label">Main color</span>
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
                {colorHint && colorHint === color ? ' (suggested from the photo, please check)' : ''}
              </small>
            </div>
            <div className="field">
              <span className="wardrobe-label" id="new-fit-label">How it fits</span>
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
            {analysing && <p><b>Detecting the {ANALYSING_LABEL[type]} in the photo…</b> The mask, points and color are computed right on this device. The photo isn't sent anywhere.</p>}
            {analysisError && <p><b>Could not analyze the photo.</b> The item will be saved without a 3D print. {analysisError}</p>}
            {analysis && editing && (
              <PointEditor
                analysis={analysis} onCancel={() => setEditing(false)}
                onDone={(points) => { import('../../lib/garment/analyze').then((m) => { setAnalysis(m.withUserPoints(analysis, points)); setEditing(false); }); }}
              />
            )}
            {analysis && !editing && (
              <div className="wardrobe-analysis-row">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img src={analysis.preview} alt="Garment mask and detected points" />
                <div>
                  {analysis.pkg.needsReview
                    ? <p><b>The print will be transferred to 3D, but the points need checking.</b> {[analysis.pkg.landmarkStatus !== 'ok' && 'Points detected with low confidence.', analysis.pkg.maskQuality !== 'ok' && 'The mask looks questionable.', ...analysis.pkg.anchorIssues].filter(Boolean).join(' ')}</p>
                    : <p><b>Done: the photo will be transferred to the 3D model.</b> The front comes from the photo; the back and sides use the main color.</p>}
                  <small>
                    {analysis.pkg.pointsSource === 'user' ? 'Points placed by hand' : `Analyzed in ${(analysis.ms / 1000).toFixed(1)} s`} · main color {analysis.pkg.baseColor}
                  </small>
                  {analysis.edit && <button type="button" className="wardrobe-edit-points" onClick={() => setEditing(true)}>{analysis.pkg.needsReview ? 'Adjust points' : 'Check points'}</button>}
                </div>
              </div>
            )}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="profile-save-row">
          <button className="primary" type="submit" disabled={!file || analysing || editing}>{saving ? 'Saving…' : analysing ? 'Analyzing…' : 'Add to wardrobe'}</button>
          <button type="button" className="profile-reset" onClick={onCancel}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}
