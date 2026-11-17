/** Landmarks of the procedural body from its analytic frame (no mesh search). */
import type { BodyFrame } from './anatomy';
import type { AvatarLandmark, AvatarLandmarkName } from '../fitting/AvatarAdapter';

export type BodyLandmarkName = AvatarLandmarkName | 'elbow_left' | 'elbow_right' | 'ankle_left' | 'ankle_right' | 'bust_center' | 'underbust_center' | 'hip_left' | 'hip_right' | 'waist_left' | 'waist_right' | 'chin';

export interface BodyLandmark extends Omit<AvatarLandmark, 'name'> {
  name: BodyLandmarkName;
}

export function landmarksFromFrame(f: BodyFrame): BodyLandmark[] {
  const h = f.heights;
  const t = f.torso;
  const P = (name: BodyLandmarkName, x: number, y: number, z: number): BodyLandmark => ({ name, position: [x, y, z] });
  const armJ = (side: 'left' | 'right', i: number) => f.arms[side].joints[i]!.pos;
  const legJ = (side: 'left' | 'right', i: number) => f.legs[side].joints[i]!.pos;
  return [
    P('head_top', 0, h.head_top, f.head.cz),
    P('chin', 0, h.chin, f.head.cz + f.head.depth * 0.25),
    P('neck_base', 0, h.neck_base, t.neck_base.cz),
    P('shoulder_left', f.params.shoulderWidth / 2, h.shoulder, 0),
    P('shoulder_right', -f.params.shoulderWidth / 2, h.shoulder, 0),
    P('armpit_left', t.armpit.a, h.armpit, 0),
    P('armpit_right', -t.armpit.a, h.armpit, 0),
    P('chest_center', 0, h.chest, 0),
    P('bust_center', 0, h.chest, t.chest.b + t.chest.bulge),
    P('underbust_center', 0, h.underbust, 0),
    P('waist_center', 0, h.waist, 0),
    P('waist_left', t.waist.a, h.waist, 0),
    P('waist_right', -t.waist.a, h.waist, 0),
    P('hip_center', 0, h.hip, 0),
    P('hip_left', t.hip.a, h.hip, 0),
    P('hip_right', -t.hip.a, h.hip, 0),
    P('crotch', 0, h.crotch, 0),
    P('elbow_left', ...armJ('left', 2)),
    P('elbow_right', ...armJ('right', 2)),
    P('wrist_left', ...armJ('left', 4)),
    P('wrist_right', ...armJ('right', 4)),
    P('knee_left', ...legJ('left', 2)),
    P('knee_right', ...legJ('right', 2)),
    P('ankle_left', ...legJ('left', 4)),
    P('ankle_right', ...legJ('right', 4)),
    P('floor_center', 0, 0, 0),
  ];
}
