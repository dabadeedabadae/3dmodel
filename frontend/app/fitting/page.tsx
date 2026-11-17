import type { Metadata } from 'next';
import FittingRoom from './FittingRoom';

export const metadata: Metadata = { title: 'FitCast — 3D-модель' };

export default function FittingPage() {
  return <FittingRoom />;
}
