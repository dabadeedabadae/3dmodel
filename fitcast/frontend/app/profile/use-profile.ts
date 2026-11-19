'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, UserProfile, clearToken, getProfile } from '../../lib/api';

export function useProfile(allowAdmin = false) {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    getProfile().then((user) => {
      if (!active) return;
      if (user.isAdmin && !allowAdmin) { router.replace('/admin'); return; }
      setProfile(user); setLoading(false);
    }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) { clearToken(); router.replace('/login'); return; }
      setError('Не удалось загрузить аккаунт. Проверьте подключение к серверу.'); setLoading(false);
    });
    return () => { active = false; };
  }, [router, allowAdmin, attempt]);
  return { profile, setProfile, loading, error, retry: () => setAttempt((value) => value + 1) };
}
