'use client';

import { MouseEvent, useEffect, useState } from 'react';

import { THEME_KEY } from './theme-script';

type Theme = 'light' | 'dark';

function current(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode: the choice lasts for this page only */ }
}

/**
 * Light / dark switch at the right end of the navigation. The new theme spreads from the button as a growing
 * circle (View Transitions API); without it, or with reduced motion, the colours cross-fade.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => { setTheme(current()); }, []);

  function toggle(e: MouseEvent<HTMLButtonElement>) {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const root = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof document.startViewTransition !== 'function') {
      if (!reduced) {
        root.classList.add('theme-fading');
        window.setTimeout(() => root.classList.remove('theme-fading'), 450);
      }
      apply(next);
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    // the new snapshot starts as a zero circle at the button (globals.css), so it never shows in full for a frame
    // before the animation below takes over
    root.style.setProperty('--theme-x', `${x}px`);
    root.style.setProperty('--theme-y', `${y}px`);
    const transition = document.startViewTransition(() => apply(next));
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => { /* the transition was skipped: the theme is already applied */ });
  }

  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label}
      aria-pressed={theme === null ? undefined : theme === 'dark'}>
      <span aria-hidden="true">[</span>
      <span className="theme-toggle-icon" aria-hidden="true">
        <svg className="theme-sun" viewBox="0 0 24 24" width="18" height="18">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
        <svg className="theme-moon" viewBox="0 0 24 24" width="18" height="18">
          <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z" />
        </svg>
      </span>
      <span aria-hidden="true">]</span>
    </button>
  );
}
