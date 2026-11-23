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
  const tab = (href: string, label: string) => <Link href={href} aria-current={pathname === href || pathname.startsWith(href + '/') ? 'page' : undefined}>[ {label} ]</Link>;
  return <><header className="site-header"><Link href="/" className="site-logo">FitCast</Link><nav className="site-nav" aria-label="Navigation">
    {user ? <>{tab('/fitting', '3D model')}{tab('/events', 'Events')}{user.isAdmin ? tab('/admin', 'Admin') : tab('/profile', 'Profile')}</> : <>{tab('/fitting', '3D model')}{tab('/login', 'Sign in')}{tab('/register', 'Sign up')}</>}
  </nav></header><div className="site-divider" aria-hidden /></>;
}
