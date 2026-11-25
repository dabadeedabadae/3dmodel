'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError, EventType, RecommendedOutfit, Recommendations, Taste, TasteModelInfo, Verdict, Wear, clearToken, getOutfitFeed, mediaUrl,
  sendOutfitFeedback,
} from '../../lib/api';
import { EVENT_LABELS, GARMENT_LABELS, colorById, formatTemp } from '../../lib/labels';
import { fittingHref } from '../events/Outfits';
import { useProfile } from '../profile/use-profile';
import type { View } from '../fitting/FigureViewer';
import OutfitFigure from './OutfitFigure';

/** occasions offered as chips in the feed; the rest stay on the events page */
const OCCASIONS: EventType[] = ['CASUAL', 'BUSINESS', 'DATE', 'PARTY', 'STUDY', 'TRAVEL', 'THEATER', 'INTERVIEW'];
/** how far a card has to be dragged to count as a swipe, px */
const SWIPE = 110;
const LIST_KEY = 'fitcast-shopping-list';
const WEAR_KEY = 'fitcast-looks-wear';
const WEARS: { id: Wear; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'men', label: 'Men' }, { id: 'women', label: 'Women' }];

interface ListEntry { key: string; type: string; color: string; reason: string }

/** the shopping list is a per-viewer convenience: it lives in this browser only and the page works without it */
function readList(): ListEntry[] {
  try { return JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]') as ListEntry[]; } catch { return []; }
}
function writeList(list: ListEntry[]) {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* storage blocked: the list just isn't kept */ }
}

