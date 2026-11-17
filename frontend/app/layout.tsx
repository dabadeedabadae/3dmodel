import type { Metadata } from 'next';
import { IBM_Plex_Mono, Source_Serif_4, VT323 } from 'next/font/google';
import AppShell from './components/AppShell';
import './globals.css';

const pixel = VT323({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
});

const mono = IBM_Plex_Mono({
  weight: ['400', '500'],
  subsets: ['latin', 'cyrillic'],
  variable: '--font-mono',
});

const serif = Source_Serif_4({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-serif',
});

export const metadata: Metadata = {
  title: 'FitCast',
  description: 'FitCast — цифровой гардероб: сфотографируйте вещь, получите её 3D-копию и образ под погоду и повод.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${pixel.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
