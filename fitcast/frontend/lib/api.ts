import type { GarmentPackage } from './garment/analyze';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'fitcast_token';

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
  isAdmin: boolean;
}

export interface AdminOverview {
  users: number;
  wardrobeItems: number;
  savedOutfits: number;
}

export interface AdminUser extends AuthUser {
  isAdmin: boolean;
  _count: { wardrobeItems: number; savedOutfits: number };
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

async function adminGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'Please log in to continue.');
  const response = await fetch(`${API_URL}/admin/${path}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal,
  });
  if (!response.ok) {
    throw new ApiError(response.status, response.status === 403
      ? 'Administrator access required.' : response.status === 401
      ? 'Your session has expired. Please log in again.' : 'Could not load administration data.');
  }
  return response.json();
}

export const getAdminOverview = (signal?: AbortSignal) => adminGet<AdminOverview>('overview', signal);
export const getAdminUsers = (signal?: AbortSignal) => adminGet<AdminUser[]>('users', signal);
export interface AdminGarment {
  id: string; type: string; dominantColor: string; fitTag: string; imageUrl: string; createdAt: string;
  user: { email: string };
}
export interface AdminOutfit {
  id: string; name: string; eventType: string; createdAt: string;
  user: { email: string }; _count: { items: number };
}
export const getAdminWardrobe = (signal?: AbortSignal) => adminGet<AdminGarment[]>('wardrobe', signal);
export const getAdminOutfits = (signal?: AbortSignal) => adminGet<AdminOutfit[]>('outfits', signal);

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message ?? `Request failed with status ${res.status}`);
  }

  return res.json();
}

export function register(email: string, password: string) {
  return request<AuthResponse>('/auth/register', { email, password });
}

export function login(email: string, password: string) {
  return request<AuthResponse>('/auth/login', { email, password });
}

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new Event('fitcast-profile-updated'));
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event('fitcast-profile-updated'));
}

export async function getProfile(): Promise<UserProfile> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'Please sign in.');

  const res = await fetch(`${API_URL}/users/me`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new ApiError(res.status, res.status === 401 ? 'Your session has expired. Please sign in again.' : 'Could not load the profile.');
  }

  return res.json();
}

export interface UserProfile extends AuthUser {
  name: string | null; city: string | null; bio: string | null; updatedAt: string;
  _count?: { wardrobeItems: number; savedOutfits: number };
}
export interface ProfileChanges { name: string; city: string; bio: string }
export async function updateProfile(changes: ProfileChanges): Promise<UserProfile> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'Please sign in.');
  const response = await fetch(API_URL + '/users/me', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(changes),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
    throw new ApiError(response.status, message || 'Could not save the profile.');
  }
  return response.json();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'Please sign in.');
  const response = await fetch(API_URL + '/users/me/password', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
    throw new ApiError(response.status, message || 'Could not change the password.');
  }
}

/* ---------- Wardrobe ---------- */

export type GarmentType = 'TSHIRT' | 'SHIRT' | 'JACKET' | 'COAT' | 'SWEATER' | 'HOODIE' | 'CARDIGAN' | 'BLAZER' | 'PANTS' | 'JEANS' | 'SHORTS' | 'SKIRT' | 'DRESS' | 'SHOES' | 'ACCESSORY';
export type FitTag = 'GOOD' | 'TIGHT' | 'LOOSE';
export type EventType = 'CASUAL' | 'GYM' | 'BUSINESS' | 'FORMAL' | 'OUTDOOR' | 'DATE' | 'WEDDING_GUEST' | 'INTERVIEW'
  | 'PARTY' | 'THEATER' | 'TRAVEL' | 'STUDY' | 'FAMILY_WALK';
export type Precipitation = 'NONE' | 'RAIN' | 'SNOW' | 'MIXED';

export interface WardrobeItem {
  id: string; type: GarmentType; dominantColor: string; fitTag: FitTag; imageUrl: string;
  /** photo → 3D package (on-device analysis), with the texture; null when the photo was not analysed */
  garment3d: GarmentPackage | null; textureUrl: string | null;
  attributes?: ItemAttributes | null;
  createdAt: string; updatedAt: string;
}

/** Absolute URL of a stored upload (the API serves /uploads/...). */
export const mediaUrl = (path: string) => (path.startsWith('/uploads/') ? API_URL + path : path);

async function authed<T>(path: string, init: RequestInit = {}, fallback = 'The request failed.'): Promise<T> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'Please sign in.');
  const response = await fetch(API_URL + path, {
    ...init, cache: 'no-store', headers: { ...(init.headers ?? {}), Authorization: 'Bearer ' + token },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
    throw new ApiError(response.status, response.status === 401 ? 'Your session has expired. Please sign in again.' : message || fallback);
  }
  return response.json();
}

export const getWardrobe = () => authed<WardrobeItem[]>('/wardrobe', {}, 'Could not load your wardrobe.');

/** what the photo says beyond type and main colour (I-77), read on the device; used by the recommendations */
export interface ItemAttributes { pattern?: 'solid' | 'pattern'; secondaryColor?: string; sleeve?: 'short' | 'long'; tone?: 'light' | 'mid' | 'dark' }

export function addWardrobeItem(image: Blob, fields: { type: GarmentType; dominantColor: string; fitTag: FitTag }, model?: { pkg: GarmentPackage; texture: Blob }, attributes?: ItemAttributes) {
  const body = new FormData();
  body.append('type', fields.type);
  body.append('dominantColor', fields.dominantColor);
  body.append('fitTag', fields.fitTag);
  body.append('image', image, 'garment');
  if (model) { body.append('garment3d', JSON.stringify(model.pkg)); body.append('texture', model.texture, 'texture.jpg'); }
  // only the known keys with a value: the API rejects anything else
  if (attributes) {
    const clean = Object.fromEntries(Object.entries(attributes).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length) body.append('attributes', JSON.stringify(clean));
  }
  return authed<WardrobeItem>('/wardrobe', { method: 'POST', body }, 'Could not add the item.');
}

export const updateWardrobeItem = (id: string, changes: Partial<Pick<WardrobeItem, 'type' | 'dominantColor' | 'fitTag'>>) =>
  authed<WardrobeItem>('/wardrobe/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes),
  }, 'Could not save the changes.');

export const deleteWardrobeItem = (id: string) =>
  authed<{ id: string }>('/wardrobe/' + id, { method: 'DELETE' }, 'Could not remove the item.');

/* ---------- Admin: recommendation test bench ---------- */

export interface RecommendationTestInput {
  userId: string; temperatureC: number; precipitation: Precipitation; eventType: EventType; limit: number;
}
export interface RecommendationTestResult {
  payload: unknown;
  service: null | { url: string; status: number; ms: number; body: unknown };
}
export const runRecommendationTest = (input: RecommendationTestInput) =>
  authed<RecommendationTestResult>('/admin/recommendations/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }, 'Could not run the test.');

/* ---------- Weather (Open-Meteo through the API) ---------- */

export interface WeatherLocation { name: string; country: string | null; latitude: number; longitude: number; timezone: string }
export interface DailyWeather {
  date: string; minC: number; maxC: number; weatherCode: number; precipitation: Precipitation;
  precipitationProbability: number | null; description: string;
}
export interface WeatherReport {
  city: string; fromProfile: boolean; location: WeatherLocation;
  current: { time: string; temperatureC: number; weatherCode: number; precipitation: Precipitation; description: string };
  daily: DailyWeather[];
  recommendationWeather: { temperatureC: number; precipitation: Precipitation };
}
/** without `city` the city from the profile is used */
export const getWeather = (city?: string) =>
  authed<WeatherReport>('/weather' + (city ? '?city=' + encodeURIComponent(city) : ''), {}, 'Could not load the weather.');

/* ---------- Events ---------- */

export type EventWeather =
  | { status: 'FORECAST'; city: string; cityFromProfile: boolean; location: string; temperatureC: number;
      precipitation: Precipitation; weatherCode: number; description: string;
      recommendationInput: { weather: { temperatureC: number; precipitation: Precipitation }; eventType: EventType } }
  | { status: 'PAST' | 'TOO_FAR'; city: string; cityFromProfile: boolean; location: string; forecastFrom?: string }
  | { status: 'NO_CITY' }
  | { status: 'CITY_NOT_FOUND' | 'UNAVAILABLE'; city: string; cityFromProfile: boolean };

export interface UserEvent {
  id: string; title: string; eventType: EventType; startsAt: string; city: string | null; note: string | null;
  createdAt: string; updatedAt: string;
  /** null for past events */
  weather: EventWeather | null;
}
export interface EventInput { title: string; eventType: EventType; startsAt: string; city: string; note: string }

export const getEvents = (scope: 'upcoming' | 'past' = 'upcoming') =>
  authed<UserEvent[]>('/events?scope=' + scope, {}, 'Could not load your events.');
export const createEvent = (input: EventInput) =>
  authed<UserEvent>('/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }, 'Could not add the event.');
export const updateEvent = (id: string, input: Partial<EventInput>) =>
  authed<UserEvent>('/events/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }, 'Could not save the event.');
export const deleteEvent = (id: string) =>
  authed<{ id: string }>('/events/' + id, { method: 'DELETE' }, 'Could not delete the event.');

/* ---------- Recommendations, feedback, saved outfits ---------- */

export type OutfitItem = Pick<WardrobeItem, 'id' | 'type' | 'dominantColor' | 'fitTag' | 'imageUrl'> & Partial<Pick<WardrobeItem, 'garment3d' | 'textureUrl'>>;
export type Verdict = 'LIKE' | 'DISLIKE';
/** an item the user does not own that would make the outfit better (I-77) */
export interface PurchaseSuggestion {
  type: GarmentType; dominantColor: string; replaces: string | null; score: number; gain: number; reason: string;
}
export interface RecommendedOutfit {
  key: string; items: OutfitItem[]; score: number; explanation: string;
  breakdown: {
    occasion: number; weather: number; color: number; fit: number | null; taste?: number | null;
    /** style factors (I-79): harmony, coherence, contrast, evening, freshness, wind — points and a short note */
    style?: number | null; factors?: StyleFactor[];
  };
  feedback: Verdict | null; savedOutfitId: string | null; suggestion?: PurchaseSuggestion | null;
}
export interface StyleFactor { key: string; points: number; note: string }
/** the model trained on the user's swipes (I-79): null until there are 8 with both likes and dislikes */
export interface TasteModelInfo { examples: number; likes: number; prefers: string[]; avoids: string[] }
/** learned from likes and dislikes: −1 … +1 per garment type and colour */
export interface Taste { types: Partial<Record<GarmentType, number>>; colors: Record<string, number>; votes: number }
export interface RecommendationContext {
  eventId: string | null; eventTitle: string | null; startsAt: string | null; eventType: EventType; location: string;
  weather: { temperatureC: number; precipitation: Precipitation; description: string; windKph?: number | null; hour?: number };
}
export interface Recommendations {
  context: RecommendationContext; status: 'OK' | 'NO_VALID_OUTFITS'; outfits: RecommendedOutfit[];
  hiddenDisliked: number; warnings: string[]; taste?: Taste; tasteModel?: TasteModelInfo | null;
}
/** for an event (its forecast), or for an occasion with the current weather in the profile city */
export const getRecommendations = (target: { eventId: string } | { eventType: EventType }, limit = 3) =>
  authed<Recommendations>('/recommendations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, limit }),
  }, 'Could not get outfit suggestions.');

/** the swipe feed: up to 10 outfits not judged yet for this occasion, each with a purchase suggestion */
export type Wear = 'men' | 'women' | 'all';
export const getOutfitFeed = (eventType: EventType, wear: Wear = 'all') =>
  authed<Recommendations>('/recommendations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType, feed: true, wear }),
  }, 'Could not get outfits.');

export const sendOutfitFeedback = (ctx: RecommendationContext, outfit: RecommendedOutfit, verdict: Verdict | null) =>
  authed<{ outfitKey: string; verdict: Verdict | null }>('/recommendations/feedback', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemIds: outfit.items.map((i) => i.id), eventId: ctx.eventId ?? undefined, eventType: ctx.eventType,
      temperatureC: ctx.weather.temperatureC, precipitation: ctx.weather.precipitation, score: outfit.score, verdict,
    }),
  }, 'Could not save your feedback.');

export interface SavedOutfit {
  id: string; name: string; eventType: EventType; explanation: string | null; createdAt: string;
  event: { id: string; title: string; startsAt: string } | null; items: OutfitItem[];
}
export const getSavedOutfits = () => authed<SavedOutfit[]>('/outfits', {}, 'Could not load your outfits.');
export const saveOutfit = (ctx: RecommendationContext, outfit: RecommendedOutfit) =>
  authed<SavedOutfit>('/outfits', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType: ctx.eventType, eventId: ctx.eventId ?? undefined, itemIds: outfit.items.map((i) => i.id),
      explanation: outfit.explanation, name: ctx.eventTitle ? `For "${ctx.eventTitle}"`.slice(0, 100) : undefined,
    }),
  }, 'Could not save the outfit.');
export const deleteSavedOutfit = (id: string) =>
  authed<{ id: string }>('/outfits/' + id, { method: 'DELETE' }, 'Could not delete the outfit.');