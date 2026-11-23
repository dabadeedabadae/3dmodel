'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError, EventInput, EventType, EventWeather, UserEvent, WeatherReport, clearToken, createEvent, deleteEvent,
  getEvents, getWeather, updateEvent,
} from '../../lib/api';
import { EVENT_HINTS, EVENT_LABELS, formatTemp, weatherIcon } from '../../lib/labels';
import { useProfile } from '../profile/use-profile';
import { OutfitSuggestions, SavedOutfits } from './Outfits';

const EVENT_TYPES = Object.keys(EVENT_LABELS) as EventType[];
const pad = (n: number) => String(n).padStart(2, '0');
/** ISO instant → value of <input type="datetime-local"> in the browser's time zone */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultStart() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

export default function EventsPage() {
  const router = useRouter();
  const { profile, loading, error, retry } = useProfile(true);
  const expired = useCallback(() => { clearToken(); router.replace('/login'); }, [router]);
  const [savedVersion, setSavedVersion] = useState(0);
  const bump = useCallback(() => setSavedVersion((v) => v + 1), []);
  return <main className="profile-main">
    <div className="profile-heading"><div><span className="profile-kicker">PLANS</span><h1>Events & weather</h1><p>Plan your occasions: each one gets the forecast for its time and city, so outfits can match both.</p></div><Link className="account-settings-link" href={profile?.isAdmin ? '/admin' : '/profile'}>← Back to account</Link></div>
    {loading ? <p role="status" className="profile-loading">Loading…</p> : !profile ? <section className="profile-panel"><p role="alert">{error}</p><button className="secondary" onClick={retry}>Try again</button></section> : <>
      <WeatherPanel profileCity={profile.city} onAuthExpired={expired} />
      {profile.city && <NowPanel onAuthExpired={expired} onSaved={bump} />}
      <EventsPanel profileCity={profile.city} onAuthExpired={expired} onSaved={bump} />
      <SavedOutfits version={savedVersion} onAuthExpired={expired} />
    </>}
  </main>;
}

function WeatherPanel({ profileCity, onAuthExpired }: { profileCity: string | null; onAuthExpired: () => void }) {
  const [city, setCity] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<WeatherReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!city && !profileCity) return;
    let active = true;
    setBusy(true); setError('');
    getWeather(city).then((r) => { if (active) setReport(r); }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setError(err instanceof Error ? err.message : 'Could not load the weather.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [city, profileCity, onAuthExpired]);
  function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (q) setCity(q);
  }
  return <section className="profile-panel weather-panel" aria-labelledby="weather-title">
    <div className="wardrobe-head"><div><span className="profile-kicker">WEATHER</span><h2 id="weather-title">{report ? [report.location.name, report.location.country].filter(Boolean).join(', ') : 'Weather'}</h2>
      <p>{report ? (city ? 'Another city' : 'Your city from the profile') + ' · forecast by Open-Meteo' : 'Current weather and the forecast for the next days.'}</p></div>
      <form className="weather-search" onSubmit={search}><input aria-label="City" maxLength={100} placeholder="Another city…" value={query} onChange={(e) => setQuery(e.target.value)} /><button className="wardrobe-add-btn" disabled={busy || !query.trim()}>Show</button>{city && <button type="button" className="profile-reset" onClick={() => { setCity(undefined); setQuery(''); if (!profileCity) setReport(null); }}>My city</button>}</form>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!profileCity && !city ? <div className="wardrobe-empty"><strong>No city in your profile</strong><p>Add your city to see the weather and forecasts for your events.</p><Link className="account-settings-link" href="/profile/settings">Set city →</Link></div>
      : !report ? (busy && <p className="profile-loading" role="status">Loading weather…</p>) : <div className={`weather-body${busy ? ' is-busy' : ''}`}>
        <div className="weather-now"><span className="weather-icon" aria-hidden>{weatherIcon(report.current.weatherCode)}</span><div><strong>{formatTemp(report.current.temperatureC)}</strong><p>{report.current.description}</p></div></div>
        <ol className="weather-days" aria-label="Daily forecast">{report.daily.slice(0, 7).map((d, i) => <li key={d.date}>
          <span>{i === 0 ? 'Today' : new Date(d.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' })}</span>
          <i aria-label={d.description} title={d.description}>{weatherIcon(d.weatherCode)}</i>
          <b>{formatTemp(d.maxC)}</b><small>{formatTemp(d.minC)}</small>
          {d.precipitationProbability !== null && d.precipitationProbability > 0 && <em>{d.precipitationProbability}%</em>}
        </li>)}</ol>
      </div>}
  </section>;
}

/** What to wear right now: an occasion + the current weather in the profile city. */
function NowPanel({ onAuthExpired, onSaved }: { onAuthExpired: () => void; onSaved: () => void }) {
  const [occasion, setOccasion] = useState<EventType>('CASUAL');
  const [asked, setAsked] = useState<EventType | null>(null);
  return <section className="profile-panel wardrobe" aria-labelledby="now-title">
    <div className="wardrobe-head"><div><span className="profile-kicker">RIGHT NOW</span><h2 id="now-title">What to wear today</h2><p>Pick an occasion: outfits from your wardrobe for the current weather in your city.</p></div>
      <div className="weather-search"><select aria-label="Occasion" value={occasion} onChange={(e) => setOccasion(e.target.value as EventType)}>{EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABELS[t]}</option>)}</select><button type="button" className="wardrobe-add-btn" onClick={() => setAsked(occasion)}>Suggest</button></div></div>
    {asked && <OutfitSuggestions key={asked} target={{ eventType: asked }} onAuthExpired={onAuthExpired} onSaved={onSaved} />}
  </section>;
}

