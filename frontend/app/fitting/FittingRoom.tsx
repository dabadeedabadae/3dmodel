'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, GarmentType, WardrobeItem, getToken, getWardrobe, mediaUrl } from '../../lib/api';
import { COLORS, GARMENT_LABELS, colorById } from '../../lib/labels';
import { WEIGHT_NAMES, ZERO, type Weights } from '../../lib/figure/deform';
import { listFigures, loadFigure, type Figure, type FigureEntry } from '../../lib/figure/figure';
import type { Palette, Print, View } from './FigureViewer';
import type { PhotoAnchors } from '../../lib/figure/photoMap';

interface SampleGarment { id: string; url: string; textureUrl: string; baseColor: string; needsReview: boolean }

const FigureViewer = dynamic(() => import('./FigureViewer'), { ssr: false, loading: () => <div className="fit-canvas fit-loading">Загрузка модели…</div> });

const TOPS: GarmentType[] = ['TSHIRT', 'SHIRT', 'SWEATER', 'HOODIE', 'JACKET', 'COAT', 'DRESS'];
const BOTTOMS: GarmentType[] = ['PANTS', 'JEANS', 'SHORTS', 'SKIRT'];

const SLIDERS: { key: keyof Weights; label: string }[] = [
  { key: 'chest', label: 'Грудь' }, { key: 'waist', label: 'Талия' }, { key: 'hip', label: 'Бёдра' },
  { key: 'shoulders', label: 'Плечи' }, { key: 'arms', label: 'Руки' }, { key: 'thighs', label: 'Ноги' },
];

/** Presets in slider units; each value is clamped to the figure's measured working range. */
const PRESETS: { id: string; label: string; w: Partial<Weights> }[] = [
  { id: 'base', label: 'Базовая', w: {} },
  { id: 'slim', label: 'Стройная', w: { chest: -0.6, waist: -0.8, hip: -0.5, shoulders: -0.5, arms: -0.6, thighs: -0.6 } },
  { id: 'athletic', label: 'Атлетичная', w: { chest: 0.8, waist: -0.6, hip: -0.2, shoulders: 1, arms: 0.7, thighs: 0.4 } },
  { id: 'round', label: 'Плотная', w: { chest: 0.4, waist: 1, hip: 0.8, shoulders: -0.3, arms: 0.2, thighs: 0.6 } },
];

const VIEWS: { id: View; label: string }[] = [
  { id: 'front', label: 'Спереди' }, { id: 'threequarter', label: '3/4' }, { id: 'side', label: 'Сбоку' }, { id: 'back', label: 'Сзади' },
];

