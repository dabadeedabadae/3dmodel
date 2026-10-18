import type { Metadata } from 'next';
import ModelDemo from './ModelDemo';

export const metadata: Metadata = {
  title: 'FitCast — 3D model demo',
};

export default function ModelPage() {
  return <ModelDemo />;
}
