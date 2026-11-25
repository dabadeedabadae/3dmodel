'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { OutfitItem, Wear } from '../../lib/api';
import { mediaUrl } from '../../lib/api';
import { ZERO } from '../../lib/figure/deform';
import { listFigures, loadFigure, type Figure, type FigureEntry } from '../../lib/figure/figure';
import type { PantsAnchors, PhotoAnchors } from '../../lib/figure/photoMap';
import { colorById } from '../../lib/labels';
import type { Palette, Print, View } from '../fitting/FigureViewer';

const FigureViewer = dynamic(() => import('../fitting/FigureViewer'), { ssr: false, loading: () => <div className="fit-canvas fit-loading">Loading model…</div> });

/** outermost first: what the mannequin shows on top when the outfit has a layer */
const LAYERS = ['COAT', 'JACKET', 'BLAZER', 'CARDIGAN'];
const INNER = ['SHIRT', 'SWEATER', 'HOODIE', 'TSHIRT', 'DRESS'];
const BOTTOMS = ['PANTS', 'JEANS', 'SHORTS', 'SKIRT'];
const SKIN = '#d3d4d8';
const hex = (i: OutfitItem | undefined, fallback: string) => (i ? colorById(i.dominantColor)?.hex ?? fallback : fallback);

let figuresOnce: Promise<FigureEntry[]> | null = null;
const figuresList = () => (figuresOnce ??= listFigures().catch((e) => { figuresOnce = null; throw e; }));

/**
 * The figure that wears an outfit: its top garment is the outfit's outermost layer (coat, jacket, blazer, cardigan)
 * or, without one, its top; a figure with an inner T-shirt is preferred under a layer so the inner top shows at the
 * neckline. Same sex as the feed's "wear" filter (a skirt or dress picks a women's figure under "All"); the other
 * sex, then the inner top's type, are fallbacks.
 */
export function pickFigure(figures: FigureEntry[], items: OutfitItem[], wear: Wear) {
  const layer = LAYERS.map((t) => items.find((i) => i.type === t)).find(Boolean);
  const inner = INNER.map((t) => items.find((i) => i.type === t)).find(Boolean);
  const female = wear === 'women' || (wear === 'all' && items.some((i) => i.type === 'SKIRT' || i.type === 'DRESS'));
  const sexOk = (f: FigureEntry) => (f.sex === 'female') === female;
  const byTop = (type: string | undefined) => (type ? figures.filter((f) => f.garments.top === type) : []);
  const rank = (list: FigureEntry[]) => [...list].sort((a, b) => Number(sexOk(b)) - Number(sexOk(a)) || Number(!!b.inner) - Number(!!a.inner));
  const shown = layer ?? inner;
  const exact = rank(byTop(shown?.type))[0];
  const viaInner = rank(byTop(inner?.type))[0];
  const any = figures.find(sexOk) ?? figures[0];
  const figure = exact ?? viaInner ?? any;
  const showsTop = figure ? (figure.garments.top === shown?.type ? shown : figure.garments.top === inner?.type ? inner : shown) : shown;
  return { figure, layer, inner, showsTop, exact: !!exact };
}

/** An outfit on the 3D mannequin: colours of the items, and the photo print of a top or trousers that has one. */
export default function OutfitFigure({ items, wear, view }: { items: OutfitItem[]; wear: Wear; view: View }) {
  const [figures, setFigures] = useState<FigureEntry[] | null>(null);
  const [figure, setFigure] = useState<Figure | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { figuresList().then(setFigures).catch(() => setError('The 3D model is not available.')); }, []);

  const pick = useMemo(() => (figures ? pickFigure(figures, items, wear) : null), [figures, items, wear]);
  useEffect(() => {
    if (!pick?.figure) return;
    let active = true;
    loadFigure(pick.figure.url).then((f) => { if (active) setFigure(f); }).catch(() => { if (active) setError('The 3D model is not available.'); });
    return () => { active = false; };
  }, [pick?.figure]);

  const bottom = items.find((i) => BOTTOMS.includes(i.type));
  const shoes = items.find((i) => i.type === 'SHOES');
  const top = pick?.showsTop;
  const palette = useMemo<Palette>(() => ({
    skin: SKIN,
    top: top?.garment3d && top.garment3d.category !== 'pants' ? top.garment3d.baseColor : hex(top, '#8d9097'),
    bottom: bottom?.garment3d && bottom.garment3d.category === 'pants' ? bottom.garment3d.baseColor : hex(bottom, '#1f2f5c'),
    shoes: hex(shoes, '#2a2b30'),
    // the T-shirt seen at a layer's neckline takes the inner top's colour
    inner: pick?.layer && pick.inner ? hex(pick.inner, '#f3f2ee') : undefined,
  }), [top, bottom, shoes, pick?.layer, pick?.inner]);

  const prints = useMemo<Print[]>(() => {
    const out: Print[] = [];
    const entry = pick?.figure;
    if (top?.garment3d && top.textureUrl && top.garment3d.category !== 'pants' && entry?.garments.top === top.type) {
      out.push({ kind: 'tshirt', textureUrl: mediaUrl(top.textureUrl), anchors: top.garment3d.anchors as PhotoAnchors });
    }
    if (bottom?.garment3d && bottom.textureUrl && bottom.garment3d.category === 'pants' && (bottom.type === 'PANTS' || bottom.type === 'JEANS')) {
      out.push({ kind: 'pants', textureUrl: mediaUrl(bottom.textureUrl), anchors: bottom.garment3d.anchors as PantsAnchors });
    }
    return out;
  }, [top, bottom, pick?.figure]);

  if (error) return <div className="fit-canvas fit-loading">{error}</div>;
  if (!figure) return <div className="fit-canvas fit-loading">Loading model…</div>;
  return <div className="looks-figure">
    <FigureViewer figure={figure} weights={ZERO} heightCm={pick?.figure?.sex === 'female' ? 165 : 175} palette={palette}
      view={view} viewNonce={0} prints={prints} zoom={false} interactive={false} />
    {bottom && !['PANTS', 'JEANS'].includes(bottom.type) && <span className="looks-figure-note">The {bottom.type === 'SKIRT' ? 'skirt' : 'shorts'} is shown in its colour on trousers</span>}
    {pick && !pick.exact && top && <span className="looks-figure-note">No 3D {top.type.toLowerCase()} yet: shown on the closest model</span>}
  </div>;
}
