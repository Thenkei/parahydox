import type { Dim, Vec3 } from '../../core/types';

/** The pace of something sliding on ice, in cells a second along x and into the depth. */
export interface Slide {
  readonly x: number;
  readonly z: number;
}

/** Where a body is drawn: a continuous position, and the cell it is sorted and lit by. */
export interface ActorPose {
  readonly id: number;
  readonly role: 'player' | 'clone';
  readonly dim: Dim;
  /** Continuous position of the cell's origin corner, in cells; `y` is the height of the soles. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Which way the head is from the soles: 1 for whoever falls down, -1 for an antipode, whose soles are on the ceiling. */
  readonly up: 1 | -1;
  /** Sliding on its soles without grip; null when it has grip, stands still or is in the air. */
  readonly slide: Slide | null;
  /**
   * Falling without end through a joined bottom and top, in cells a second (negative is down);
   * 0 otherwise. The air it tears through is drawn, so that the fall reads as one across the seam.
   */
  readonly plunge: number;
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
  /** Carried by the ice at its own pace; null at rest or held by stone. */
  readonly slide: Slide | null;
}
