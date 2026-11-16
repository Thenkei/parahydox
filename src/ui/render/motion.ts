import type { Actor, Dim, Vec3, World } from '../../core/types';

/**
 * Turns two consecutive worlds into motion. The simulation jumps from cell to cell; here
 * each body gets a continuous position so that a step reads as a walk, a hop or a fall.
 */
export interface ActorPose {
  readonly id: number;
  readonly role: Actor['role'];
  readonly dim: Dim;
  /** Continuous position of the cell's origin corner, in cells. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Cell used for depth sorting. */
  readonly cell: Vec3;
  readonly alpha: number;
  /** 0..1 progress of a horizontal move, for the walk cycle; null when standing. */
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

const BASE_MS = 135;
const FALL_MS = 68;
/** How far below the grid a body is shown dropping before it vanishes. */
const VOID_DROP = 7;

/**
 * How far above its cell a body in mid-jump is drawn, by moves left in the air: it lifts
 * off, peaks on the first drift and is already coming down on the second. Hanging must
 * never look like standing, and the three steps of a jump should read as one arc.
 */
const hoverOf = (air: number): number => (air >= 2 ? 0.14 : air === 1 ? 0.34 : 0);

const smooth = (t: number): number => t * t * (3 - 2 * t);

const fallOf = (from: Vec3, to: Vec3, lost: boolean): number => (lost ? from.y + VOID_DROP : Math.max(0, from.y - to.y));

/** A step lasts longer when something falls far, so that gravity is seen, not teleported. */
export function stepDuration(prev: World, next: World): number {
  let fall = 0;
  for (const actor of next.actors) {
    const before = prev.actors[actor.id];
    if (!before || before.status !== 'active') continue;
    fall = Math.max(fall, fallOf(before.pos, actor.pos, actor.status === 'fallen'));
  }
  for (const before of prev.crates) {
    const after = next.crates.find((c) => c.id === before.id);
    fall = Math.max(fall, after ? fallOf(before.pos, after.pos, false) : before.pos.y + VOID_DROP);
  }
  return BASE_MS + FALL_MS * Math.sqrt(fall);
}

interface Path {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly airborne: boolean;
}

/**
 * Position along a step: move sideways first, then drop with gravity; rise in an arc
 * when climbing. `walkShare` is the part of the step spent on the sideways move.
 */
function along(from: Vec3, to: Vec3, t: number, walkShare: number, hop: number, lost: boolean): Path {
  const sideways = from.x !== to.x || from.z !== to.z;
  const targetY = lost ? from.y - (from.y + VOID_DROP) : to.y;
  const dy = targetY - from.y;

  if (dy < 0) {
    const share = sideways ? walkShare : 0;
    const walk = share > 0 ? smooth(Math.min(1, t / share)) : 1;
    const drop = t <= share ? 0 : ((t - share) / (1 - share)) ** 2;
    return {
      x: from.x + (to.x - from.x) * walk,
      y: from.y + dy * drop,
      z: from.z + (to.z - from.z) * walk,
      airborne: t > share && t < 1,
    };
  }
  const s = smooth(t);
  const arc = sideways ? Math.sin(Math.PI * t) * (dy > 0 ? 0.28 : hop) : 0;
  return {
    x: from.x + (to.x - from.x) * s,
    y: from.y + dy * s + arc,
    z: from.z + (to.z - from.z) * s,
    airborne: dy > 0 && t < 1,
  };
}

export function poseActors(prev: World | null, next: World, t: number, duration: number): ActorPose[] {
  const walkShare = Math.min(1, BASE_MS / duration);
  const poses: ActorPose[] = [];
  for (const actor of next.actors) {
    const before = prev?.actors[actor.id];
    const moving = before !== undefined && before.status === 'active' && t < 1;
    if (actor.status === 'fallen' && !moving) continue;

    const from = moving ? before.pos : actor.pos;
    const lost = actor.status === 'fallen';
    // On a wire there is no gravity and no hop: the point slides.
    const hop = actor.dim === 1 ? 0 : 0.07;
    const path = moving ? along(from, actor.pos, t, walkShare, hop, lost) : { ...actor.pos, airborne: false };
    const sideways = moving && (from.x !== actor.pos.x || from.z !== actor.pos.z);
    const hangFrom = moving ? hoverOf(before.air) : 0;
    const hangTo = actor.status === 'active' ? hoverOf(actor.air) : 0;
    const hang = moving ? hangFrom + (hangTo - hangFrom) * smooth(t) : hangTo;
    poses.push({
      id: actor.id,
      role: actor.role,
      dim: actor.dim,
      x: path.x,
      y: path.y + hang,
      z: path.z,
      cell: lost ? from : actor.pos,
      alpha: lost ? Math.min(1, (1 - t) * 2.5) : 1,
      stride: sideways ? Math.min(1, t / walkShare) : null,
      airborne: path.airborne || actor.air > 0,
      heading: moving ? (Math.sign(actor.pos.x - from.x) as -1 | 0 | 1) : 0,
    });
  }
  return poses;
}

/**
 * Actors can share a cell (every loop starts with all of them on the start tile). Fan the
 * clones out behind the hero so that a clone is never hidden exactly under it.
 */
export function fanOut(poses: readonly ActorPose[]): ActorPose[] {
  const groups = new Map<string, ActorPose[]>();
  for (const pose of poses) {
    const key = `${Math.round(pose.x * 8)},${Math.round(pose.y * 8)},${Math.round(pose.z * 8)}`;
    groups.set(key, [...(groups.get(key) ?? []), pose]);
  }
  return [...groups.values()].flatMap((group) => {
    if (group.length < 2) return group;
    // Oldest clone furthest back; the player (highest id) stays put.
    const ordered = [...group].sort((a, b) => a.id - b.id);
    return ordered.map((pose, i) => ({ ...pose, x: pose.x - (ordered.length - 1 - i) * 0.2 }));
  });
}

export function poseCrates(prev: World | null, next: World, t: number, duration: number): CratePose[] {
  const walkShare = Math.min(1, BASE_MS / duration);
  const poses: CratePose[] = next.crates.map((crate) => {
    const before = t < 1 ? prev?.crates.find((c) => c.id === crate.id) : undefined;
    const path = before ? along(before.pos, crate.pos, t, walkShare, 0, false) : crate.pos;
    return { id: crate.id, x: path.x, y: path.y, z: path.z, cell: crate.pos };
  });
  // A crate pushed into the void keeps falling on screen for the length of the step.
  if (prev && t < 1) {
    for (const before of prev.crates) {
      if (next.crates.some((c) => c.id === before.id)) continue;
      // It left sideways first: whoever now stands in its cell is the one who pushed it.
      const pusher = next.actors.find((a) => a.pos.x === before.pos.x && a.pos.z === before.pos.z && a.pos.y === before.pos.y);
      const origin = pusher ? prev.actors[pusher.id]?.pos : undefined;
      const over = origin
        ? { x: before.pos.x * 2 - origin.x, y: before.pos.y, z: before.pos.z * 2 - origin.z }
        : before.pos;
      const path = along(before.pos, over, t, walkShare, 0, true);
      poses.push({ id: before.id, x: path.x, y: path.y, z: path.z, cell: before.pos });
    }
  }
  return poses;
}
