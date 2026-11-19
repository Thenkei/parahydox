import type { Dim, Vec3 } from '../../core/types';

/** Where a body is drawn: a continuous position, and the cell it is sorted and lit by. */
export interface ActorPose {
  readonly id: number;
  readonly role: 'player' | 'clone';
  readonly dim: Dim;
  /** Continuous position of the cell's origin corner, in cells. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Cell used for depth sorting. */
  readonly cell: Vec3;
  readonly alpha: number;
  /** 0..1 through a stride, for the walk cycle; null when standing. */
  readonly stride: number | null;
  readonly airborne: boolean;
  readonly heading: -1 | 0 | 1;
}

export interface CratePose {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly cell: Vec3;
}
