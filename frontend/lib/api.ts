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
  id: string; type: string; dominantColor: string; fitTag: string; createdAt: string;
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
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function getProfile(): Promise<AuthUser> {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${API_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error('Failed to load profile');
  }

  return res.json();
}
