'use client';

/**
 * Preset body mannequin — stylised 'chibi' proportions:
 * oversized round head, small rounded torso, short stubby limbs.
 * Assembled from primitives, neutral grey. Same mannequin for every
 * garment — garments are positioned relative to it (feet at y = 0).
 * Kept standalone so it can later be swapped for a real GLB.
 */

// light neutral grey, sits on the paper-coloured blueprint grid
const GREY = '#c4c7cf';
const mat = <meshStandardMaterial color={GREY} roughness={0.75} metalness={0} />;

export function Body() {
  return (
    <group>
      {/* head — the dominant volume */}
      <mesh position={[0, 1.95, 0]} scale={[1, 1.02, 0.98]} castShadow>
        <sphereGeometry args={[0.62, 48, 48]} />
        {mat}
      </mesh>
      {/* ears */}
      <mesh position={[-0.6, 1.78, -0.02]} scale={[0.5, 1, 0.7]} castShadow>
        <sphereGeometry args={[0.14, 24, 24]} />
        {mat}
      </mesh>
      <mesh position={[0.6, 1.78, -0.02]} scale={[0.5, 1, 0.7]} castShadow>
        <sphereGeometry args={[0.14, 24, 24]} />
        {mat}
      </mesh>

      {/* neck (barely visible) */}
      <mesh position={[0, 1.42, 0]}>
        <cylinderGeometry args={[0.16, 0.2, 0.18, 20]} />
        {mat}
      </mesh>

      {/* torso — small rounded barrel */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <capsuleGeometry args={[0.36, 0.34, 12, 32]} />
        {mat}
      </mesh>

      {/* arms — short, stubby, hanging at the sides */}
      <mesh position={[-0.46, 0.98, 0]} rotation={[0, 0, 0.28]} castShadow>
        <capsuleGeometry args={[0.135, 0.3, 10, 20]} />
        {mat}
      </mesh>
      <mesh position={[0.46, 0.98, 0]} rotation={[0, 0, -0.28]} castShadow>
        <capsuleGeometry args={[0.135, 0.3, 10, 20]} />
        {mat}
      </mesh>

      {/* legs — short and thick */}
      <mesh position={[-0.2, 0.32, 0]} castShadow>
        <capsuleGeometry args={[0.16, 0.18, 10, 20]} />
        {mat}
      </mesh>
      <mesh position={[0.2, 0.32, 0]} castShadow>
        <capsuleGeometry args={[0.16, 0.18, 10, 20]} />
        {mat}
      </mesh>

      {/* feet — rounded, poking forward */}
      <mesh position={[-0.2, 0.08, 0.08]} scale={[1, 0.7, 1.5]} castShadow>
        <sphereGeometry args={[0.17, 24, 24]} />
        {mat}
      </mesh>
      <mesh position={[0.2, 0.08, 0.08]} scale={[1, 0.7, 1.5]} castShadow>
        <sphereGeometry args={[0.17, 24, 24]} />
        {mat}
      </mesh>
    </group>
  );
}
