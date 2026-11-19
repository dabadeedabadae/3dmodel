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
  return <><header className="site-header"><Link href="/" className="site-logo">FitCast</Link><nav className="site-nav" aria-label="Навигация">
    {user ? <>{tab('/fitting', '3D-модель')}{user.isAdmin ? tab('/admin', 'Админка') : tab('/profile', 'Профиль')}</> : <>{tab('/fitting', '3D-модель')}{tab('/login', 'Войти')}{tab('/register', 'Регистрация')}</>}
  </nav></header><div className="site-divider" aria-hidden /></>;
}
