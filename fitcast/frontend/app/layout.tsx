import type { Metadata } from 'next';
import { IBM_Plex_Mono, Source_Serif_4, VT323 } from 'next/font/google';
import AppShell from './components/AppShell';
import { THEME_SCRIPT } from './components/theme-script';
import './globals.css';

const pixel = VT323({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
});

const mono = IBM_Plex_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-mono',
});

const serif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
});

export const metadata: Metadata = {
  title: 'FitCast',
  description: 'FitCast is a digital wardrobe: photograph a garment, get a 3D copy of it, and get outfits for the weather and occasion.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${pixel.variable} ${mono.variable} ${serif.variable}`}>
      <head>
        {/* sets data-theme before the first paint, so there is no white flash in the dark theme */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
