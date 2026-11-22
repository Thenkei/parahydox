/**
 * The floating stick, as arithmetic: where the thumb is relative to where it landed, read as
 * the arrow keys it stands for. No DOM here, so the feel can be pinned down by tests.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Axis = -1 | 0 | 1;

/** The same axes the keyboard gives: `x` is ← →, `z` is ↑ ↓ (↑ is +1, as in the physics). */
export interface Direction {
  readonly x: Axis;
  readonly z: Axis;
}

export const NEUTRAL: Direction = { x: 0, z: 0 };

/** How far, in CSS pixels, the thumb must travel before the stick says anything: a resting thumb is not a step. */
export const DEAD_ZONE = 14;

/**
 * Once a direction is held it lets go only nearer the centre than this. Without the gap a thumb
 * resting on the edge of the dead zone would chatter, and every chatter is a key the clones replay.
 */
export const RELEASE_ZONE = 9;

/** How far the knob travels from the centre. Past it, the centre follows the thumb. */
export const STICK_RADIUS = 56;

/** Eight sectors of 45°: an axis counts while the drag is within 67.5° of it. */
const DIAGONAL = Math.tan(Math.PI / 8);

const sign = (value: number): Axis => (value > 0 ? 1 : value < 0 ? -1 : 0);

/**
 * The arrows a drag of (`dx`, `dy`) from the centre holds down. Screen y grows downwards, so a
 * drag up is `z = 1`. With `vertical` off (a 2D slice, where ↑ and ↓ do nothing) only ← → are
 * read: a thumb that drifts up while running must not trip the "Espace pour sauter" reminder.
 * `previous` is what the stick held a moment ago, for the hysteresis.
 */
export function directionOf(dx: number, dy: number, vertical: boolean, previous: Direction = NEUTRAL): Direction {
  const holding = previous.x !== 0 || (vertical && previous.z !== 0);
  const threshold = holding ? RELEASE_ZONE : DEAD_ZONE;
  if (!vertical) {
    const x = sign(dx);
    return { x: Math.abs(dx) > (previous.x === x && x !== 0 ? RELEASE_ZONE : DEAD_ZONE) ? x : 0, z: 0 };
  }
  if (Math.hypot(dx, dy) <= threshold) return NEUTRAL;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return {
    x: ax > ay * DIAGONAL ? sign(dx) : 0,
    z: ay > ax * DIAGONAL ? sign(-dy) : 0,
  };
}

/**
 * Where the centre goes when the thumb pulls past the rim: dragged along, so that it stays one
 * radius behind. Turning round then takes one radius of travel, not the whole way back across
 * the place the thumb first landed: what a quick ← → reversal on a ledge needs.
 */
export function follow(origin: Point, thumb: Point, radius: number = STICK_RADIUS): Point {
  const dx = thumb.x - origin.x;
  const dy = thumb.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius) return origin;
  const pull = (distance - radius) / distance;
  return { x: origin.x + dx * pull, y: origin.y + dy * pull };
}

/** Where the knob is drawn, relative to the centre: under the thumb, never past the rim. */
export function knobOffset(origin: Point, thumb: Point, radius: number = STICK_RADIUS): Point {
  const dx = thumb.x - origin.x;
  const dy = thumb.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius) return { x: dx, y: dy };
  return { x: (dx / distance) * radius, y: (dy / distance) * radius };
}

/** The key codes a direction holds: the arrows, which every part of the game already reads. */
export function codesOf(direction: Direction): readonly string[] {
  const codes: string[] = [];
  if (direction.x === -1) codes.push('ArrowLeft');
  if (direction.x === 1) codes.push('ArrowRight');
  if (direction.z === 1) codes.push('ArrowUp');
  if (direction.z === -1) codes.push('ArrowDown');
  return codes;
}
