'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, ProfileChanges, UserProfile, changePassword, clearToken, updateProfile } from '../../../lib/api';
import { useProfile } from '../use-profile';

const fields = (user: UserProfile): ProfileChanges => ({ name: user.name ?? '', city: user.city ?? '', bio: user.bio ?? '' });
export default function SettingsPage() {
  const router = useRouter();
  const { profile, setProfile, loading, error: loadError, retry } = useProfile(true);
  const [tab, setTab] = useState<'personal' | 'security'>('personal');
  const [form, setForm] = useState<ProfileChanges>({ name: '', city: '', bio: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordDone, setPasswordDone] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (profile) setForm(fields(profile)); }, [profile]);
  const dirty = profile && JSON.stringify(form) !== JSON.stringify(fields(profile));
  function expire(err: unknown) {
    if (err instanceof ApiError && err.status === 401) { clearToken(); router.replace('/login'); return true; }
    return false;
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await updateProfile(form);
      if (!mounted.current) return;
      setProfile(updated); setForm(fields(updated)); setSuccess('Изменения сохранены.');
      window.dispatchEvent(new Event('fitcast-profile-updated'));
    } catch (err: unknown) {
      if (mounted.current && !expire(err)) setError(err instanceof Error ? err.message : 'Не удалось сохранить данные.');
    } finally { if (mounted.current) setSaving(false); }
  }
  async function savePassword(event: FormEvent) {
    event.preventDefault(); setPasswordError('');
    if (passwords.next !== passwords.confirm) { setPasswordError('Новые пароли не совпадают.'); return; }
    if (passwords.next === passwords.current) { setPasswordError('Новый пароль должен отличаться от текущего.'); return; }
    if (new TextEncoder().encode(passwords.next).length > 72) { setPasswordError('Пароль слишком длинный: максимум 72 байта UTF-8.'); return; }
    setChanging(true);
    try {
      await changePassword(passwords.current, passwords.next);
      clearToken();
      if (mounted.current) { setPasswords({ current: '', next: '', confirm: '' }); setPasswordDone(true); }
    } catch (err: unknown) {
      if (mounted.current && !expire(err)) setPasswordError(err instanceof Error ? err.message : 'Не удалось изменить пароль.');
    } finally { if (mounted.current) setChanging(false); }
  }
  function chooseTab(next: 'personal' | 'security') { setTab(next); setError(''); setSuccess(''); setPasswordError(''); setPasswords({ current: '', next: '', confirm: '' }); }
  const busy = saving || changing;
  return <main className="profile-main settings-main"><div className="profile-heading"><div><span className="profile-kicker">ЛИЧНЫЙ КАБИНЕТ</span><h1>Настройки</h1><p>Личные данные и безопасность вашего аккаунта.</p></div><Link className="account-settings-link" href={profile?.isAdmin ? '/admin' : '/profile'}>← В кабинет</Link></div>
    {loading ? <p role="status" className="profile-loading">Загрузка…</p> : !profile ? <section className="profile-panel"><p role="alert">{loadError}</p><button className="secondary" onClick={retry}>Повторить</button></section> : passwordDone ? <section className="profile-panel settings-password-done"><span className="settings-check">✓</span><h2>Пароль изменён</h2><p>Все предыдущие сеансы завершены. Войдите в аккаунт с новым паролем.</p><Link className="account-settings-link" href="/login">Войти заново →</Link></section> : <div className="settings-grid">
      <aside className="settings-menu"><nav aria-label="Разделы настроек"><button type="button" disabled={busy} className={tab === 'personal' ? 'is-active' : ''} aria-current={tab === 'personal' ? 'page' : undefined} onClick={() => chooseTab('personal')}><span>01</span><div>Личные данные<small>Имя, город и о себе</small></div></button><button type="button" disabled={busy} className={tab === 'security' ? 'is-active' : ''} aria-current={tab === 'security' ? 'page' : undefined} onClick={() => chooseTab('security')}><span>02</span><div>Безопасность<small>Управление паролем</small></div></button></nav><p>Изменения доступны только вам.</p></aside>
      {tab === 'personal' ? <section className="profile-panel profile-form-panel"><div className="profile-section-title"><h2>Личные данные</h2><p>Расскажите немного о себе и своём стиле.</p></div><form onSubmit={save}><fieldset className="profile-fieldset" disabled={saving}>
        <div className="profile-form-row"><div className="field"><label htmlFor="settings-name">Имя</label><input id="settings-name" autoComplete="name" maxLength={80} value={form.name} placeholder="Как к вам обращаться?" onChange={(event) => { setForm({ ...form, name: event.target.value }); setSuccess(''); }} /></div><div className="field"><label htmlFor="settings-city">Город</label><input id="settings-city" autoComplete="address-level2" maxLength={100} value={form.city} placeholder="Например, Алматы" onChange={(event) => { setForm({ ...form, city: event.target.value }); setSuccess(''); }} /></div></div>
        <div className="field"><label htmlFor="settings-email">Email</label><input id="settings-email" type="email" value={profile.email} readOnly /><small>Email используется для входа и здесь не изменяется.</small></div>
        <div className="field"><label htmlFor="settings-bio">О себе</label><textarea id="settings-bio" rows={5} maxLength={300} placeholder="Любимый стиль, цвета или пара слов о себе…" value={form.bio} onChange={(event) => { setForm({ ...form, bio: event.target.value }); setSuccess(''); }} /><small>{form.bio.length}/300</small></div>
      </fieldset>{error && <p className="error" role="alert">{error}</p>}{success && <p className="profile-success" role="status">✓ {success}</p>}<div className="profile-save-row"><button className="primary" disabled={saving || !dirty}>{saving ? 'Сохранение…' : 'Сохранить изменения'}</button><button type="button" className="profile-reset" disabled={saving || !dirty} onClick={() => { setForm(fields(profile)); setError(''); setSuccess(''); }}>Отменить</button></div></form></section> :
      <section className="profile-panel profile-form-panel"><div className="profile-section-title"><h2>Смена пароля</h2><p>Для изменения потребуется ваш текущий пароль.</p></div><form onSubmit={savePassword}><fieldset disabled={changing} className="profile-fieldset">
        <input className="settings-username" type="text" name="username" autoComplete="username" value={profile.email} readOnly tabIndex={-1} aria-label="Email аккаунта" />
        <div className="field"><label htmlFor="current-password">Текущий пароль</label><input id="current-password" type="password" autoComplete="current-password" required value={passwords.current} onChange={(event) => { setPasswords({ ...passwords, current: event.target.value }); setPasswordError(''); }} /></div>
        <div className="field"><label htmlFor="new-password">Новый пароль</label><input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={passwords.next} onChange={(event) => { setPasswords({ ...passwords, next: event.target.value }); setPasswordError(''); }} /><small>От 8 символов, не более 72 байт. Пароль должен отличаться от текущего.</small></div>
        <div className="field"><label htmlFor="confirm-password">Повторите новый пароль</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={passwords.confirm} onChange={(event) => { setPasswords({ ...passwords, confirm: event.target.value }); setPasswordError(''); }} /></div>
      </fieldset><div className="settings-security-note">После смены пароля все устройства выйдут из аккаунта. Потребуется войти заново.</div>{passwordError && <p className="error" role="alert">{passwordError}</p>}<div className="profile-save-row"><button className="primary" disabled={changing}>{changing ? 'Изменение…' : 'Изменить пароль'}</button></div></form></section>}
    </div>}
  </main>;
}
