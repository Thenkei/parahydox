import { cellAt, cellIndex, vec } from '../core/grid';
import type { Cell, Channel, Level } from '../core/types';

/**
 * The other way to read the same levels: bodies move continuously, run, jump and fall,
 * and a clone replays the keys of a past loop frame by frame. The rules of the world are
 * the ones of the step game (plates hold doors, levers stay, slabs crumble behind you,
 * a threshold unfolds the depth); only movement changes.
 *
 * The simulation is a pure function of the previous state and one input per body, at a
 * fixed 60 steps a second, so a loop replayed from its inputs is always the same loop.
 */
export const FPS = 60;
const DT = 1 / FPS;

const RUN = 5.2;
const GROUND_ACCEL = 70;
const AIR_ACCEL = 42;
const GRAVITY = 42;
/** Peaks at about 1.3 cells: one block is jumped onto, two are a wall. */
const JUMP_SPEED = 10.4;
/** Letting go of jump early cuts the rise: the height of a jump is the length of the press. */
const JUMP_CUT = 0.42;
const MAX_FALL = 19;
/** Frames after leaving a ledge during which a jump still takes off. */
const COYOTE = 6;
/** Frames a jump pressed too early is remembered until the feet touch down. */
const BUFFER = 7;
const HALF = 0.3;
export const HEIGHT = 0.9;
const EPS = 1e-4;

export interface FrameInput {
  /** -1 left, 1 right. */
  readonly x: -1 | 0 | 1;
  /** Depth, used in 3D only: 1 goes deeper, -1 comes forward. */
  readonly z: -1 | 0 | 1;
  readonly jump: boolean;
  /** Change dimension on a threshold. */
  readonly shift: boolean;
}

export const IDLE: FrameInput = { x: 0, z: 0, jump: false, shift: false };

export interface Body {
  readonly id: number;
  readonly role: 'clone' | 'player';
  /** Centre of the feet. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly dim: 2 | 3;
  readonly grounded: boolean;
  readonly status: 'active' | 'fallen' | 'exited';
  readonly coyote: number;
  readonly buffer: number;
  readonly jumpHeld: boolean;
  readonly shiftHeld: boolean;
  readonly facing: 1 | -1;
  /** Index of the fragile slab the body stands on, if any. */
  readonly slab: number | null;
  /** Index of the cell the feet are in, to notice arriving on a lever. */
  readonly cell: number;
}

export interface FlowWorld {
  readonly level: Level;
  readonly tick: number;
  /** Clones oldest first, the player last. */
  readonly bodies: readonly Body[];
  readonly toggled: readonly Channel[];
  readonly broken: readonly number[];
}

export type FlowOutcome = 'playing' | 'won' | 'fallen';

const cellOf = (level: Level, x: number, y: number, z: number): { cx: number; cy: number; cz: number; cell: Cell | null } => {
  const cx = Math.floor(x);
  const cy = Math.floor(y + EPS);
  const cz = Math.floor(z);
  return { cx, cy, cz, cell: cellAt(level, vec(cx, cy, cz)) };
};

export function initialFlow(level: Level, clones: number): FlowWorld {
  const { start } = level;
  const bodies: Body[] = Array.from({ length: clones + 1 }, (_, id) => ({
    id,
    role: id === clones ? 'player' : 'clone',
    x: start.x + 0.5,
    y: start.y,
    z: start.z + 0.5,
    vx: 0,
    vy: 0,
    vz: 0,
    dim: 2,
    grounded: true,
    status: 'active',
    coyote: COYOTE,
    buffer: 0,
    jumpHeld: false,
    shiftHeld: false,
    facing: 1,
    slab: null,
    cell: cellIndex(level.size, start),
  }));
  return { level, tick: 0, bodies, toggled: [], broken: [] };
}

export const playerOfFlow = (world: FlowWorld): Body => {
  const player = world.bodies[world.bodies.length - 1];
  if (!player) throw new Error('Invariant violated: a flow world always has a player');
  return player;
};

export function outcomeOfFlow(world: FlowWorld): FlowOutcome {
  const { status } = playerOfFlow(world);
  return status === 'exited' ? 'won' : status === 'fallen' ? 'fallen' : 'playing';
}

