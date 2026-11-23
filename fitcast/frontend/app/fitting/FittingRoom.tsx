'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, GarmentType, WardrobeItem, getToken, getWardrobe, mediaUrl } from '../../lib/api';
import { COLORS, GARMENT_LABELS, colorById } from '../../lib/labels';
import { GAIN, WEIGHT_NAMES, ZERO, type Weights } from '../../lib/figure/deform';
import { listFigures, loadFigure, type Figure, type FigureEntry } from '../../lib/figure/figure';
import { BODY_TYPES, describeZ, pinFromSlider, solveShape, type Girth, type ShapeState } from '../../lib/figure/proportions';
import type { Palette, Print, View } from './FigureViewer';
import type { PantsAnchors, PhotoAnchors } from '../../lib/figure/photoMap';

interface SampleGarment { id: string; category: 'tshirt' | 'pants'; type: string; url: string; textureUrl: string; baseColor: string; needsReview: boolean }

const FigureViewer = dynamic(() => import('./FigureViewer'), { ssr: false, loading: () => <div className="fit-canvas fit-loading">Loading model…</div> });

const TOPS: GarmentType[] = ['TSHIRT', 'SHIRT', 'SWEATER', 'HOODIE', 'CARDIGAN', 'BLAZER', 'JACKET', 'COAT', 'DRESS'];
const BOTTOMS: GarmentType[] = ['PANTS', 'JEANS', 'SHORTS', 'SKIRT'];

const SLIDERS: { key: keyof Weights; label: string }[] = [
  { key: 'chest', label: 'Chest' }, { key: 'waist', label: 'Waist' }, { key: 'hip', label: 'Hips' },
  { key: 'shoulders', label: 'Shoulders' }, { key: 'arms', label: 'Arms' }, { key: 'thighs', label: 'Legs' },
];

/** Presets in slider units; each value is clamped to the figure's measured working range. */
const PRESETS: { id: string; label: string; w: Partial<Weights> }[] = [
  { id: 'base', label: 'Regular', w: {} },
  { id: 'slim', label: 'Slim', w: { chest: -0.6, waist: -0.8, hip: -0.5, shoulders: -0.5, arms: -0.6, thighs: -0.6 } },
  { id: 'athletic', label: 'Athletic', w: { chest: 0.8, waist: -0.6, hip: -0.2, shoulders: 1, arms: 0.7, thighs: 0.4 } },
  { id: 'round', label: 'Full', w: { chest: 0.4, waist: 1, hip: 0.8, shoulders: -0.3, arms: 0.2, thighs: 0.6 } },
];

const VIEWS: { id: View; label: string }[] = [
  { id: 'front', label: 'Front' }, { id: 'threequarter', label: '3/4' }, { id: 'side', label: 'Side' }, { id: 'back', label: 'Back' },
];


const DEFAULT_PALETTE: Palette = { skin: '#d3d4d8', top: '#8d9097', bottom: '#1f2f5c', shoes: '#2a2b30' };
const QUICK_TOPS = ['white', 'gray', 'black', 'red', 'blue', 'green', 'beige', 'pink'];
const QUICK_BOTTOMS = ['navy', 'black', 'blue', 'gray', 'beige', 'brown'];

