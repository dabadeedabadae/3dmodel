'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { Body } from './Body';
import { GarmentMesh } from './Garment';
import { TEMPLATES } from './templates';
import type { Garment } from './types';

// draw order by zone so outerwear sits over the top, etc.
const ZONE_ORDER: Record<string, number> = {
  torso: 0,
  legs: 0,
  feet: 0,
  outer: 1,
};

export default function Scene({
  garments,
  selectedId,
}: {
  garments: Garment[];
  selectedId: string | null;
}) {
  const sorted = [...garments].sort(
    (a, b) =>
      (ZONE_ORDER[TEMPLATES[a.type]?.zone] ?? 0) -
      (ZONE_ORDER[TEMPLATES[b.type]?.zone] ?? 0)
  );

  return (
    <Canvas shadows gl={{ alpha: true }} camera={{ position: [2.4, 1.5, 4.6], fov: 38 }}>
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#ffffff', '#d6d9e0', 0.7]} />
      <directionalLight position={[4, 6, 4]} intensity={2} castShadow />
      <directionalLight position={[-4, 3, -3]} intensity={0.7} />

      <group position={[0, -1.28, 0]}>
        <Body />
        {sorted.map((g) => (
          <GarmentMesh
            key={g.id}
            garment={g}
            selected={g.id === selectedId}
          />
        ))}
        <ContactShadows
          position={[0, -0.065, 0]}
          opacity={0.3}
          scale={5}
          blur={2.4}
          far={2}
        />
      </group>

      <OrbitControls
        enablePan={false}
        minDistance={2}
        maxDistance={9}
        target={[0, 0.35, 0]}
      />
    </Canvas>
  );
}
