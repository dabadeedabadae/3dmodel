'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { login, saveToken } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { accessToken, user } = await login(email, password);
      saveToken(accessToken);
      router.replace(user.isAdmin ? '/admin' : '/profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <span className="fig-label fig-label-left">FORM_001</span>
        <h1>Вход</h1>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? 'Входим…' : 'Войти'}
          </button>
        </form>
        <div className="switch">
          Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
        </div>
      </div>
    </div>
  );
}
