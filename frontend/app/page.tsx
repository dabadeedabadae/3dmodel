'use client';

import { useEffect, useState } from 'react';
import { AuthUser, clearToken, getProfile, getToken } from '../lib/api';
import Landing from './components/Landing';

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

  if (!loading && !user) return <Landing />;

  return (
    <div className="container">
      <div className="card">
        <h1>FitCast</h1>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            <p>Logged in as {user!.email}</p>
            <button className="secondary" onClick={handleLogout}>
              Log out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
