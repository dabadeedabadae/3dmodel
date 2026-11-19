'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { register, saveToken } from '../../lib/api';

export default function RegisterPage() {
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
      const { accessToken } = await register(email, password);
      saveToken(accessToken);
      router.replace('/profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось зарегистрироваться');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <span className="fig-label fig-label-left">FORM_002</span>
        <h1>Регистрация</h1>
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
            <label htmlFor="password">Пароль (не меньше 8 символов)</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? 'Создаём аккаунт…' : 'Создать аккаунт'}
          </button>
        </form>
        <div className="switch">
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </div>
      </div>
    </div>
  );
}
