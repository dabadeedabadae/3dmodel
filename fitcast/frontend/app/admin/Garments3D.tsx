'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import FigureViewer, { type Palette } from '../fitting/FigureViewer';
import { ZERO, type Weights } from '../../lib/figure/deform';
import { listFigures, loadFigure, type Figure, type FigureEntry } from '../../lib/figure/figure';
import { GARMENT_LABELS } from '../../lib/labels';
import type { GarmentType } from '../../lib/api';

/** written by `npm run catalog:sync` in the repository root (I-70) */
interface CatalogItem { id: string; label: string; layer: string; type: string; status: 'figure' | 'image' | 'todo'; image?: string; figure?: string }

const PALETTE: Palette = { skin: '#d3d4d8', top: '#8d9097', bottom: '#1f2f5c', shoes: '#2a2b30' };
const SLIDER_LABELS: Record<keyof Weights, string> = { chest: 'chest', waist: 'waist', hip: 'hips', shoulders: 'shoulders', arms: 'arms', thighs: 'legs' };
const STATUS: Record<CatalogItem['status'], string> = { figure: 'On the mannequin', image: 'Picture only', todo: 'To do' };
const typeLabel = (t: string) => GARMENT_LABELS[t as GarmentType] ?? t.toLowerCase();

function FigureCard({ entry }: { entry: FigureEntry }) {
  const [figure, setFigure] = useState<Figure | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'front' | 'threequarter' | 'back'>('threequarter');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    loadFigure(entry.url).then((f) => { if (active) setFigure(f); }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Could not load the model.'); });
    return () => { active = false; };
  }, [entry.url]);
  const range = figure?.range;
  return <article className="dash-card">
    <div className="dash-card-stage">
      {figure ? <FigureViewer figure={figure} weights={ZERO} heightCm={175} palette={PALETTE} view={view} viewNonce={nonce} zoom={false} /> : <div className="dash-card-placeholder">{error || 'Loading model…'}</div>}
      <div className="dash-card-views" role="group" aria-label="View">
        {([['front', 'Front'], ['threequarter', '3/4'], ['back', 'Back']] as const).map(([v, l]) => <button key={v} type="button" className={view === v ? 'is-active' : ''} onClick={() => { setView(v); setNonce((n) => n + 1); }}>{l}</button>)}
      </div>
    </div>
    <div className="dash-card-body">
      <div className="dash-card-title"><h3>{entry.label}</h3><span className="dash-badge">{entry.id}</span></div>
      <div className="dash-card-tags">
        <span className="dash-badge is-admin">top: {typeLabel(entry.garments.top)}</span>
        <span className="dash-badge">bottom: {typeLabel(entry.garments.bottom)}</span>
        {entry.inner && <span className="dash-badge">underneath: {typeLabel(entry.inner)}</span>}
      </div>
      <p className="dash-card-meta">{entry.vertices.toLocaleString('en-US')} vertices · {entry.triangles.toLocaleString('en-US')} triangles</p>
      {range && <div className="dash-card-ranges" aria-label="Usable slider range">
        {(Object.keys(SLIDER_LABELS) as (keyof Weights)[]).map((k) => <span key={k} className={range[k] < 0.3 ? 'is-narrow' : ''} title={range[k] < 0.3 ? 'narrow range: on this figure the slider barely changes the shape' : undefined}>{SLIDER_LABELS[k]} ±{range[k]}</span>)}
      </div>}
      <Link className="dash-text-button" href={`/fitting?figure=${entry.id}`}>Open in the fitting room →</Link>
    </div>
  </article>;
}

export default function Garments3D() {
  const [figures, setFigures] = useState<FigureEntry[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    listFigures().then(setFigures).catch((e: unknown) => { setFigures([]); setError(e instanceof Error ? e.message : 'Could not load the models.'); });
    fetch('/catalog/catalog.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then(setCatalog).catch(() => setCatalog([]));
  }, []);
  return <>
    <section className="dash-panel">
      <div className="dash-panel-heading"><div><h2>On the mannequin</h2><p>All ready 3D outfits · drag to rotate · {figures ? `${figures.length} total` : 'loading…'}</p></div></div>
      {error && <p className="dash-empty">{error}</p>}
      <div className="dash-cards">{(figures ?? []).map((f) => <FigureCard key={f.id} entry={f} />)}</div>
    </section>
    {catalog.length > 0 && <section className="dash-panel">
      <div className="dash-panel-heading"><div><h2>Garment catalog</h2><p>On the mannequin {catalog.filter((c) => c.status === 'figure').length} · picture only {catalog.filter((c) => c.status === 'image').length} · to do {catalog.filter((c) => c.status === 'todo').length}</p></div></div>
      <div className="dash-cards is-small">{catalog.map((c) => <article key={c.id} className="dash-card">
        <div className="dash-card-thumb">{/* eslint-disable-next-line @next/next/no-img-element -- static catalogue picture */}{c.image ? <img src={c.image} alt="" loading="lazy" /> : <span>{c.figure ? '3D model is in the section above' : 'no picture'}</span>}</div>
        <div className="dash-card-body">
          <div className="dash-card-title"><h3>{c.label}</h3></div>
          <div className="dash-card-tags"><span className={`dash-badge ${c.status === 'figure' ? 'is-ready' : ''}`}>{STATUS[c.status]}</span><span className="dash-badge">layer: {c.layer}</span><span className="dash-badge">{typeLabel(c.type)}</span></div>
          {c.figure && <Link className="dash-text-button" href={`/fitting?figure=${c.figure}`}>Open →</Link>}
        </div>
      </article>)}</div>
    </section>}
  </>;
}
