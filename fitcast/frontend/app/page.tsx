'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, clearToken, getProfile, getToken } from '../lib/api';
import Landing from './components/Landing';

export default function HomePage() {
  const router = useRouter();
  const [guest, setGuest] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!getToken()) { setGuest(true); return; }
    setError(false);
    getProfile().then((profile) => {
      if (active) router.replace(profile.isAdmin ? '/admin' : '/profile');
    }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) { clearToken(); setGuest(true); }
      else setError(true);
    });
    return () => { active = false; };
  }, [router, attempt]);
  if (guest) return <Landing />;
  return <div className="container"><div className="card"><h1>FitCast</h1>
    {error ? <><p role="alert">Не удалось подключиться к серверу.</p><button className="secondary" onClick={() => setAttempt((value) => value + 1)}>Повторить</button></> : <p role="status">Загрузка…</p>}
  </div></div>;
}
