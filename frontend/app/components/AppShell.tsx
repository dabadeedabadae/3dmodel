'use client';

import { usePathname } from 'next/navigation';
import SiteHeader from './SiteHeader';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return <>{children}</>;
  return <div className="site"><SiteHeader />{children}</div>;
}
