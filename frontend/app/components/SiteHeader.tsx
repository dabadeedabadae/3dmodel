import Link from 'next/link';

export default function SiteHeader() {
  return (
    <>
      <header className="site-header">
        <Link href="/" className="site-logo">
          FitCast
        </Link>
        <nav className="site-nav">
          <Link href="/login">[ Log in ]</Link>
          <Link href="/register">[ Sign up ]</Link>
        </nav>
      </header>

      <div className="site-divider" aria-hidden />
    </>
  );
}
