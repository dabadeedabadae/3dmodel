'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthUser, getProfile, getToken } from '../../lib/api';

export default function SiteHeader() {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      if (!getToken()) { setUser(null); return; }
      getProfile().then((profile) => { if (active) setUser(profile); }).catch(() => { if (active) setUser(null); });
    };
    load(); window.addEventListener('fitcast-profile-updated', load);
    return () => { active = false; window.removeEventListener('fitcast-profile-updated', load); };
  }, [pathname]);
  return <><header className="site-header"><Link href="/" className="site-logo">FitCast</Link><nav className="site-nav" aria-label="Навигация">
    {user ? <><Link href="/model">[ 3D-модель ]</Link><Link href={user.isAdmin ? '/admin' : '/profile'}>{user.isAdmin ? '[ Админка ]' : '[ Профиль ]'}</Link></> : <><Link href="/login">[ Log in ]</Link><Link href="/register">[ Sign up ]</Link></>}
  </nav></header><div className="site-divider" aria-hidden /></>;
}