/** Names of the prepared outfits; unknown ids fall back to a number. */
const FIGURE_LABELS: Record<string, string> = {
  'figure-01': 'Футболка и брюки', 'figure-02': 'Худи и брюки', 'figure-03': 'Рубашка и брюки',
};
const figureLabel = (id: string) => FIGURE_LABELS[id] ?? `Комплект ${Number(id.split('-')[1])}`;

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
  /** print from the user's own analysed T-shirt (wardrobe item with a 3D package) */
  const [ownPrint, setOwnPrint] = useState<(Print & { needsReview: boolean }) | null>(null);
  const print = ownPrint ?? samplePrint;

  useEffect(() => {
    fetch('/garments/index.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then(setSamples).catch(() => setSamples([]));
  }, []);
  useEffect(() => {
    const g = samples.find((x) => x.id === printId);
    if (!g) { setPrint(null); return; }
    let active = true;
    fetch(g.url).then((r) => r.json()).then((pkg: { anchors: PhotoAnchors; textureUrl: string; baseColor: string }) => {
      if (!active) return;
      setPrint({ textureUrl: pkg.textureUrl, anchors: pkg.anchors });
      setTopColor(pkg.baseColor);
    }).catch(() => { if (active) setPrint(null); });
    return () => { active = false; };
  }, [printId, samples]);

  useEffect(() => {
    listFigures().then((list) => { setFigures(list); if (list.length && !list.some((f) => f.id === 'figure-01')) setFigureId(list[0].id); })
      .catch((e: unknown) => setFigureError(e instanceof Error ? e.message : 'Не удалось загрузить список моделей.'));
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
    }).catch((e: unknown) => { if (active) setFigureError(e instanceof Error ? e.message : 'Не удалось загрузить модель.'); });
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
  function applyPreset(w: Partial<Weights>) {
    const next = { ...ZERO };
    for (const k of WEIGHT_NAMES) next[k] = clampTo(k, w[k] ?? 0);
    setWeights(next);
  }
  function pickItem(item: WardrobeItem, slot: 'top' | 'bottom') {
    const hex = colorById(item.dominantColor)?.hex ?? '#888';
    if (slot === 'top') {
      setTopId(item.id);
      if (item.garment3d && item.textureUrl) {
        setPrintId(null);
        setOwnPrint({ textureUrl: mediaUrl(item.textureUrl), anchors: item.garment3d.anchors, needsReview: item.garment3d.needsReview });
        setTopColor(item.garment3d.baseColor);
      } else { setOwnPrint(null); setTopColor(hex); }
    } else { setBottomId(item.id); setBottomColor(hex); }
  }
  const presetActive = (w: Partial<Weights>) => WEIGHT_NAMES.every((k) => Math.abs(weights[k] - clampTo(k, w[k] ?? 0)) < 1e-6);

  return (
    <main className="fit-main">
      <div className="profile-heading fit-heading">
        <div>
          <span className="profile-kicker">ПРИМЕРОЧНАЯ</span>
          <h1>3D-модель</h1>
          <p>Настройте фигуру и посмотрите свои вещи на манекене. Поверните модель мышью или пальцем.</p>
        </div>
      </div>

      <div className="fit-layout">
        <section className="fit-stage" aria-label="Манекен">
          {figureError ? <div className="fit-canvas fit-loading" role="alert">{figureError}</div>
            : figure ? <FigureViewer figure={figure} weights={weights} heightCm={heightCm} palette={palette} view={view} viewNonce={viewNonce} print={print} />
              : <div className="fit-canvas fit-loading">Загрузка модели…</div>}
          {ownPrint?.needsReview && <p className="fit-warning" role="status">Точки на фото этой футболки найдены неуверенно — принт может лечь неточно.</p>}
          <div className="fit-views" role="group" aria-label="Ракурс">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" className={view === v.id ? 'is-active' : ''} aria-pressed={view === v.id} onClick={() => { setView(v.id); setViewNonce((n) => n + 1); }}>{v.label}</button>
            ))}
          </div>
        </section>

        <aside className="fit-panel">
          {figures.length > 1 && (
            <section className="profile-panel">
              <h2>Комплект</h2>
              <div className="fit-presets" role="group" aria-label="Комплект">
                {figures.map((f) => (
                  <button key={f.id} type="button" className={figureId === f.id ? 'is-active' : ''} aria-pressed={figureId === f.id} onClick={() => setFigureId(f.id)}>{figureLabel(f.id)}</button>
                ))}
              </div>
            </section>
          )}

          {samples.some((g) => !g.needsReview) && (
            <section className="profile-panel">
              <div className="fit-panel-head">
                <h2>Фото на футболке</h2>
                {printId && <button type="button" className="profile-reset" onClick={() => setPrintId(null)}>Убрать</button>}
              </div>
              <div className="fit-items">
                <ul>
                  {samples.filter((g) => !g.needsReview).map((g) => (
                    <li key={g.id}>
                      <button type="button" className={printId === g.id ? 'is-active' : ''} aria-pressed={printId === g.id} onClick={() => { setOwnPrint(null); setTopId(null); setPrintId(g.id); }} title="Фото из открытого набора (CC0)">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local sample texture */}
                        <img src={g.textureUrl} alt="Фото футболки" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="fit-note">Перёд футболки — с фото, по маске и ориентирам. Спинка и бока не видны на снимке и показаны основным цветом вещи. Образцы — открытый набор фото (CC0); снимки, где точки нужно подтвердить вручную, здесь не показаны.</p>
            </section>
          )}

          <section className="profile-panel">
            <h2>Одежда</h2>
            {signedIn ? (
              wardrobe === null ? <p className="fit-hint">Загрузка гардероба…</p> : (
                <>
                  <ItemRow title="Верх" items={tops} selected={topId} onPick={(i) => pickItem(i, 'top')} empty="В гардеробе нет верха — футболки, свитера, куртки." />
                  <ItemRow title="Низ" items={bottoms} selected={bottomId} onPick={(i) => pickItem(i, 'bottom')} empty="В гардеробе нет низа — брюк, джинсов, юбки." />
                  {(!tops.length || !bottoms.length) && <Link className="fit-link" href="/profile">Добавить вещи в гардероб →</Link>}
                </>
              )
            ) : (
              <>
                <Swatches title="Цвет верха" ids={QUICK_TOPS} value={topColor} onPick={setTopColor} />
                <Swatches title="Цвет низа" ids={QUICK_BOTTOMS} value={bottomColor} onPick={setBottomColor} />
                <p className="fit-hint"><Link href="/login">Войдите</Link>, чтобы примерить вещи из своего гардероба.</p>
              </>
            )}
            <p className="fit-note">Футболка с пометкой 3D надевается с принтом со своего фото; у остальных вещей переносится цвет. Крой — у модели.</p>
          </section>

          <section className="profile-panel">
            <div className="fit-panel-head">
              <h2>Фигура</h2>
              <button type="button" className="profile-reset" onClick={() => { applyPreset({}); setHeightCm(175); }}>Сбросить</button>
            </div>
            <div className="fit-presets" role="group" aria-label="Тип фигуры">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className={presetActive(p.w) ? 'is-active' : ''} aria-pressed={presetActive(p.w)} onClick={() => applyPreset(p.w)}>{p.label}</button>
              ))}
            </div>
            <label className="fit-slider">
              <span>Рост <b>{heightCm} см</b></span>
              <input type="range" min={150} max={200} step={1} value={heightCm} onChange={(e) => setHeightCm(Number(e.target.value))} />
            </label>
            {SLIDERS.map(({ key, label }) => {
              const r = figure?.range[key] ?? 1;
              return (
                <label key={key} className="fit-slider">
                  <span>{label} <b>{signed(weights[key] / r)}</b></span>
                  <input
                    type="range" min={-r} max={r} step={r / 50} value={weights[key]} disabled={!figure}
                    onChange={(e) => setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))}
                  />
                </label>
              );
            })}
            <p className="fit-note">Ползунки ограничены диапазоном, в котором модель остаётся корректной. Это пропорции, не мерки в сантиметрах.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

const signed = (v: number) => (Math.abs(v) < 0.005 ? '0' : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`);

function ItemRow({ title, items, selected, onPick, empty }: {
  title: string; items: WardrobeItem[]; selected: string | null; onPick: (i: WardrobeItem) => void; empty: string;
}) {
  return (
    <div className="fit-items">
      <span className="wardrobe-label">{title}</span>
      {items.length ? (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" className={selected === i.id ? 'is-active' : ''} aria-pressed={selected === i.id} onClick={() => onPick(i)} title={`${GARMENT_LABELS[i.type]}, ${colorById(i.dominantColor)?.label ?? i.dominantColor}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- API upload */}
                <img src={mediaUrl(i.imageUrl)} alt={`${GARMENT_LABELS[i.type]}, ${colorById(i.dominantColor)?.label ?? i.dominantColor}`} />
                <i style={{ background: colorById(i.dominantColor)?.hex }} aria-hidden />
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
