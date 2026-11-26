'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, ProfileChanges, UserProfile, changePassword, clearToken, updateProfile } from '../../../lib/api';
import { useProfile } from '../use-profile';
import PasswordInput from '../../components/PasswordInput';

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
      setProfile(updated); setForm(fields(updated)); setSuccess('Changes saved.');
      window.dispatchEvent(new Event('fitcast-profile-updated'));
    } catch (err: unknown) {
      if (mounted.current && !expire(err)) setError(err instanceof Error ? err.message : 'Could not save your details.');
    } finally { if (mounted.current) setSaving(false); }
  }
  async function savePassword(event: FormEvent) {
    event.preventDefault(); setPasswordError('');
    if (passwords.next !== passwords.confirm) { setPasswordError('The new passwords do not match.'); return; }
    if (passwords.next === passwords.current) { setPasswordError('The new password must be different from the current one.'); return; }
    if (new TextEncoder().encode(passwords.next).length > 72) { setPasswordError('Password is too long: 72 bytes of UTF-8 at most.'); return; }
    setChanging(true);
    try {
      await changePassword(passwords.current, passwords.next);
      clearToken();
      if (mounted.current) { setPasswords({ current: '', next: '', confirm: '' }); setPasswordDone(true); }
    } catch (err: unknown) {
      if (mounted.current && !expire(err)) setPasswordError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally { if (mounted.current) setChanging(false); }
  }
  function chooseTab(next: 'personal' | 'security') { setTab(next); setError(''); setSuccess(''); setPasswordError(''); setPasswords({ current: '', next: '', confirm: '' }); }
  const busy = saving || changing;
  return <main className="profile-main settings-main"><div className="profile-heading"><div><span className="profile-kicker">MY ACCOUNT</span><h1>Settings</h1><p>Your personal details and account security.</p></div><Link className="account-settings-link" href={profile?.isAdmin ? '/admin' : '/profile'}>← Back to account</Link></div>
    {loading ? <p role="status" className="profile-loading">Loading…</p> : !profile ? <section className="profile-panel"><p role="alert">{loadError}</p><button className="secondary" onClick={retry}>Try again</button></section> : passwordDone ? <section className="profile-panel settings-password-done"><span className="settings-check">✓</span><h2>Password changed</h2><p>All previous sessions have been signed out. Sign in with your new password.</p><Link className="account-settings-link" href="/login">Sign in again →</Link></section> : <div className="settings-grid">
      <aside className="settings-menu"><nav aria-label="Settings sections"><button type="button" disabled={busy} className={tab === 'personal' ? 'is-active' : ''} aria-current={tab === 'personal' ? 'page' : undefined} onClick={() => chooseTab('personal')}><span>01</span><div>Personal details<small>Name, city and bio</small></div></button><button type="button" disabled={busy} className={tab === 'security' ? 'is-active' : ''} aria-current={tab === 'security' ? 'page' : undefined} onClick={() => chooseTab('security')}><span>02</span><div>Security<small>Password management</small></div></button></nav><p>Only you can make these changes.</p></aside>
      {tab === 'personal' ? <section className="profile-panel profile-form-panel"><div className="profile-section-title"><h2>Personal details</h2><p>Tell us a little about yourself and your style.</p></div><form onSubmit={save}><fieldset className="profile-fieldset" disabled={saving}>
        <div className="profile-form-row"><div className="field"><label htmlFor="settings-name">Name</label><input id="settings-name" autoComplete="name" maxLength={80} value={form.name} placeholder="What should we call you?" onChange={(event) => { setForm({ ...form, name: event.target.value }); setSuccess(''); }} /></div><div className="field"><label htmlFor="settings-city">City</label><input id="settings-city" autoComplete="address-level2" maxLength={100} value={form.city} placeholder="e.g. London" onChange={(event) => { setForm({ ...form, city: event.target.value }); setSuccess(''); }} /></div></div>
        <div className="field"><label htmlFor="settings-email">Email</label><input id="settings-email" type="email" value={profile.email} readOnly /><small>Your email is used to sign in and can't be changed here.</small></div>
        <div className="field"><label htmlFor="settings-bio">About you</label><textarea id="settings-bio" rows={5} maxLength={300} placeholder="Favorite style, colors, or a few words about yourself…" value={form.bio} onChange={(event) => { setForm({ ...form, bio: event.target.value }); setSuccess(''); }} /><small>{form.bio.length}/300</small></div>
      </fieldset>{error && <p className="error" role="alert">{error}</p>}{success && <p className="profile-success" role="status">✓ {success}</p>}<div className="profile-save-row"><button className="primary" disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save changes'}</button><button type="button" className="profile-reset" disabled={saving || !dirty} onClick={() => { setForm(fields(profile)); setError(''); setSuccess(''); }}>Discard</button></div></form></section> :
      <section className="profile-panel profile-form-panel"><div className="profile-section-title"><h2>Change password</h2><p>You'll need your current password to change it.</p></div><form onSubmit={savePassword}><fieldset disabled={changing} className="profile-fieldset">
        <input className="settings-username" type="text" name="username" autoComplete="username" value={profile.email} readOnly tabIndex={-1} aria-label="Account email" />
        <div className="field"><label htmlFor="current-password">Current password</label><PasswordInput id="current-password"autoComplete="current-password" required value={passwords.current} onChange={(event) => { setPasswords({ ...passwords, current: event.target.value }); setPasswordError(''); }} /></div>
        <div className="field"><label htmlFor="new-password">New password</label><PasswordInput id="new-password"autoComplete="new-password" minLength={8} maxLength={72} required value={passwords.next} onChange={(event) => { setPasswords({ ...passwords, next: event.target.value }); setPasswordError(''); }} /><small>At least 8 characters, no more than 72 bytes. Must differ from your current password.</small></div>
        <div className="field"><label htmlFor="confirm-password">Confirm new password</label><PasswordInput id="confirm-password"autoComplete="new-password" minLength={8} maxLength={72} required value={passwords.confirm} onChange={(event) => { setPasswords({ ...passwords, confirm: event.target.value }); setPasswordError(''); }} /></div>
      </fieldset><div className="settings-security-note">Changing your password signs you out on all devices. You'll need to sign in again.</div>{passwordError && <p className="error" role="alert">{passwordError}</p>}<div className="profile-save-row"><button className="primary" disabled={changing}>{changing ? 'Changing…' : 'Change password'}</button></div></form></section>}
    </div>}
  </main>;
}