/** Channels held live right now: a lever left on, or a plate with someone standing on it. */
export function liveChannels(world: FlowWorld): Set<Channel> {
  const live = new Set<Channel>(world.toggled);
  for (const body of world.bodies) {
    if (body.status !== 'active' || !body.grounded) continue;
    const plate = cellOf(world.level, body.x, body.y, body.z).cell?.plate;
    if (plate) live.add(plate);
  }
  return live;
}

/** Whether the door in this cell bars the way. A door never closes on a body. */
export function doorClosed(world: FlowWorld, live: ReadonlySet<Channel>, cx: number, cy: number, cz: number): boolean {
  const cell = cellAt(world.level, vec(cx, cy, cz));
  if (!cell || cell.door === null) return false;
  if (live.has(cell.door) !== cell.inverted) return false;
  return !world.bodies.some(
    (b) => b.status === 'active' && b.x + HALF > cx && b.x - HALF < cx + 1 && b.y + HEIGHT > cy && b.y < cy + 1 && Math.floor(b.z) === cz,
  );
}

function solidAt(world: FlowWorld, live: ReadonlySet<Channel>, broken: ReadonlySet<number>, cx: number, cy: number, cz: number): boolean {
  const cell = cellAt(world.level, vec(cx, cy, cz));
  if (!cell) return false;
  if (cell.solid) return !(cell.fragile && broken.has(cellIndex(world.level.size, vec(cx, cy, cz))));
  return doorClosed(world, live, cx, cy, cz);
}

const approach = (value: number, target: number, step: number): number =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step);