export default function FittingRoom() {
  const [figures, setFigures] = useState<FigureEntry[]>([]);
  const [figureId, setFigureId] = useState('figure-01');
  const [figure, setFigure] = useState<Figure | null>(null);
  const [figureError, setFigureError] = useState('');
  const [weights, setWeights] = useState<Weights>(ZERO);
  const [heightCm, setHeightCm] = useState(175);
  /** linked proportions (I-68): height and weight size the whole figure, girth sliders shape it at that weight */
  const [linkedPref, setLinked] = useState(true);
  const [weightZ, setWeightZ] = useState(0);
  const [pins, setPins] = useState<ShapeState['pins']>({});
  const [view, setView] = useState<View>('threequarter');
  const [viewNonce, setViewNonce] = useState(0);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [topId, setTopId] = useState<string | null>(null);
  const [bottomId, setBottomId] = useState<string | null>(null);
  const [topColor, setTopColor] = useState(DEFAULT_PALETTE.top);
  const [bottomColor, setBottomColor] = useState(DEFAULT_PALETTE.bottom);
  const [samples, setSamples] = useState<SampleGarment[]>([]);
  const [printId, setPrintId] = useState<string | null>(null);
  const [samplePrint, setPrint] = useState<Print | null>(null);
  /** print from the user's own analysed top (wardrobe item with a 3D package), with the garment type it shows */
  const [ownPrint, setOwnPrint] = useState<(Print & { needsReview: boolean; type: string }) | null>(null);
  /** trousers: own analysed item or a sample, each with the garment type it shows (I-53/I-54) */
  const [ownBottomPrint, setOwnBottomPrint] = useState<(Print & { needsReview: boolean; type: string }) | null>(null);
  const [bottomSampleId, setBottomSampleId] = useState<string | null>(null);
  const [bottomSamplePrint, setBottomSamplePrint] = useState<(Print & { type: string }) | null>(null);
  const cur = figures.find((f) => f.id === figureId) ?? null;
  /** men's and women's figures; linked proportions come from men's measurements (ANSUR II men), so women's figures use the sliders alone */
  const sex = cur?.sex ?? 'male';
  const linked = linkedPref && sex === 'male';
  const sameSex = (f: FigureEntry) => (f.sex ?? 'male') === sex;
  function switchSex(to: 'male' | 'female') {
    if (to === sex) return;
    const next = figures.find((f) => (f.sex ?? 'male') === to && f.garments.top === cur?.garments.top && f.garments.bottom === cur?.garments.bottom) ?? figures.find((f) => (f.sex ?? 'male') === to);
    if (!next) return;
    setFigureId(next.id);
  }
  // the default height follows the mannequin: 175 cm for men, 165 cm for women (also when opened by a link)
  useEffect(() => { setHeightCm(sex === 'female' ? 165 : 175); }, [sex]);
  // a print goes only onto the same garment type of the figure (I-54): T-shirt photos onto a T-shirt, a shirt or
  // hoodie photo onto a shirt or hoodie (I-63), trouser photos onto trousers
  const topPrint = ownPrint && cur?.garments.top === ownPrint.type ? ownPrint : cur?.garments.top === 'TSHIRT' && !ownPrint ? samplePrint : null;
  const bottomCandidate = ownBottomPrint ?? bottomSamplePrint;
  const bottomPrint = bottomCandidate && cur?.garments.bottom === bottomCandidate.type ? bottomCandidate : null;
  const prints = useMemo(() => [topPrint, bottomPrint].filter((p): p is Print => !!p), [topPrint, bottomPrint]);
  const [notice, setNotice] = useState('');
  /** the figure for a garment type: the current one if it matches, otherwise the first that does */
  const figureFor = (slot: 'top' | 'bottom', type: string) =>
    cur?.garments[slot] === type ? cur : figures.find((f) => sameSex(f) && f.garments[slot] === type) ?? figures.find((f) => f.garments[slot] === type) ?? null;
  const availableTypes = (slot: 'top' | 'bottom') => Array.from(new Set(figures.map((f) => f.garments[slot]))).map((t) => GARMENT_LABELS[t as GarmentType]?.toLowerCase() ?? t).join(', ');

  useEffect(() => {
    fetch('/garments/index.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then(setSamples).catch(() => setSamples([]));
  }, []);
  useEffect(() => {
    const g = samples.find((x) => x.id === printId);
    if (!g) { setPrint(null); return; }
    // sample photos are T-shirts: show them on the T-shirt figure
    const tee = figures.find((f) => sameSex(f) && f.garments.top === 'TSHIRT') ?? figures.find((f) => f.garments.top === 'TSHIRT');
    if (tee && tee.id !== figureId) setFigureId(tee.id);
    let active = true;
    fetch(g.url).then((r) => r.json()).then((pkg: { anchors: PhotoAnchors; textureUrl: string; baseColor: string }) => {
      if (!active) return;
      setPrint({ kind: 'tshirt', textureUrl: pkg.textureUrl, anchors: pkg.anchors });
      setTopColor(pkg.baseColor);
    }).catch(() => { if (active) setPrint(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printId, samples]);

  useEffect(() => {
    const g = samples.find((x) => x.id === bottomSampleId);
    if (!g) { setBottomSamplePrint(null); return; }
    const fit = figures.find((f) => sameSex(f) && f.garments.bottom === g.type) ?? figures.find((f) => f.garments.bottom === g.type);
    if (fit && fit.garments.bottom !== cur?.garments.bottom) setFigureId(fit.id);
    let active = true;
    fetch(g.url).then((r) => r.json()).then((pkg: { anchors: PantsAnchors; textureUrl: string; baseColor: string }) => {
      if (!active) return;
      setBottomSamplePrint({ kind: 'pants', type: g.type, textureUrl: pkg.textureUrl, anchors: pkg.anchors });
      setBottomColor(pkg.baseColor);
    }).catch(() => { if (active) setBottomSamplePrint(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomSampleId, samples]);

  // switching the figure by hand drops a chosen item it does not wear
  useEffect(() => {
    if (!cur || !wardrobe) return;
    const top = wardrobe.find((i) => i.id === topId);
    if (top && top.type !== cur.garments.top) { setTopId(null); setOwnPrint(null); setTopColor(DEFAULT_PALETTE.top); }
    const bottom = wardrobe.find((i) => i.id === bottomId);
    if (bottom && bottom.type !== cur.garments.bottom) { setBottomId(null); setOwnBottomPrint(null); setBottomColor(DEFAULT_PALETTE.bottom); }
    if (cur.garments.top !== 'TSHIRT') setPrintId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figureId]);

  useEffect(() => {
    listFigures().then((list) => {
      setFigures(list);
      // /fitting?figure=<id> (the admin's 3D catalogue): open that figure
      const asked = new URLSearchParams(window.location.search).get('figure');
      if (asked && list.some((f) => f.id === asked)) setFigureId(asked);
      else if (list.length && !list.some((f) => f.id === 'figure-01')) setFigureId(list[0].id);
    })
      .catch((e: unknown) => setFigureError(e instanceof Error ? e.message : 'Could not load the model list.'));
  }, []);

  useEffect(() => {
    const entry = figures.find((f) => f.id === figureId);
    if (!entry) return;
    let active = true;
    loadFigure(entry.url).then((f) => {
      if (!active) return;
      // every figure has its own measured slider range: keep the sliders inside it
      setWeights((w) => Object.fromEntries(WEIGHT_NAMES.map((k) => [k, Math.max(-f.range[k], Math.min(f.range[k], w[k]))])) as unknown as Weights);
      setFigure(f);
    }).catch((e: unknown) => { if (active) setFigureError(e instanceof Error ? e.message : 'Could not load the model.'); });
    return () => { active = false; };
  }, [figures, figureId]);

  useEffect(() => {
    if (!getToken()) return;
    setSignedIn(true);
    getWardrobe().then(setWardrobe).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) setSignedIn(false);
      setWardrobe([]);
    });
  }, []);

  const tops = useMemo(() => wardrobe?.filter((i) => TOPS.includes(i.type)) ?? [], [wardrobe]);
  const bottoms = useMemo(() => wardrobe?.filter((i) => BOTTOMS.includes(i.type)) ?? [], [wardrobe]);

  const palette = useMemo<Palette>(() => ({ ...DEFAULT_PALETTE, top: topColor, bottom: bottomColor }), [topColor, bottomColor]);

  const clampTo = (k: keyof Weights, v: number) => {
    const r = figure?.range[k] ?? 1;
    return Math.max(-r, Math.min(r, v));
  };
  const shapeState: ShapeState = { heightCm, weightZ, pins };
  const shape = useMemo(() => solveShape({ heightCm, weightZ, pins }), [heightCm, weightZ, pins]);
  /** what the figure shows: linked values clamped to the figure's working range, or the sliders as they are */
  const shown = useMemo<Weights>(() => (linked
    ? Object.fromEntries(WEIGHT_NAMES.map((k) => [k, clampTo(k, shape.weights[k])])) as unknown as Weights
    : weights),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [linked, shape, weights, figure]);
  function resetShape() { applyPreset({}); setHeightCm(sex === 'female' ? 165 : 175); setWeightZ(0); setPins({}); }
  function toggleLinked(on: boolean) {
    // the figure does not jump: switching off keeps what was shown, switching on starts from the usual shape
    if (!on) setWeights(shown); else { setPins({}); setWeightZ(0); }
    setLinked(on);
  }
  function applyPreset(w: Partial<Weights>) {
    const next = { ...ZERO };
    for (const k of WEIGHT_NAMES) next[k] = clampTo(k, w[k] ?? 0);
    setWeights(next);
  }
  function pickItem(item: WardrobeItem, slot: 'top' | 'bottom') {
    const hex = colorById(item.dominantColor)?.hex ?? '#888';
    const target = figureFor(slot, item.type);
    if (!target) {
      setNotice(`There's no 3D model for "${GARMENT_LABELS[item.type].toLowerCase()}" yet, so it can't be dressed. Available ${slot === 'top' ? 'tops' : 'bottoms'}: ${availableTypes(slot)}.`);
      return;
    }
    setNotice('');
    if (target.id !== figureId) setFigureId(target.id);
    if (slot === 'top') {
      setTopId(item.id);
      if ((item.garment3d?.category === 'tshirt' || item.garment3d?.category === 'top') && item.textureUrl) {
        setPrintId(null);
        setOwnPrint({ kind: 'tshirt', type: item.type, textureUrl: mediaUrl(item.textureUrl), anchors: item.garment3d.anchors, needsReview: item.garment3d.needsReview });
        setTopColor(item.garment3d.baseColor);
      } else { setOwnPrint(null); setTopColor(hex); }
    } else {
      setBottomId(item.id);
      setBottomSampleId(null);
      if (item.garment3d?.category === 'pants' && item.textureUrl) {
        setOwnBottomPrint({ kind: 'pants', type: item.type, textureUrl: mediaUrl(item.textureUrl), anchors: item.garment3d.anchors, needsReview: item.garment3d.needsReview });
        setBottomColor(item.garment3d.baseColor);
      } else { setOwnBottomPrint(null); setBottomColor(hex); }
    }
  }
  // /fitting?item=<id> (the wardrobe's "Try on in 3D"): dress the figure in that item once everything is loaded
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !wardrobe || !figures.length) return;
    deepLinked.current = true;
    const params = new URLSearchParams(window.location.search);
    // ?top=<id>&bottom=<id> (a recommended outfit): dress both, on the figure that has both garment types if one does
    const topId = params.get('top'), bottomId = params.get('bottom');
    if (topId || bottomId) {
      const top = topId ? wardrobe.find((i) => i.id === topId) : undefined;
      const bottom = bottomId ? wardrobe.find((i) => i.id === bottomId) : undefined;
      if ((topId && !top) || (bottomId && !bottom)) setNotice('Some items of this outfit were not found in your wardrobe.');
      if (top && TOPS.includes(top.type)) pickItem(top, 'top');
      if (bottom && BOTTOMS.includes(bottom.type)) pickItem(bottom, 'bottom');
      const both = top && bottom && figures.find((f) => f.garments.top === top.type && f.garments.bottom === bottom.type);
      if (both) setFigureId(both.id);
      return;
    }
    const id = params.get('item');
    const item = id ? wardrobe.find((i) => i.id === id) : undefined;
    if (!item) { if (id) setNotice('This item was not found in your wardrobe.'); return; }
    if (TOPS.includes(item.type)) pickItem(item, 'top');
    else if (BOTTOMS.includes(item.type)) pickItem(item, 'bottom');
    else setNotice(`There's no 3D model for "${GARMENT_LABELS[item.type].toLowerCase()}" yet.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardrobe, figures]);
  const presetActive = (w: Partial<Weights>) => WEIGHT_NAMES.every((k) => Math.abs(weights[k] - clampTo(k, w[k] ?? 0)) < 1e-6);
  const typeActive = (t: (typeof BODY_TYPES)[number]) => Math.abs(t.weightZ - weightZ) < 1e-9
    && WEIGHT_NAMES.every((k) => (t.pins[k] ?? null) === (pins[k] ?? null));

  return (
    <main className="fit-main">
      <div className="profile-heading fit-heading">
        <div>
          <span className="profile-kicker">FITTING ROOM</span>
          <h1>3D model</h1>
          <p>Adjust the figure and see your clothes on the mannequin. Rotate the model with your mouse or finger.</p>
        </div>
      </div>

      <div className="fit-layout">
        <section className="fit-stage" aria-label="Mannequin">
          {figureError ? <div className="fit-canvas fit-loading" role="alert">{figureError}</div>
            : figure ? <FigureViewer figure={figure} weights={shown} heightCm={heightCm} palette={palette} view={view} viewNonce={viewNonce} prints={prints} />
              : <div className="fit-canvas fit-loading">Loading model…</div>}
          {((topPrint && ownPrint?.needsReview) || (bottomPrint && ownBottomPrint?.needsReview)) && <p className="fit-warning" role="status">The points on this item's photo were detected with low confidence, so the print may be slightly off.</p>}
          <div className="fit-views" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" className={view === v.id ? 'is-active' : ''} aria-pressed={view === v.id} onClick={() => { setView(v.id); setViewNonce((n) => n + 1); }}>{v.label}</button>
            ))}
          </div>
        </section>

        <aside className="fit-panel">
          {figures.length > 1 && (
            <section className="profile-panel">
              <h2>Outfit</h2>
              {figures.some((f) => f.sex === 'female') && (
                <div className="fit-sex" role="group" aria-label="Mannequin">
                  {([['male', 'Men'], ['female', 'Women']] as const).map(([v, l]) => <button key={v} type="button" className={sex === v ? 'is-active' : ''} aria-pressed={sex === v} onClick={() => switchSex(v)}>{l}</button>)}
                </div>
              )}
              <div className="fit-presets" role="group" aria-label="Outfit">
                {figures.filter(sameSex).map((f) => (
                  <button key={f.id} type="button" className={figureId === f.id ? 'is-active' : ''} aria-pressed={figureId === f.id} onClick={() => setFigureId(f.id)}>{f.label}</button>
                ))}
              </div>
            </section>
          )}

          {samples.some((g) => !g.needsReview && g.category === 'tshirt') && (
            <section className="profile-panel">
              <div className="fit-panel-head">
                <h2>Photo on T-shirt</h2>
                {printId && <button type="button" className="profile-reset" onClick={() => setPrintId(null)}>Remove</button>}
              </div>
              <div className="fit-items">
                <ul>
                  {samples.filter((g) => !g.needsReview && g.category === 'tshirt').map((g) => (
                    <li key={g.id}>
                      <button type="button" className={printId === g.id ? 'is-active' : ''} aria-pressed={printId === g.id} onClick={() => { setOwnPrint(null); setTopId(null); setPrintId(g.id); }} title="Photo from an open dataset (CC0)">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local sample texture */}
                        <img src={g.textureUrl} alt="T-shirt photo" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="fit-note">The T-shirt front comes from the photo, using the mask and landmarks. The back and sides aren't visible in the shot, so they use the garment's main color. Samples come from an open photo dataset (CC0); shots whose points need manual confirmation are not shown here.</p>
            </section>
          )}

          {samples.some((g) => !g.needsReview && g.category === 'pants' && figures.some((f) => f.garments.bottom === g.type)) && (
            <section className="profile-panel">
              <div className="fit-panel-head">
                <h2>Photo on pants</h2>
                {bottomSampleId && <button type="button" className="profile-reset" onClick={() => setBottomSampleId(null)}>Remove</button>}
              </div>
              <div className="fit-items">
                <ul>
                  {samples.filter((g) => !g.needsReview && g.category === 'pants' && figures.some((f) => f.garments.bottom === g.type)).map((g) => (
                    <li key={g.id}>
                      <button type="button" className={bottomSampleId === g.id ? 'is-active' : ''} aria-pressed={bottomSampleId === g.id} onClick={() => { setOwnBottomPrint(null); setBottomId(null); setBottomSampleId(g.id); }} title="Photo from an open dataset (CC0)">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local sample texture */}
                        <img src={g.textureUrl} alt="Pants photo" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="fit-note">The pants front comes from the photo, using the mask and landmarks: waistband, crotch and leg hems. The back and sides use the main color. Jeans only go on a model wearing jeans.</p>
            </section>
          )}

          <section className="profile-panel">
            <h2>Clothes</h2>
            {signedIn ? (
              wardrobe === null ? <p className="fit-hint">Loading wardrobe…</p> : (
                <>
                  <ItemRow title="Top" items={tops} selected={topId} onPick={(i) => pickItem(i, 'top')} hasModel={(t) => figures.some((f) => f.garments.top === t)} empty="No tops in your wardrobe: T-shirts, sweaters, jackets." />
                  <ItemRow title="Bottom" items={bottoms} selected={bottomId} onPick={(i) => pickItem(i, 'bottom')} hasModel={(t) => figures.some((f) => f.garments.bottom === t)} empty="No bottoms in your wardrobe: pants, jeans, skirts." />
                  {notice && <p className="fit-notice" role="status">{notice}</p>}
                  {(!tops.length || !bottoms.length) && <Link className="fit-link" href="/profile">Add items to your wardrobe →</Link>}
                </>
              )
            ) : (
              <>
                <Swatches title="Top color" ids={QUICK_TOPS} value={topColor} onPick={setTopColor} />
                <Swatches title="Bottom color" ids={QUICK_BOTTOMS} value={bottomColor} onPick={setBottomColor} />
                <p className="fit-hint"><Link href="/login">Sign in</Link> to try on clothes from your wardrobe.</p>
              </>
            )}
            <p className="fit-note">An item only goes on the matching garment of the model: T-shirt on T-shirt, pants on pants. A T-shirt marked 3D carries the print from its own photo; the others carry over their color.</p>
          </section>

          <section className="profile-panel">
            <div className="fit-panel-head">
              <h2>Figure</h2>
              <button type="button" className="profile-reset" onClick={resetShape}>Reset</button>
            </div>
            <label className="fit-linked">
              <input type="checkbox" checked={linked} disabled={sex === 'female'} onChange={(e) => toggleLinked(e.target.checked)} />
              <span>Realistic proportions</span>
            </label>
            {sex === 'female' && <p className="fit-note">Linked proportions are built from men&apos;s measurements, so the women&apos;s figure is shaped with the sliders directly.</p>}
            <div className="fit-presets" role="group" aria-label="Body type">
              {linked
                ? BODY_TYPES.map((t) => (
                  <button key={t.id} type="button" className={typeActive(t) ? 'is-active' : ''} aria-pressed={typeActive(t)} onClick={() => { setWeightZ(t.weightZ); setPins(t.pins); }}>{t.label}</button>
                ))
                : PRESETS.map((p) => (
                  <button key={p.id} type="button" className={presetActive(p.w) ? 'is-active' : ''} aria-pressed={presetActive(p.w)} onClick={() => applyPreset(p.w)}>{p.label}</button>
                ))}
            </div>
            <label className="fit-slider">
              <span>Height <b>{heightCm} cm</b></span>
              <input type="range" min={150} max={200} step={1} value={heightCm} onChange={(e) => setHeightCm(Number(e.target.value))} />
            </label>
            {linked && (
              <label className="fit-slider">
                <span>Weight <b>{signed(shape.weightRatio)}</b></span>
                <input type="range" min={-2} max={2.5} step={0.05} value={weightZ} onChange={(e) => setWeightZ(Number(e.target.value))} />
                <small className="fit-z">{describeZ(weightZ)} for this height</small>
              </label>
            )}
            {SLIDERS.map(({ key, label }) => {
              const r = figure?.range[key] ?? 1;
              const v = shown[key];
              const atLimit = linked && Math.abs(shape.weights[key]) > r + 1e-6;
              return (
                <label key={key} className="fit-slider">
                  <span>{label} <b>{signed(GAIN[key] * v)}</b></span>
                  <input
                    type="range" min={-r} max={r} step={r / 50} value={v} disabled={!figure}
                    onChange={(e) => {
                      const nv = Number(e.target.value);
                      if (linked) setPins((p) => ({ ...p, [key]: pinFromSlider(shapeState, key as Girth, nv) }));
                      else setWeights((w) => ({ ...w, [key]: nv }));
                    }}
                  />
                  {linked && (
                    <small className="fit-z">
                      {describeZ(shape.z[key as Girth])}{pins[key as Girth] === undefined ? ' · auto' : ''}{atLimit ? ' · model limit' : ''}
                    </small>
                  )}
                </label>
              );
            })}
            {linked && <p className="fit-note">Height and weight change the whole figure, the sliders change the shape at the same weight; the rest follows the measurements of 4,000 men (ANSUR II). “Typical” means typical for this height and weight. Percentages are relative to the base figure, not centimeters.</p>}
            <p className="fit-note">The sliders are limited to the range where the model stays correct. They are proportions, not measurements in centimeters.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

const signed = (v: number) => (Math.abs(v) < 0.005 ? '0' : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`);

function ItemRow({ title, items, selected, onPick, empty, hasModel }: {
  title: string; items: WardrobeItem[]; selected: string | null; onPick: (i: WardrobeItem) => void; empty: string;
  hasModel: (type: string) => boolean;
}) {
  return (
    <div className="fit-items">
      <span className="wardrobe-label">{title}</span>
      {items.length ? (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" className={`${selected === i.id ? 'is-active' : ''}${hasModel(i.type) ? '' : ' no-model'}`} aria-pressed={selected === i.id} onClick={() => onPick(i)} title={`${GARMENT_LABELS[i.type]}, ${colorById(i.dominantColor)?.label ?? i.dominantColor}${hasModel(i.type) ? '' : ' (no 3D model for this item yet)'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- API upload */}
                <img src={mediaUrl(i.imageUrl)} alt={`${GARMENT_LABELS[i.type]}, ${colorById(i.dominantColor)?.label ?? i.dominantColor}`} />
                <i style={{ background: colorById(i.dominantColor)?.hex }} aria-hidden />
                {!hasModel(i.type) && <em className="fit-nomodel">no model</em>}
                {i.garment3d && <b className="fit-3d">3D</b>}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="fit-hint">{empty}</p>}
    </div>
  );
}

function Swatches({ title, ids, value, onPick }: { title: string; ids: string[]; value: string; onPick: (hex: string) => void }) {
  return (
    <div className="fit-items">
      <span className="wardrobe-label">{title}</span>
      <div className="wardrobe-swatches" role="radiogroup" aria-label={title}>
        {ids.map((id) => {
          const c = COLORS.find((x) => x.id === id)!;
          return <button key={id} type="button" role="radio" aria-checked={value === c.hex} aria-label={c.label} title={c.label} className={value === c.hex ? 'is-active' : ''} style={{ background: c.hex }} onClick={() => onPick(c.hex)} />;
        })}
      </div>
    </div>
  );
}
