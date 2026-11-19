import { redirect } from 'next/navigation';

// The placeholder mannequin moved to archive/ (not tracked); the 3D model lives at /fitting.
export default function ModelPage() {
  redirect('/fitting');
}