function EventsPanel({ profileCity, onAuthExpired, onSaved }: { profileCity: string | null; onAuthExpired: () => void; onSaved: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [events, setEvents] = useState<UserEvent[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<UserEvent | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');
  useEffect(() => {
    let active = true;
    setEvents(null); setLoadError('');
    getEvents(scope).then((list) => { if (active) setEvents(list); }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setLoadError(err instanceof Error ? err.message : 'Could not load your events.');
    });
    return () => { active = false; };
  }, [scope, attempt, onAuthExpired]);

  function saved(event: UserEvent) {
    setEditing(null);
    const isPast = new Date(event.startsAt).getTime() < Date.now() - 3 * 3600_000;
    if ((scope === 'past') !== isPast) { setScope(isPast ? 'past' : 'upcoming'); setAttempt((v) => v + 1); return; }
    setEvents((list) => {
      const rest = (list ?? []).filter((e) => e.id !== event.id);
      const sorted = [...rest, event].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return scope === 'past' ? sorted.reverse() : sorted;
    });
  }
  async function remove(event: UserEvent) {
    if (!window.confirm(`Delete the event "${event.title}"?`)) return;
    setBusyId(event.id); setRowError('');
    try {
      await deleteEvent(event.id);
      setEvents((list) => list?.filter((e) => e.id !== event.id) ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setRowError(err instanceof Error ? err.message : 'Could not delete the event.');
    } finally { setBusyId(null); }
  }

  return <section className="profile-panel wardrobe" aria-labelledby="events-title">
    <div className="wardrobe-head"><div><span className="profile-kicker">EVENTS</span><h2 id="events-title">My events</h2><p>Meetings, workouts, parties, trips. The forecast appears up to 16 days ahead.</p></div>
      {!editing && <button type="button" className="wardrobe-add-btn" onClick={() => setEditing('new')}>+ Add event</button>}</div>
    {editing && <EventForm key={editing === 'new' ? 'new' : editing.id} event={editing === 'new' ? null : editing} profileCity={profileCity} onCancel={() => setEditing(null)} onSaved={saved} onAuthExpired={onAuthExpired} />}
    <div className="wardrobe-filters" role="group" aria-label="Which events">
      <button type="button" className={scope === 'upcoming' ? 'is-active' : ''} aria-pressed={scope === 'upcoming'} onClick={() => setScope('upcoming')}>Upcoming</button>
      <button type="button" className={scope === 'past' ? 'is-active' : ''} aria-pressed={scope === 'past'} onClick={() => setScope('past')}>Past</button>
    </div>
    {rowError && <p className="error" role="alert">{rowError}</p>}
    {loadError ? <div className="wardrobe-empty" role="alert"><p>{loadError}</p><button className="secondary" onClick={() => setAttempt((v) => v + 1)}>Try again</button></div>
      : !events ? <p className="profile-loading" role="status">Loading events…</p>
      : events.length === 0 ? <div className="wardrobe-empty"><strong>{scope === 'upcoming' ? 'No upcoming events' : 'No past events'}</strong><p>{scope === 'upcoming' ? 'Add a meeting, a workout or a party to plan what to wear.' : 'Events you had will appear here.'}</p></div>
      : <ul className="events-list">{events.map((e) => {
        const d = new Date(e.startsAt);
        return <li key={e.id} className={`event-card${busyId === e.id ? ' is-busy' : ''}`}>
          <div className="event-date" aria-hidden><b>{d.getDate()}</b><span>{d.toLocaleDateString('en-US', { month: 'short' })}</span><small>{d.toLocaleDateString('en-US', { weekday: 'short' })}</small></div>
          <div className="event-info">
            <div className="event-title-row"><strong>{e.title}</strong><span className={`event-type type-${e.eventType.toLowerCase()}`}>{EVENT_LABELS[e.eventType]}</span></div>
            <p className="event-when">{d.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{e.city ? ` · ${e.city}` : ''}</p>
            {e.note && <p className="event-note">{e.note}</p>}
            {e.weather && <WeatherBadge weather={e.weather} />}
          </div>
          <div className="event-actions">{e.weather?.status === 'FORECAST' && <button type="button" className="is-primary" aria-expanded={openId === e.id} onClick={() => setOpenId(openId === e.id ? null : e.id)}>{openId === e.id ? 'Hide outfits' : 'Suggest outfits'}</button>}<button type="button" disabled={!!busyId} onClick={() => setEditing(e)}>Edit</button><button type="button" disabled={!!busyId} onClick={() => remove(e)}>Delete</button></div>
          {openId === e.id && <div className="event-outfits"><OutfitSuggestions target={{ eventId: e.id }} onAuthExpired={onAuthExpired} onSaved={onSaved} /></div>}
        </li>;
      })}</ul>}
  </section>;
}

function WeatherBadge({ weather: w }: { weather: EventWeather }) {
  if (w.status === 'FORECAST') {
    return <p className="event-weather is-forecast"><span aria-hidden>{weatherIcon(w.weatherCode)}</span><b>{formatTemp(w.temperatureC)}</b>{w.description}<small>{w.location}</small></p>;
  }
  const text = w.status === 'TOO_FAR' ? `Forecast will appear on ${w.forecastFrom ? new Date(w.forecastFrom + 'T12:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : 'a later date'}`
    : w.status === 'PAST' ? 'This event has already started'
    : w.status === 'NO_CITY' ? 'Set a city in your profile or for the event to see the weather'
    : w.status === 'CITY_NOT_FOUND' ? `City "${w.city}" was not found`
    : 'The weather is unavailable right now';
  return <p className="event-weather">{text}{w.status === 'NO_CITY' && <> · <Link href="/profile/settings">Set city</Link></>}</p>;
}

function EventForm({ event, profileCity, onCancel, onSaved, onAuthExpired }: {
  event: UserEvent | null; profileCity: string | null;
  onCancel: () => void; onSaved: (event: UserEvent) => void; onAuthExpired: () => void;
}) {
  const [form, setForm] = useState({
    title: event?.title ?? '', eventType: event?.eventType ?? ('CASUAL' as EventType),
    startsAt: event ? toLocalInput(event.startsAt) : defaultStart(), city: event?.city ?? '', note: event?.note ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    const start = new Date(form.startsAt);
    if (!form.title.trim()) { setError('Give the event a name.'); return; }
    if (!form.startsAt || Number.isNaN(start.getTime())) { setError('Choose the date and time.'); return; }
    const input: EventInput = { ...form, startsAt: start.toISOString() };
    setSaving(true);
    try {
      onSaved(event ? await updateEvent(event.id, input) : await createEvent(input));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onAuthExpired(); return; }
      setError(err instanceof Error ? err.message : 'Could not save the event.');
      setSaving(false);
    }
  }
  return <form className="event-form profile-form-panel" onSubmit={submit}><fieldset className="profile-fieldset" disabled={saving}>
    <div className="field"><label htmlFor="event-title">Name</label><input id="event-title" maxLength={100} required placeholder="e.g. Job interview" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
    <div className="field"><span className="event-form-label">Occasion</span><div className="event-type-picker" role="radiogroup" aria-label="Occasion">{EVENT_TYPES.map((t) => <button key={t} type="button" role="radio" aria-checked={form.eventType === t} className={form.eventType === t ? 'is-active' : ''} onClick={() => setForm({ ...form, eventType: t })}><b>{EVENT_LABELS[t]}</b><small>{EVENT_HINTS[t]}</small></button>)}</div></div>
    <div className="profile-form-row"><div className="field"><label htmlFor="event-start">Date and time</label><input id="event-start" type="datetime-local" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></div>
      <div className="field"><label htmlFor="event-city">City</label><input id="event-city" maxLength={100} placeholder={profileCity ? `${profileCity} (from profile)` : 'e.g. London'} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /><small>Leave empty to use the city from your profile.</small></div></div>
    <div className="field"><label htmlFor="event-note">Note</label><textarea id="event-note" rows={3} maxLength={300} placeholder="Dress code, place, anything to remember…" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /><small>{form.note.length}/300</small></div>
  </fieldset>{error && <p className="error" role="alert">{error}</p>}<div className="profile-save-row"><button className="primary" disabled={saving}>{saving ? 'Saving…' : event ? 'Save changes' : 'Add event'}</button><button type="button" className="profile-reset" disabled={saving} onClick={onCancel}>Cancel</button></div></form>;
}