/** product pictures per type (light grey, transparent around): tinted with the suggested colour on the page */
const SHOP_TYPES = ['TSHIRT', 'SHIRT', 'SWEATER', 'HOODIE', 'CARDIGAN', 'BLAZER', 'JACKET', 'COAT', 'PANTS', 'JEANS', 'SHORTS', 'SKIRT', 'DRESS'];
function ProductPicture({ type, hex }: { type: string; hex: string }) {
  if (!SHOP_TYPES.includes(type)) return <span className="looks-buy-swatch" style={{ background: hex }} aria-hidden />;
  const src = `/shop/${type.toLowerCase()}.webp`;
  return <span className="looks-product" aria-hidden>
    {/* eslint-disable-next-line @next/next/no-img-element -- static picture */}
    <img src={src} alt="" />
    <i style={{ background: hex, WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` }} />
  </span>;
}

const itemName = (type: string, color: string) =>
  `${colorById(color)?.label ?? color} ${(GARMENT_LABELS as Record<string, string>)[type]?.toLowerCase() ?? type}`;

/** "color:navy" → "navy", "pair:white+navy" → "white top + navy bottom", "type:HOODIE" → "hoodie" */
function featureLabel(f: string): string {
  const [kind, value = ''] = f.split(':');
  if (kind === 'color') return (colorById(value)?.label ?? value).toLowerCase();
  if (kind === 'type') return ((GARMENT_LABELS as Record<string, string>)[value] ?? value).toLowerCase();
  if (kind === 'pair') { const [a, b] = value.split('+'); return `${a} top + ${b} bottom`; }
  return ({ layered: 'layers', patterned: 'patterns', 'short-sleeve': 'short sleeves', 'all-neutral': 'neutral colors',
    bright: 'bright colors', formal: 'dressier looks', dark: 'dark outfits' } as Record<string, string>)[f] ?? f;
}

/** the trained taste model: how many swipes it learned from and what it found */
function ModelSummary({ model, votes }: { model?: TasteModelInfo | null; votes: number }) {
  if (!model) {
    return <p className="looks-model-note">{votes < 8 ? `${8 - votes} more swipe${8 - votes === 1 ? '' : 's'} and a personal model is trained on them.`
      : 'Like some and skip some: the personal model needs both.'}</p>;
  }
  return <div className="looks-model">
    <span className="looks-taste-title">Personal model · trained on {model.examples} swipes</span>
    {model.prefers.length > 0 && <p><b>Goes for</b> {model.prefers.map(featureLabel).join(', ')}</p>}
    {model.avoids.length > 0 && <p><b>Skips</b> {model.avoids.map(featureLabel).join(', ')}</p>}
  </div>;
}

/** a search for the suggested item in online shops: only its colour, type and men / women go into the query */
const shopUrl = (type: string, color: string, wear: Wear) =>
  `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(`${itemName(type, color)}${wear === 'all' ? '' : ` ${wear}`}`)}`;

function TasteSummary({ taste }: { taste?: Taste }) {
  if (!taste || !taste.votes) return <p className="looks-taste-empty">Swipe a few outfits: right if you like it, left if not. The feed learns your taste.</p>;
  const entries = [
    ...Object.entries(taste.colors).map(([k, w]) => ({ label: colorById(k)?.label ?? k, hex: colorById(k)?.hex, w })),
    ...Object.entries(taste.types).map(([k, w]) => ({ label: (GARMENT_LABELS as Record<string, string>)[k] ?? k, hex: undefined, w: w ?? 0 })),
  ].sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 8);
  return <div className="looks-taste">
    <span className="looks-taste-title">Your taste · {taste.votes} swipe{taste.votes === 1 ? '' : 's'}</span>
    <ul>{entries.map((e) => <li key={e.label} className={e.w > 0 ? 'likes' : 'avoids'}>
      {e.hex && <i style={{ background: e.hex }} aria-hidden />}{e.w > 0 ? '♥' : '✕'} {e.label}
    </li>)}</ul>
  </div>;
}

function Suggestion({ outfit, onAdd, added, wear }: { outfit: RecommendedOutfit; onAdd: () => void; added: boolean; wear: Wear }) {
  const s = outfit.suggestion;
  if (!s) return null;
  const color = colorById(s.dominantColor);
  return <div className="looks-buy">
    <span className="looks-buy-kicker">Complete the look</span>
    <div className="looks-buy-row">
      <ProductPicture type={s.type} hex={color?.hex ?? '#ccc'} />
      <div>
        <b>{itemName(s.type, s.dominantColor)}</b>
        <p>{s.reason}</p>
      </div>
      <div className="looks-buy-actions">
        <button className="secondary" onClick={onAdd} disabled={added}>{added ? 'On your list' : 'Add to shopping list'}</button>
        <a href={shopUrl(s.type, s.dominantColor, wear)} target="_blank" rel="noopener noreferrer">Find in shops ↗</a>
      </div>
    </div>
  </div>;
}

const VIEWS: { id: View; label: string }[] = [{ id: 'front', label: 'Front' }, { id: 'threequarter', label: '3/4' }, { id: 'back', label: 'Back' }];

function Card({ outfit, wear, view, onView, dx, dragging, onPointerDown, onPointerMove, onPointerUp }: {
  outfit: RecommendedOutfit; wear: Wear; view: View; onView: (v: View) => void; dx: number; dragging: boolean;
  onPointerDown: (e: ReactPointerEvent) => void; onPointerMove: (e: ReactPointerEvent) => void; onPointerUp: () => void;
}) {
  const replaced = outfit.suggestion?.replaces;
  return <article className="looks-card" style={{ transform: `translateX(${dx}px) rotate(${dx / 22}deg)`, transition: dragging ? 'none' : undefined }}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <span className="looks-stamp like" style={{ opacity: Math.max(0, Math.min(1, dx / SWIPE)) }}>LIKE</span>
    <span className="looks-stamp nope" style={{ opacity: Math.max(0, Math.min(1, -dx / SWIPE)) }}>NOPE</span>
    <OutfitFigure items={outfit.items} wear={wear} view={view} />
    <div className="looks-views" onPointerDown={(e) => e.stopPropagation()}>{VIEWS.map((v) => <button key={v.id} className={v.id === view ? 'on' : ''} onClick={() => onView(v.id)}>{v.label}</button>)}</div>
    <ul className="looks-items looks-thumbs">{outfit.items.map((i) => <li key={i.id} className={i.id === replaced ? 'replaced' : ''}>
      {/* eslint-disable-next-line @next/next/no-img-element -- user uploads served by the API */}
      <img src={mediaUrl(i.imageUrl)} alt="" draggable={false} />
      <span><i style={{ background: colorById(i.dominantColor)?.hex ?? '#ccc' }} aria-hidden />{GARMENT_LABELS[i.type]}</span>
    </li>)}</ul>
    <div className="looks-meta">
      <b>{Math.round(outfit.score)}</b><span>match</span>
      {outfit.breakdown.taste ? <em className={outfit.breakdown.taste > 0 ? 'likes' : 'avoids'}>{outfit.breakdown.taste > 0 ? '+' : ''}{outfit.breakdown.taste.toFixed(1)} your taste</em> : null}
    </div>
    <ul className="looks-factors">
      <li>Occasion {Math.round(outfit.breakdown.occasion)}</li><li>Weather {Math.round(outfit.breakdown.weather)}</li><li>Colors {Math.round(outfit.breakdown.color)}</li>
      {(outfit.breakdown.factors ?? []).map((f) => <li key={f.key} className={f.points > 0 ? 'likes' : f.points < 0 ? 'avoids' : ''}>
        {f.points ? `${f.points > 0 ? '+' : '−'}${Math.abs(f.points)} ` : ''}{f.note}</li>)}
    </ul>
    <p className="looks-why">{outfit.explanation}</p>
  </article>;
}

export default function LooksPage() {
  const router = useRouter();
  const { profile, loading, error: profileError, retry } = useProfile(true);
  const expired = useCallback(() => { clearToken(); router.replace('/login'); }, [router]);
  const [occasion, setOccasion] = useState<EventType>('CASUAL');
  const [wear, setWear] = useState<Wear>('all');
  const [view, setView] = useState<View>('threequarter');
  const [data, setData] = useState<Recommendations | null>(null);
  const [queue, setQueue] = useState<RecommendedOutfit[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [list, setList] = useState<ListEntry[]>([]);
  const start = useRef<number | null>(null);

  useEffect(() => {
    setList(readList());
    try { const w = localStorage.getItem(WEAR_KEY) as Wear | null; if (w && WEARS.some((x) => x.id === w)) setWear(w); } catch { /* default: all */ }
  }, []);
  const chooseWear = (w: Wear) => { setWear(w); try { localStorage.setItem(WEAR_KEY, w); } catch { /* not kept */ } };

  const load = useCallback(async (type: EventType, who: Wear) => {
    setBusy(true); setError('');
    try {
      const r = await getOutfitFeed(type, who);
      setData(r); setQueue(r.outfits);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { expired(); return; }
      setError(err instanceof Error ? err.message : 'Could not get outfits.');
    } finally { setBusy(false); }
  }, [expired]);

  useEffect(() => { if (profile?.city) void load(occasion, wear); }, [profile?.city, occasion, wear, load]);

  const current = queue[0];
  const judge = useCallback(async (verdict: Verdict) => {
    if (!current || !data) return;
    setDx(verdict === 'LIKE' ? 600 : -600);
    const ctx = data.context;
    const rest = queue.slice(1);
    window.setTimeout(() => { setQueue(rest); setDx(0); }, 180);
    try {
      await sendOutfitFeedback(ctx, current, verdict);
      // refresh the "your taste" panel right away; the cards in hand stay as they are
      if (rest.length) getOutfitFeed(occasion, wear).then((r) => setData((d) => (d ? { ...d, taste: r.taste, tasteModel: r.tasteModel } : r))).catch(() => {});
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { expired(); return; }
      setError(err instanceof Error ? err.message : 'Could not save your choice.');
    }
    // the taste moved: when the stack runs out, the next batch is ranked with it and leaves out what was swiped
    if (!rest.length) void load(occasion, wear);
  }, [current, data, queue, expired, load, occasion, wear]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') void judge('LIKE');
      if (e.key === 'ArrowLeft') void judge('DISLIKE');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [judge]);

  const down = (e: ReactPointerEvent) => { start.current = e.clientX; setDragging(true); (e.target as Element).setPointerCapture?.(e.pointerId); };
  const move = (e: ReactPointerEvent) => { if (start.current !== null) setDx(e.clientX - start.current); };
  const up = () => {
    if (start.current === null) return;
    start.current = null; setDragging(false);
    if (dx > SWIPE) void judge('LIKE'); else if (dx < -SWIPE) void judge('DISLIKE'); else setDx(0);
  };

  function addToList(o: RecommendedOutfit) {
    const s = o.suggestion;
    if (!s) return;
    const key = `${s.type}:${s.dominantColor}`;
    if (list.some((e) => e.key === key)) return;
    const next = [...list, { key, type: s.type, color: s.dominantColor, reason: s.reason }];
    setList(next); writeList(next);
  }
  function removeFromList(key: string) {
    const next = list.filter((e) => e.key !== key);
    setList(next); writeList(next);
  }

  const w = data?.context.weather;
  return <main className="profile-main looks-main">
    <div className="profile-heading"><div><span className="profile-kicker">FOR YOU</span><h1>Looks</h1>
      <p>Outfits from your own wardrobe. Swipe right if you like one, left if not — the next ones follow your taste.</p></div>
      <Link className="account-settings-link" href="/events">Events →</Link></div>
    {loading ? <p role="status" className="profile-loading">Loading…</p>
      : !profile ? <section className="profile-panel"><p role="alert">{profileError}</p><button className="secondary" onClick={retry}>Try again</button></section>
      : !profile.city ? <section className="profile-panel"><p>Set your city in the <Link href="/profile/settings">profile settings</Link>: outfits follow the weather there.</p></section>
      : <div className="looks-layout">
        <div className="looks-feed">
          <div className="looks-wear" role="radiogroup" aria-label="Clothes for">{WEARS.map((x) => <button key={x.id} role="radio" aria-checked={x.id === wear}
            className={x.id === wear ? 'on' : ''} onClick={() => chooseWear(x.id)}>{x.label}</button>)}</div>
          <div className="looks-chips" role="tablist" aria-label="Occasion">{OCCASIONS.map((t) => <button key={t} role="tab" aria-selected={t === occasion}
            className={t === occasion ? 'on' : ''} onClick={() => setOccasion(t)}>{EVENT_LABELS[t]}</button>)}</div>
          {w && <p className="looks-weather">{data?.context.location} · {formatTemp(w.temperatureC)} · {w.description}</p>}
          {error && <p role="alert" className="looks-error">{error}</p>}
          <div className="looks-stack">
            {current ? <>
              {queue[1] && <div className="looks-card looks-card-next" aria-hidden />}
              <Card key={current.key} outfit={current} wear={wear} view={view} onView={setView} dx={dx} dragging={dragging} onPointerDown={down} onPointerMove={move} onPointerUp={up} />
            </> : busy ? <p role="status" className="looks-empty">Picking outfits…</p>
              : <div className="looks-empty">
                <p>{data?.status === 'NO_VALID_OUTFITS' ? (data.warnings.at(-1) ?? 'No outfit fits this occasion yet.') : 'You have seen every outfit for this occasion.'}</p>
                <p>Try another occasion, or add clothes to your <Link href="/profile">wardrobe</Link>.</p>
              </div>}
          </div>
          {current && <div className="looks-actions">
            <button className="looks-btn nope" onClick={() => void judge('DISLIKE')} aria-label="Not for me (left arrow)">✕</button>
            <Link className="looks-btn try" href={fittingHref(current.items)}>Try in 3D</Link>
            <button className="looks-btn like" onClick={() => void judge('LIKE')} aria-label="I like it (right arrow)">♥</button>
          </div>}
          {current && <Suggestion outfit={current} added={list.some((e) => e.key === `${current.suggestion?.type}:${current.suggestion?.dominantColor}`)} onAdd={() => addToList(current)} wear={wear} />}
          <p className="looks-hint">Drag the card, use the buttons, or press ← / → on a keyboard.</p>
        </div>
        <aside className="looks-side">
          <section className="profile-panel"><TasteSummary taste={data?.taste} /><ModelSummary model={data?.tasteModel} votes={data?.taste?.votes ?? 0} /></section>
          <section className="profile-panel looks-list">
            <span className="looks-taste-title">Shopping list</span>
            {list.length ? <ul>{list.map((e) => <li key={e.key}>
              <ProductPicture type={e.type} hex={colorById(e.color)?.hex ?? '#ccc'} />
              <span><b>{itemName(e.type, e.color)}</b><small>{e.reason}</small></span>
              <button className="looks-remove" onClick={() => removeFromList(e.key)} aria-label={`Remove ${itemName(e.type, e.color)}`}>×</button>
            </li>)}</ul> : <p className="looks-taste-empty">Items that would complete your outfits appear under each card. Add them here.</p>}
          </section>
        </aside>
      </div>}
  </main>;
}
