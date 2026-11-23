import type { Metadata } from 'next';
import FittingRoom from './FittingRoom';

export const metadata: Metadata = { title: 'FitCast — 3D model' };

export default function FittingPage() {
  return <FittingRoom />;
}
