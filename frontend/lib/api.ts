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
  if (!token) throw new ApiError(401, 'Войдите в аккаунт.');

  const res = await fetch(`${API_URL}/users/me`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new ApiError(res.status, res.status === 401 ? 'Сессия истекла. Войдите снова.' : 'Не удалось загрузить профиль.');
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
  if (!token) throw new ApiError(401, 'Войдите в аккаунт.');
  const response = await fetch(API_URL + '/users/me', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(changes),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
    throw new ApiError(response.status, message || 'Не удалось сохранить профиль.');
  }
  return response.json();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'Войдите в аккаунт.');
  const response = await fetch(API_URL + '/users/me/password', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
    throw new ApiError(response.status, message || 'Не удалось изменить пароль.');
  }
}

/* ---------- Wardrobe ---------- */

export type GarmentType = 'TSHIRT' | 'SHIRT' | 'JACKET' | 'COAT' | 'SWEATER' | 'HOODIE' | 'PANTS' | 'JEANS' | 'SHORTS' | 'SKIRT' | 'DRESS' | 'SHOES' | 'ACCESSORY';
export type FitTag = 'GOOD' | 'TIGHT' | 'LOOSE';
export type EventType = 'CASUAL' | 'GYM' | 'BUSINESS' | 'FORMAL' | 'OUTDOOR';
export type Precipitation = 'NONE' | 'RAIN' | 'SNOW' | 'MIXED';

export interface WardrobeItem {
  id: string; type: GarmentType; dominantColor: string; fitTag: FitTag; imageUrl: string;
  /** photo → 3D package (on-device analysis), with the texture; null when the photo was not analysed */
  garment3d: GarmentPackage | null; textureUrl: string | null;
  createdAt: string; updatedAt: string;
}

/** Absolute URL of a stored upload (the API serves /uploads/...). */
export const mediaUrl = (path: string) => (path.startsWith('/uploads/') ? API_URL + path : path);

async function authed<T>(path: string, init: RequestInit = {}, fallback = 'Запрос не выполнен.'): Promise<T> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'Войдите в аккаунт.');
  const response = await fetch(API_URL + path, {
    ...init, cache: 'no-store', headers: { ...(init.headers ?? {}), Authorization: 'Bearer ' + token },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
    throw new ApiError(response.status, response.status === 401 ? 'Сессия истекла. Войдите снова.' : message || fallback);
  }
  return response.json();
}

export const getWardrobe = () => authed<WardrobeItem[]>('/wardrobe', {}, 'Не удалось загрузить гардероб.');

export function addWardrobeItem(image: Blob, fields: { type: GarmentType; dominantColor: string; fitTag: FitTag }, model?: { pkg: GarmentPackage; texture: Blob }) {
  const body = new FormData();
  body.append('type', fields.type);
  body.append('dominantColor', fields.dominantColor);
  body.append('fitTag', fields.fitTag);
  body.append('image', image, 'garment');
  if (model) { body.append('garment3d', JSON.stringify(model.pkg)); body.append('texture', model.texture, 'texture.jpg'); }
  return authed<WardrobeItem>('/wardrobe', { method: 'POST', body }, 'Не удалось добавить вещь.');
}

export const updateWardrobeItem = (id: string, changes: Partial<Pick<WardrobeItem, 'type' | 'dominantColor' | 'fitTag'>>) =>
  authed<WardrobeItem>('/wardrobe/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes),
  }, 'Не удалось сохранить изменения.');

export const deleteWardrobeItem = (id: string) =>
  authed<{ id: string }>('/wardrobe/' + id, { method: 'DELETE' }, 'Не удалось удалить вещь.');

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
  }, 'Не удалось выполнить тест.');