/** Advances the world by one sixtieth of a second. `inputs` is index-aligned with the bodies. */
export function stepFlow(world: FlowWorld, inputs: readonly (FrameInput | null)[]): FlowWorld {
  const { level } = world;
  const live = liveChannels(world);
  const broken = new Set(world.broken);
  let toggled = world.toggled;
  const bodies = [...world.bodies];

  for (let i = 0; i < bodies.length; i++) {
    const before = bodies[i];
    if (!before || before.status !== 'active') continue;
    const input = inputs[i] ?? IDLE;
    const solid = (cx: number, cy: number, cz: number): boolean => solidAt({ ...world, bodies }, live, broken, cx, cy, cz);
    // The cells a box spans along z: one slice in 2D, the body's depth in 3D.
    const depth = (z: number, dim: 2 | 3): [number, number] => (dim === 2 ? [Math.floor(z), Math.floor(z)] : [Math.floor(z - HALF + EPS), Math.floor(z + HALF - EPS)]);
    const blocked = (x: number, y: number, z: number, dim: 2 | 3): boolean => {
      const [z0, z1] = depth(z, dim);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cy = Math.floor(y + EPS); cy <= Math.floor(y + HEIGHT - EPS); cy++) {
          for (let cx = Math.floor(x - HALF + EPS); cx <= Math.floor(x + HALF - EPS); cx++) {
            if (solid(cx, cy, cz)) return true;
          }
        }
      }
      return false;
    };

    let { x, y, z, vx, vy, vz, dim, coyote, buffer } = before;
    let { facing } = before;

    // Dimension first: it decides which keys mean what.
    const here = cellOf(level, x, y, z);
    if (input.shift && !before.shiftHeld && before.grounded && here.cell?.threshold) {
      dim = dim === 2 ? 3 : 2;
      if (dim === 2) {
        z = here.cz + 0.5;
        vz = 0;
      }
    }

    const accel = (before.grounded ? GROUND_ACCEL : AIR_ACCEL) * DT;
    // A diagonal is not a shortcut: the two axes share the running speed.
    const pace = dim === 3 && input.x !== 0 && input.z !== 0 ? RUN * Math.SQRT1_2 : RUN;
    vx = approach(vx, input.x * pace, accel);
    vz = dim === 3 ? approach(vz, input.z * pace, accel) : 0;
    if (input.x !== 0) facing = input.x;

    if (input.jump && !before.jumpHeld) buffer = BUFFER;
    else if (buffer > 0) buffer--;
    if (buffer > 0 && (before.grounded || coyote > 0)) {
      vy = JUMP_SPEED;
      buffer = 0;
      coyote = 0;
    } else if (!input.jump && vy > JUMP_SPEED * JUMP_CUT) {
      vy = JUMP_SPEED * JUMP_CUT;
    }
    vy = Math.max(-MAX_FALL, vy - GRAVITY * DT);

    // One axis at a time: slide along what stops the others.
    const nx = x + vx * DT;
    if (blocked(nx, y, z, dim)) {
      x = vx > 0 ? Math.floor(nx + HALF) - HALF - EPS : Math.ceil(nx - HALF) + HALF + EPS;
      if (blocked(x, y, z, dim)) x = before.x;
      vx = 0;
    } else {
      x = nx;
    }
    if (dim === 3) {
      const nz = z + vz * DT;
      if (blocked(x, y, nz, dim)) {
        z = vz > 0 ? Math.floor(nz + HALF) - HALF - EPS : Math.ceil(nz - HALF) + HALF + EPS;
        if (blocked(x, y, z, dim)) z = before.z;
        vz = 0;
      } else {
        z = nz;
      }
    }

    let grounded = false;
    const ny = y + vy * DT;
    if (blocked(x, ny, z, dim)) {
      if (vy <= 0) {
        y = Math.floor(ny + EPS) + 1;
        grounded = true;
      } else {
        y = Math.ceil(ny + HEIGHT) - 1 - HEIGHT - EPS;
      }
      vy = 0;
    } else {
      y = ny;
      // Heads are platforms: a body coming down onto another one stands on it. Nobody is
      // carried: if the one below walks away, the one above falls where it was.
      if (vy <= 0) {
        for (const other of bodies) {
          if (!other || other.id === before.id || other.status !== 'active') continue;
          const top = other.y + HEIGHT;
          const sameDepth = dim === 2 && other.dim === 2 ? Math.floor(other.z) === Math.floor(z) : Math.abs(other.z - z) < HALF * 2;
          if (sameDepth && Math.abs(other.x - x) < HALF * 2 - 0.05 && before.y >= top - EPS && y <= top) {
            y = top;
            vy = 0;
            grounded = true;
            break;
          }
        }
      }
    }
    coyote = grounded ? COYOTE : Math.max(0, coyote - 1);

    // What the feet rest on, to know which slab is being held.
    let slab: number | null = null;
    if (grounded) {
      const [z0] = depth(z, dim);
      for (const fx of [x, x - HALF + EPS, x + HALF - EPS]) {
        const under = vec(Math.floor(fx), Math.floor(y - 0.5), dim === 2 ? Math.floor(z) : z0);
        const cell = cellAt(level, under);
        if (cell?.solid && solid(under.x, under.y, under.z)) {
          slab = cell.fragile ? cellIndex(level.size, under) : null;
          break;
        }
      }
    }

    const now = cellOf(level, x, y, z);
    const index = now.cell ? cellIndex(level.size, vec(now.cx, now.cy, now.cz)) : -1;
    if (index !== before.cell && grounded && now.cell?.lever) {
      const lever = now.cell.lever;
      toggled = toggled.includes(lever) ? toggled.filter((c) => c !== lever) : [...toggled, lever].sort();
    }

    const status: Body['status'] = y < -3 ? 'fallen' : before.role === 'player' && now.cell?.exit ? 'exited' : 'active';
    bodies[i] = {
      ...before,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      dim,
      grounded,
      status,
      coyote,
      buffer,
      jumpHeld: input.jump,
      shiftHeld: input.shift,
      facing,
      slab,
      // A lever is only "arrived on" with the feet down: flying over it does nothing.
      cell: grounded ? index : before.cell === index ? index : -1,
    };
  }

  // A slab holds as long as someone stands on it, and goes when the last one has left.
  for (const was of world.bodies) {
    if (was.slab === null) continue;
    if (!bodies.some((b) => b.status === 'active' && b.slab === was.slab)) broken.add(was.slab);
  }

  return {
    level,
    tick: world.tick + 1,
    bodies,
    toggled,
    broken: broken.size === world.broken.length ? world.broken : [...broken].sort((a, b) => a - b),
  };
}
