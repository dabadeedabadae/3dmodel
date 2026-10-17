'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { TEMPLATES } from './templates';
import type { Garment } from './types';

/**
 * Renders a single garment.
 *
 * Critical: every instance gets its OWN geometry and its OWN material.
 * Sharing a material would make recoloring one jacket recolor every garment
 * that uses the same mesh. For real GLBs later: clone the scene with
 * SkeletonUtils.clone and do `mesh.material = mesh.material.clone()` per mesh.
 */
export function GarmentMesh({
  garment,
  selected,
}: {
  garment: Garment;
  selected: boolean;
}) {
  const tpl = TEMPLATES[garment.type];

  const geometry = useMemo(
    () => tpl.makePlaceholder(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [garment.type]
  );
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.8 }),
    []
  );

  useEffect(() => {
    material.color.set(garment.color);
  }, [material, garment.color]);

  useEffect(() => {
    material.emissive.set(selected ? '#1f3ff0' : '#000000');
    material.emissiveIntensity = selected ? 0.22 : 0;
  }, [material, selected]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (!tpl) return null;

  return (
    <mesh geometry={geometry} material={material} position={tpl.position} />
  );
}
