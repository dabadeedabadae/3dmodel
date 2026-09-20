'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AuthUser, clearToken, getProfile, getToken } from '../lib/api';

export default function HomePage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }

    getProfile()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  function handleLogout() {
    clearToken();
    setUser(null);
  }

  return (
    <div className="container">
      <div className="card">
        <h1>FitCast</h1>
        {loading ? (
          <p>Загрузка...</p>
        ) : user ? (
          <>
            <p>Вы вошли как {user.email}</p>
            <button className="secondary" onClick={handleLogout}>
              Выйти
            </button>
          </>
        ) : (
          <>
            <p>Вы не авторизованы</p>
            <Link href="/login">
              <button className="primary">Войти</button>
            </Link>
            <Link href="/register">
              <button className="secondary">Зарегистрироваться</button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
