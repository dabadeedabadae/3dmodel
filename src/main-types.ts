import type { AppHandle } from './ui/app';
declare global {
  interface Window {
    __pg?: { ready: boolean; error: string | null; app: AppHandle | null };
  }
}
export {};
