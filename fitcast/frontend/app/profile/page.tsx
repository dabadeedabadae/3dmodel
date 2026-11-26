'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { clearToken } from '../../lib/api';
import { useProfile } from './use-profile';
import Wardrobe from './Wardrobe';

export default function ProfilePage() {
  const router = useRouter();
  const { profile, setProfile, loading, error, retry } = useProfile();
  const expired = useCallback(() => { clearToken(); router.replace('/login'); }, [router]);
  const setCount = useCallback((count: number) => {
    setProfile((p) => (p && p._count && p._count.wardrobeItems !== count ? { ...p, _count: { ...p._count, wardrobeItems: count } } : p));
  }, [setProfile]);
  return <main className="profile-main">
    <div className="profile-heading"><div><span className="profile-kicker">YOUR FITCAST</span><h1>My account</h1><p>Your wardrobe, outfits and everything you need day to day.</p></div><Link className="account-settings-link" href="/profile/settings">⚙ Settings</Link></div>
    {loading ? <p role="status" className="profile-loading">Loading…</p> : !profile ? <section className="profile-panel"><p role="alert">{error}</p><button className="secondary" onClick={retry}>Try again</button></section> : <>
      <section className="profile-panel account-hero" aria-label="Profile card"><div className="profile-avatar">{(profile.name || profile.email)[0].toUpperCase()}</div><div className="account-hero-info"><span className="profile-kicker">MY PROFILE</span><h2>{profile.name || profile.email.split('@')[0]}</h2><p>{profile.email}</p><div className="account-meta"><span>{profile.city || 'No city set'}</span><span>Member since {new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span></div></div><Link href="/profile/settings" className="account-edit">Edit profile →</Link></section>
      <section className="profile-stats" aria-label="My wardrobe"><article className="profile-panel"><span>WARDROBE ITEMS</span><strong>{profile._count?.wardrobeItems ?? '—'}</strong><p>Your saved items</p></article><Link href="/events#saved-outfits" className="profile-stat-link" aria-label="Saved outfits: open the list"><article className="profile-panel"><span>SAVED OUTFITS</span><strong>{profile._count?.savedOutfits ?? '—'}</strong><p>Looks from your wardrobe · open →</p></article></Link><Link href="/fitting" className="profile-panel profile-model-link"><span>3D MODEL</span><h2>Your next outfit</h2><p>Try clothes on the 3D model</p><b>Open the model ↗</b></Link></section>
      {!profile._count && <p className="account-note">Stats are temporarily unavailable.</p>}
      <Wardrobe onCountChange={setCount} onAuthExpired={expired} />
      <div className="account-bottom"><span></span><button className="profile-logout" onClick={() => { clearToken(); router.replace('/login'); }}>Sign out ↗</button></div>
    </>}
  </main>;
}
