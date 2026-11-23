'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ApiError, EventType, OutfitItem, RecommendedOutfit, Recommendations, SavedOutfit, Verdict, deleteSavedOutfit,
  getRecommendations, getSavedOutfits, mediaUrl, saveOutfit, sendOutfitFeedback,
} from '../../lib/api';
import { EVENT_LABELS, GARMENT_LABELS, colorById, formatTemp } from '../../lib/labels';

const INNER_TOPS = ['TSHIRT', 'SHIRT', 'SWEATER', 'HOODIE', 'CARDIGAN', 'DRESS'];
const LAYERS = ['BLAZER', 'JACKET', 'COAT'];
const BOTTOMS = ['PANTS', 'JEANS', 'SHORTS', 'SKIRT'];

/** /fitting shows one top and one bottom: the inner top (or the layer when there is none) and the bottom. */
export function fittingHref(items: OutfitItem[]) {
  const top = items.find((i) => INNER_TOPS.includes(i.type)) ?? items.find((i) => LAYERS.includes(i.type));
  const bottom = items.find((i) => BOTTOMS.includes(i.type));
  const q = new URLSearchParams();
  if (top) q.set('top', top.id);
  if (bottom) q.set('bottom', bottom.id);
  return '/fitting?' + q.toString();
}

function ItemStrip({ items }: { items: OutfitItem[] }) {
  return <ul className="outfit-items">{items.map((i) => {
    const color = colorById(i.dominantColor);
    return <li key={i.id} title={`${color?.label ?? i.dominantColor} ${GARMENT_LABELS[i.type].toLowerCase()}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- user uploads served by the API */}
      <img src={mediaUrl(i.imageUrl)} alt="" loading="lazy" />
      <span><i style={{ background: color?.hex ?? '#ccc' }} aria-hidden />{GARMENT_LABELS[i.type]}</span>
    </li>;
  })}</ul>;
}

/** Suggested outfits for an event (its forecast) or an occasion (the weather now), with feedback and saving. */
export function OutfitSuggestions({ target, onAuthExpired, onSaved }: {
  target: { eventId: string } | { eventType: EventType };
  onAuthExpired: () => void; onSaved?: () => void;
}) {
  const [limit, setLimit] = useState(3);
  const [data, setData] = useState<Recommendations | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [hidden, setHidden] = useState<RecommendedOutfit[]>([]);
  const targetKey = JSON.stringify(target);
  useEffect(() => {
    let active = true;
    setError(''); setHidden([]);
    getRecommendations(JSON.parse(targetKey), limit).then((r) => { if (active) setData(r); }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setError(err instanceof Error ? err.message : 'Could not get outfit suggestions.');
    });
    return () => { active = false; };
  }, [targetKey, limit, onAuthExpired]);

  function patch(key: string, change: Partial<RecommendedOutfit>) {
    setData((d) => d && { ...d, outfits: d.outfits.map((o) => (o.key === key ? { ...o, ...change } : o)) });
  }
  async function act(outfit: RecommendedOutfit, run: () => Promise<void>) {
    setBusy(outfit.key); setActionError('');
    try { await run(); } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setActionError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally { setBusy(null); }
  }
  const vote = (o: RecommendedOutfit, verdict: Verdict) => act(o, async () => {
    const next = o.feedback === verdict ? null : verdict;
    await sendOutfitFeedback(data!.context, o, next);
    if (next === 'DISLIKE') {
      setHidden((h) => [...h, { ...o, feedback: 'DISLIKE' }]);
      setData((d) => d && { ...d, outfits: d.outfits.filter((x) => x.key !== o.key) });
    } else patch(o.key, { feedback: next });
  });
  const undoDislike = (o: RecommendedOutfit) => act(o, async () => {
    await sendOutfitFeedback(data!.context, o, null);
    setHidden((h) => h.filter((x) => x.key !== o.key));
    setData((d) => d && { ...d, outfits: [...d.outfits, { ...o, feedback: null }].sort((a, b) => b.score - a.score) });
  });
  const save = (o: RecommendedOutfit) => act(o, async () => {
    const saved = await saveOutfit(data!.context, o);
    patch(o.key, { savedOutfitId: saved.id });
    onSaved?.();
  });

  if (error) return <div className="outfit-panel"><p className="event-weather" role="alert">{error}</p></div>;
  if (!data) return <div className="outfit-panel"><p className="profile-loading" role="status">Picking outfits…</p></div>;
  const c = data.context;
  return <div className="outfit-panel" aria-live="polite">
    <p className="outfit-context"><b>{EVENT_LABELS[c.eventType]}</b> · {formatTemp(c.weather.temperatureC)}, {c.weather.description.toLowerCase()} · {c.location}</p>
    {data.warnings.map((w) => <p key={w} className="outfit-warning">{w}</p>)}
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {data.outfits.length === 0 ? <p className="outfit-empty">No outfit from your wardrobe fits this occasion and weather yet.{' '}
      <Link href="/profile">Add items →</Link></p>
      : <ol className="outfit-list">{data.outfits.map((o, n) => <li key={o.key} className={`outfit-card${busy === o.key ? ' is-busy' : ''}`}>
        <div className="outfit-head"><span className="outfit-rank">#{n + 1}</span><span className="outfit-score" title="Rule-based match score, not a guarantee">{Math.round(o.score)}<small>/100</small></span></div>
        <ItemStrip items={o.items} />
        <p className="outfit-why">{o.explanation}</p>
        <p className="outfit-breakdown"><span>Occasion {Math.round(o.breakdown.occasion)}</span><span>Weather {Math.round(o.breakdown.weather)}</span><span>Colors {Math.round(o.breakdown.color)}</span></p>
        <div className="outfit-actions">
          <button type="button" disabled={!!busy} aria-pressed={o.feedback === 'LIKE'} className={o.feedback === 'LIKE' ? 'is-like' : ''} onClick={() => vote(o, 'LIKE')}>👍 Fits</button>
          <button type="button" disabled={!!busy} onClick={() => vote(o, 'DISLIKE')}>👎 Doesn&apos;t fit</button>
          <button type="button" disabled={!!busy || !!o.savedOutfitId} onClick={() => save(o)}>{o.savedOutfitId ? '✓ Saved' : 'Save outfit'}</button>
          <Link href={fittingHref(o.items)}>Try on in 3D ↗</Link>
        </div>
      </li>)}</ol>}
    {hidden.map((o) => <p key={o.key} className="outfit-hidden">Outfit hidden for this {c.eventId ? 'event' : 'occasion'}. <button type="button" disabled={!!busy} onClick={() => undoDislike(o)}>Undo</button></p>)}
    {data.hiddenDisliked > 0 && !hidden.length && <p className="outfit-hidden">{data.hiddenDisliked} outfit(s) you marked as &quot;doesn&apos;t fit&quot; are hidden.</p>}
    {limit < 5 && data.outfits.length >= limit && <button type="button" className="outfit-more" onClick={() => setLimit(5)}>Show more options</button>}
  </div>;
}

/** The user's saved outfits, newest first. */
export function SavedOutfits({ version, onAuthExpired }: { version: number; onAuthExpired: () => void }) {
  const [outfits, setOutfits] = useState<SavedOutfit[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getSavedOutfits().then((list) => { if (active) setOutfits(list); }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setError(err instanceof Error ? err.message : 'Could not load your outfits.');
    });
    return () => { active = false; };
  }, [version, onAuthExpired]);
  async function remove(o: SavedOutfit) {
    if (!window.confirm(`Delete the saved outfit "${o.name}"? The items stay in your wardrobe.`)) return;
    setBusyId(o.id); setError('');
    try {
      await deleteSavedOutfit(o.id);
      setOutfits((list) => list?.filter((x) => x.id !== o.id) ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setError(err instanceof Error ? err.message : 'Could not delete the outfit.');
    } finally { setBusyId(null); }
  }
  return <section className="profile-panel wardrobe" aria-labelledby="saved-title">
    <div className="wardrobe-head"><div><span className="profile-kicker">OUTFITS</span><h2 id="saved-title">Saved outfits</h2><p>Outfits you kept from the suggestions, with the event they were for.</p></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {!outfits ? !error && <p className="profile-loading" role="status">Loading outfits…</p>
      : outfits.length === 0 ? <div className="wardrobe-empty"><strong>No saved outfits yet</strong><p>Open &quot;Suggest outfits&quot; on an event and save the ones you like.</p></div>
      : <ul className="outfit-list saved">{outfits.map((o) => <li key={o.id} className={`outfit-card${busyId === o.id ? ' is-busy' : ''}`}>
        <div className="outfit-head"><strong>{o.name}</strong><span className={`event-type type-${o.eventType.toLowerCase()}`}>{EVENT_LABELS[o.eventType]}</span></div>
        {o.event && <p className="event-when">{o.event.title} · {new Date(o.event.startsAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
        <ItemStrip items={o.items} />
        {o.explanation && <p className="outfit-why">{o.explanation}</p>}
        <div className="outfit-actions"><Link href={fittingHref(o.items)}>Try on in 3D ↗</Link><button type="button" disabled={!!busyId} onClick={() => remove(o)}>Delete</button></div>
      </li>)}</ul>}
  </section>;
}
