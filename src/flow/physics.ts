import { cellAt, cellIndex, vec } from '../core/grid';
import type { Cell, Channel, Level, Vec3 } from '../core/types';

/**
 * The rules of the game. Bodies move continuously: they run, jump and fall, ride a wire as
 * a point (1D), walk a slice (2D) or the whole volume (3D), and a clone replays the keys
 * of a past loop frame by frame.
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
/** A crate is heavy: whoever pushes it walks at half pace. */
const PUSH = 2.6;
const CRATE_HALF = 0.45;
/** As tall as a head is high: a crate and a clone are the same step. */
export const CRATE_HEIGHT = 0.9;
/** A crate left between two slices slides back into the nearest one. */
const LANE_SPEED = 3;
/** On a wire there is no inertia: a point of light goes or stops. */
const WIRE_SPEED = 5.2;
/** How close to an anchor a rider must be to step off the wire, in cells. */
const ANCHOR_REACH = 0.35;
const EPS = 1e-4;

/**
 * The keys held during one frame, not what they did: the same keys mean something else in
 * another dimension, and a clone that has ended up elsewhere replays them there.
 */
export interface FrameInput {
  /** -1 left, 1 right. */
  readonly x: -1 | 0 | 1;
  /** The up and down arrows: a jump in 2D (up), depth in 3D (1 goes deeper), the wire's own way in 1D. */
  readonly z: -1 | 0 | 1;
  /** The jump key proper (Space). */
  readonly jump: boolean;
  /** Change dimension on an anchor or a threshold. */
  readonly shift: boolean;
}

export const IDLE: FrameInput = { x: 0, z: 0, jump: false, shift: false };

export interface WireHold {
  readonly id: number;
  /** Position along the wire in cells, 0 being its first anchor. */
  readonly s: number;
}

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
  readonly dim: 1 | 2 | 3;
  /** The wire being ridden, in 1D only. */
  readonly wire: WireHold | null;
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

export interface FlowCrate {
  readonly id: number;
  /** Centre of the base. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vy: number;
  readonly grounded: boolean;
}

export interface FlowWorld {
  readonly level: Level;
  readonly tick: number;
  /** Clones oldest first, the player last. */
  readonly bodies: readonly Body[];
  readonly crates: readonly FlowCrate[];
  readonly toggled: readonly Channel[];
  readonly broken: readonly number[];
}

export type FlowOutcome = 'playing' | 'won' | 'fallen';

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
    wire: null,
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
  const crates: FlowCrate[] = level.crates.map((p, id) => ({ id, x: p.x + 0.5, y: p.y, z: p.z + 0.5, vy: 0, grounded: true }));
  return { level, tick: 0, bodies, crates, toggled: [], broken: [] };
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

// ------------------------------------------------------------------------------ geometry

/** The grid cell a body is in: the one under its feet, or the nearest one along its wire. */
export function cellOfBody(level: Level, body: Pick<Body, 'x' | 'y' | 'z' | 'wire'>): Vec3 {
  if (body.wire !== null) {
    const cells = level.wires[body.wire.id]?.cells ?? [];
    const node = cells[Math.round(body.wire.s)];
    if (node) return node;
  }
  return vec(Math.floor(body.x), Math.floor(body.y + EPS), Math.floor(body.z));
}

interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
}

/** Outside 3D a body is as thin as its slice: it only ever touches one layer. */
const bodyBox = (x: number, y: number, z: number, dim: 1 | 2 | 3): Box => {
  const centre = dim === 3 ? z : Math.floor(z) + 0.5;
  return { x0: x - HALF, x1: x + HALF, y0: y, y1: y + HEIGHT, z0: centre - HALF, z1: centre + HALF };
};

const crateBox = (x: number, y: number, z: number): Box => ({
  x0: x - CRATE_HALF,
  x1: x + CRATE_HALF,
  y0: y,
  y1: y + CRATE_HEIGHT,
  z0: z - CRATE_HALF,
  z1: z + CRATE_HALF,
});

const overlaps = (a: Box, b: Box): boolean =>
  a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;

/** What a step reads and moves: the arrays are the step's own copies. */
interface Scene {
  readonly level: Level;
  readonly live: ReadonlySet<Channel>;
  readonly broken: ReadonlySet<number>;
  readonly bodies: Body[];
  readonly crates: FlowCrate[];
}

/** Channels held live right now: a lever left on, or a plate with a body or a crate on it. */
export function liveChannels(world: Pick<FlowWorld, 'level' | 'bodies' | 'crates' | 'toggled'>): Set<Channel> {
  const { level } = world;
  const live = new Set<Channel>(world.toggled);
  for (const body of world.bodies) {
    // A rider weighs nothing, but a plate threaded on its wire still feels it pass.
    if (body.status !== 'active' || !(body.grounded || body.dim === 1)) continue;
    const plate = cellAt(level, cellOfBody(level, body))?.plate;
    if (plate) live.add(plate);
  }
  for (const crate of world.crates) {
    if (!crate.grounded) continue;
    const plate = cellAt(level, vec(Math.floor(crate.x), Math.floor(crate.y + EPS), Math.floor(crate.z)))?.plate;
    if (plate) live.add(plate);
  }
  return live;
}

/** A door never closes on a body or a crate: an occupied doorway counts as open. */
function doorShut(scene: Scene, cell: Cell, cx: number, cy: number, cz: number): boolean {
  if (cell.door === null) return false;
  if (scene.live.has(cell.door) !== cell.inverted) return false;
  const doorway: Box = { x0: cx, x1: cx + 1, y0: cy, y1: cy + 1, z0: cz, z1: cz + 1 };
  for (const b of scene.bodies) {
    if (b.status !== 'active') continue;
    // A rider is a point: it is in the doorway only once the barrier's cell is its own.
    if (b.dim === 1) {
      const at = cellOfBody(scene.level, b);
      if (at.x === cx && at.y === cy && at.z === cz) return false;
    } else if (overlaps(bodyBox(b.x, b.y, b.z, b.dim), doorway)) return false;
  }
  for (const c of scene.crates) {
    if (overlaps(crateBox(c.x, c.y, c.z), doorway)) return false;
  }
  return true;
}

/** Whether the door in this cell bars the way. */
export function doorClosed(world: FlowWorld, live: ReadonlySet<Channel>, cx: number, cy: number, cz: number): boolean {
  const cell = cellAt(world.level, vec(cx, cy, cz));
  if (!cell) return false;
  return doorShut({ level: world.level, live, broken: new Set(), bodies: world.bodies as Body[], crates: world.crates as FlowCrate[] }, cell, cx, cy, cz);
}

function solidCell(scene: Scene, cx: number, cy: number, cz: number): boolean {
  const at = vec(cx, cy, cz);
  const cell = cellAt(scene.level, at);
  if (!cell) return false;
  if (cell.solid) return !(cell.fragile && scene.broken.has(cellIndex(scene.level.size, at)));
  // A barrier threaded on a wire bars the wire, not the air around it: only a rider is stopped.
  return cell.wire === null && doorShut(scene, cell, cx, cy, cz);
}

/** Terrain and closed doors in the way of a box. */
function terrainHits(scene: Scene, box: Box): boolean {
  for (let cz = Math.floor(box.z0 + EPS); cz <= Math.floor(box.z1 - EPS); cz++) {
    for (let cy = Math.floor(box.y0 + EPS); cy <= Math.floor(box.y1 - EPS); cy++) {
      for (let cx = Math.floor(box.x0 + EPS); cx <= Math.floor(box.x1 - EPS); cx++) {
        if (solidCell(scene, cx, cy, cz)) return true;
      }
    }
  }
  return false;
}

const crateHit = (scene: Scene, box: Box, except = -1): FlowCrate | null =>
  scene.crates.find((c) => c.id !== except && overlaps(box, crateBox(c.x, c.y, c.z))) ?? null;

const blocked = (scene: Scene, box: Box): boolean => terrainHits(scene, box) || crateHit(scene, box) !== null;

/**
 * Whether a crate may be at this place. Bodies it already overlaps are ignored, so that
 * nothing can ever get wedged; any other body in the way stops it.
 */
function crateFits(scene: Scene, crate: FlowCrate, x: number, y: number, z: number): boolean {
  const box = crateBox(x, y, z);
  // Like bodies, crates stay within the depth of the grid.
  if (box.z0 < -EPS || box.z1 > scene.level.size.d + EPS) return false;
  if (terrainHits(scene, box) || crateHit(scene, box, crate.id) !== null) return false;
  const now = crateBox(crate.x, crate.y, crate.z);
  return !scene.bodies.some((b) => {
    if (b.status !== 'active') return false;
    const body = bodyBox(b.x, b.y, b.z, b.dim);
    return overlaps(body, box) && !overlaps(body, now);
  });
}

const approach = (value: number, target: number, step: number): number =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step);

// --------------------------------------------------------------------------------- wires

/** Where a rider is in the world: the centre of the cell's floor, slid along the wire. */
function wirePoint(cells: readonly Vec3[], s: number): Vec3 {
  const i = Math.min(Math.max(0, Math.floor(s)), Math.max(0, cells.length - 2));
  const a = cells[i];
  const b = cells[i + 1] ?? a;
  if (!a || !b) throw new Error('Invariant violated: a wire has at least two cells');
  const f = s - i;
  return vec(a.x + (b.x - a.x) * f + 0.5, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f + 0.5);
}

/** A wire is followed with the arrow that points along it; depth reads as "up", as in 3D. */
function follows(input: FrameInput, from: Vec3, to: Vec3): boolean {
  if (to.x !== from.x) return input.x === Math.sign(to.x - from.x);
  return input.z === Math.sign(to.y !== from.y ? to.y - from.y : to.z - from.z);
}

/** 1D: no gravity, no way round. The rider slides along its wire and stops at what bars it. */
function rideWire(scene: Scene, before: Body, hold: WireHold, input: FrameInput): Body {
  const { level } = scene;
  const cells = level.wires[hold.id]?.cells ?? [];
  const last = cells.length - 1;
  let s = hold.s;

  // Stepping off: only at an anchor, and only if there is room to stand there.
  if (input.shift && !before.shiftHeld) {
    const end = s <= ANCHOR_REACH ? 0 : s >= last - ANCHOR_REACH ? last : null;
    const anchor = end === null ? undefined : cells[end];
    if (anchor && !blocked(scene, bodyBox(anchor.x + 0.5, anchor.y, anchor.z + 0.5, 2))) {
      return {
        ...before,
        x: anchor.x + 0.5,
        y: anchor.y,
        z: anchor.z + 0.5,
        vx: 0,
        vy: 0,
        vz: 0,
        dim: 2,
        wire: null,
        grounded: false,
        coyote: 0,
        buffer: 0,
        jumpHeld: input.jump,
        shiftHeld: true,
        slab: null,
        cell: -1,
      };
    }
  }

  let budget = WIRE_SPEED * DT;
  for (let turn = 0; turn < 4 && budget > EPS; turn++) {
    const node = Math.round(s);
    const atNode = Math.abs(s - node) < EPS;
    const lower = atNode ? node : Math.floor(s);
    const ahead = cells[atNode ? node + 1 : lower + 1];
    const behind = cells[atNode ? node - 1 : lower];
    const here = cells[atNode ? node : lower];
    const there = cells[atNode ? node : lower + 1];
    const dir = ahead && here && follows(input, here, ahead) ? 1 : behind && there && follows(input, there, behind) ? -1 : 0;
    if (dir === 0) break;
    const goal = dir > 0 ? (atNode ? node + 1 : lower + 1) : atNode ? node - 1 : lower;
    const reach = Math.abs(goal - s);
    const stride = Math.min(budget, reach);
    const next = stride === reach ? goal : s + dir * stride;

    // A barrier on the wire is a door like any other: it stops the rider at its edge.
    const cellNow = Math.round(s);
    const target = cells[Math.round(next)];
    const barrier = target ? cellAt(level, target) : null;
    if (Math.round(next) !== cellNow && target && barrier && doorShut(scene, barrier, target.x, target.y, target.z)) {
      const edge = cellNow + dir * (0.5 - 0.02);
      s = dir > 0 ? Math.max(s, Math.min(next, edge)) : Math.min(s, Math.max(next, edge));
      break;
    }
    // So is a crate sitting on the wire.
    const p = wirePoint(cells, next);
    const probe: Box = { x0: p.x - 0.2, x1: p.x + 0.2, y0: p.y + 0.25, y1: p.y + 0.65, z0: p.z - 0.2, z1: p.z + 0.2 };
    if (crateHit(scene, probe) !== null) break;
    s = next;
    budget -= stride;
  }

  const at = wirePoint(cells, s);
  return {
    ...before,
    x: at.x,
    y: at.y,
    z: at.z,
    vx: 0,
    vy: 0,
    vz: 0,
    wire: { id: hold.id, s },
    grounded: false,
    coyote: 0,
    buffer: 0,
    jumpHeld: input.jump,
    shiftHeld: input.shift,
    facing: input.x !== 0 ? input.x : before.facing,
    slab: null,
    cell: -1,
  };
}

/** The anchor within reach of a body in 2D: under its feet, or at its chest when it is in the air. */
function anchorAt(level: Level, x: number, y: number, z: number): { at: Vec3; hold: WireHold } | null {
  for (const height of [y + EPS, y + HEIGHT / 2]) {
    const at = vec(Math.floor(x), Math.floor(height), Math.floor(z));
    const cell = cellAt(level, at);
    if (cell?.anchor && cell.wire) return { at, hold: { id: cell.wire.wire, s: cell.wire.index } };
  }
  return null;
}

/** What E would do for this body right now: the same test the step applies, for the HUD. */
export type Transition = 'onto-wire' | 'off-wire' | 'unfold' | 'fold';

export function transitionAt(level: Level, body: Body): Transition | null {
  if (body.status !== 'active') return null;
  if (body.dim === 1) {
    const last = (level.wires[body.wire?.id ?? -1]?.cells.length ?? 0) - 1;
    const s = body.wire?.s ?? -1;
    return s >= 0 && (s <= ANCHOR_REACH || s >= last - ANCHOR_REACH) ? 'off-wire' : null;
  }
  if (body.dim === 2 && anchorAt(level, body.x, body.y, body.z) !== null) return 'onto-wire';
  const here = cellAt(level, vec(Math.floor(body.x), Math.floor(body.y + EPS), Math.floor(body.z)));
  if (!(body.grounded && here?.threshold)) return null;
  return body.dim === 2 ? 'unfold' : 'fold';
}

// ------------------------------------------------------------------------------- walking

/** Moves a body one axis at a time. A crate met on the ground is pushed, anything else stops. */
function slide(scene: Scene, before: Body, axis: 'x' | 'z', x: number, y: number, z: number, dim: 2 | 3, speed: number, pushedDeep: Set<number>): { at: number; speed: number } {
  const from = axis === 'x' ? x : z;
  const to = from + speed * DT;
  const boxAt = (value: number): Box => (axis === 'x' ? bodyBox(value, y, z, dim) : bodyBox(x, y, value, dim));
  const stopAt = (value: number): { at: number; speed: number } => ({ at: blocked(scene, boxAt(value)) ? from : value, speed: 0 });

  // Beside the grid there is only void, and no way back from it: whoever has gone over the
  // side keeps falling. Otherwise the outside would be a way round every wall.
  if (axis === 'x' && (from + HALF <= 0 ? to + HALF > 0 : from - HALF >= scene.level.size.w && to - HALF < scene.level.size.w)) {
    return { at: from, speed: 0 };
  }
  // The volume has a front and a back: depth ends with the grid, there is no way round outside it.
  if (axis === 'z' && (to - HALF < 0 || to + HALF > scene.level.size.d)) {
    return { at: Math.min(scene.level.size.d - HALF, Math.max(HALF, from)), speed: 0 };
  }
  if (terrainHits(scene, boxAt(to))) {
    return stopAt(speed > 0 ? Math.floor(to + HALF) - HALF - EPS : Math.ceil(to - HALF) + HALF + EPS);
  }
  const crate = crateHit(scene, boxAt(to));
  if (crate === null) return { at: to, speed };

  const dir = Math.sign(speed) || 1;
  const reach = HALF + CRATE_HALF;
  const centre = axis === 'x' ? crate.x : crate.z;
  const against = centre - dir * (reach + EPS);
  // Already inside it (a crate fell there): walk out, never push.
  if (overlaps(boxAt(from), crateBox(crate.x, crate.y, crate.z))) return { at: to, speed };
  if (!(before.grounded && crate.grounded)) return stopAt(against);

  const pace = Math.min(Math.abs(speed), PUSH);
  const pushed = from + dir * pace * DT;
  const moved = pushed + dir * reach;
  if (dir * (moved - centre) <= 0) return { at: pushed, speed: dir * pace };
  const index = scene.crates.indexOf(crate);
  const fits = axis === 'x' ? crateFits(scene, crate, moved, crate.y, crate.z) : crateFits(scene, crate, crate.x, crate.y, moved);
  if (!fits || index < 0) return stopAt(against);
  scene.crates[index] = axis === 'x' ? { ...crate, x: moved } : { ...crate, z: moved };
  if (axis === 'z') pushedDeep.add(crate.id);
  return { at: pushed, speed: dir * pace };
}

/** 2D and 3D: run, jump, fall, push; or leave the plane on an anchor or a threshold. */
function walk(scene: Scene, before: Body, from: 2 | 3, input: FrameInput, pushedDeep: Set<number>): Body {
  const { level } = scene;
  let { x, y, z, vx, vy, vz, coyote, buffer } = before;
  let { facing } = before;
  let dim: 2 | 3 = from;

  // Dimension first: it decides which keys mean what.
  if (input.shift && !before.shiftHeld) {
    const anchor = dim === 2 ? anchorAt(level, x, y, z) : null;
    if (anchor !== null) {
      // Onto the wire: from the ground or caught in mid-air.
      return {
        ...before,
        x: anchor.at.x + 0.5,
        y: anchor.at.y,
        z: anchor.at.z + 0.5,
        vx: 0,
        vy: 0,
        vz: 0,
        dim: 1,
        wire: anchor.hold,
        grounded: false,
        coyote: 0,
        buffer: 0,
        jumpHeld: input.jump,
        shiftHeld: true,
        slab: null,
        cell: -1,
      };
    }
    const here = cellAt(level, vec(Math.floor(x), Math.floor(y + EPS), Math.floor(z)));
    if (before.grounded && here?.threshold) {
      dim = dim === 2 ? 3 : 2;
      if (dim === 2) {
        z = Math.floor(z) + 0.5;
        vz = 0;
      }
    }
  }

  const accel = (before.grounded ? GROUND_ACCEL : AIR_ACCEL) * DT;
  // A diagonal is not a shortcut: the two axes share the running speed.
  const pace = dim === 3 && input.x !== 0 && input.z !== 0 ? RUN * Math.SQRT1_2 : RUN;
  vx = approach(vx, input.x * pace, accel);
  vz = dim === 3 ? approach(vz, input.z * pace, accel) : 0;
  if (input.x !== 0) facing = input.x;

  // In a slice the up arrow has nowhere to go: it jumps.
  const jumping = input.jump || (dim === 2 && input.z > 0);
  if (jumping && !before.jumpHeld) buffer = BUFFER;
  else if (buffer > 0) buffer--;
  if (buffer > 0 && (before.grounded || coyote > 0)) {
    vy = JUMP_SPEED;
    buffer = 0;
    coyote = 0;
  } else if (!jumping && vy > JUMP_SPEED * JUMP_CUT) {
    vy = JUMP_SPEED * JUMP_CUT;
  }
  vy = Math.max(-MAX_FALL, vy - GRAVITY * DT);

  // One axis at a time: slide along what stops the others.
  if (vx !== 0) ({ at: x, speed: vx } = slide(scene, before, 'x', x, y, z, dim, vx, pushedDeep));
  if (dim === 3 && vz !== 0) ({ at: z, speed: vz } = slide(scene, before, 'z', x, y, z, dim, vz, pushedDeep));

  let grounded = false;
  const ny = y + vy * DT;
  const box = bodyBox(x, ny, z, dim);
  const onTerrain = terrainHits(scene, box);
  const onCrate = crateHit(scene, box);
  if (onTerrain || onCrate !== null) {
    if (vy <= 0) {
      // Come down on the highest thing under the feet.
      let top = onTerrain ? Math.floor(ny + EPS) + 1 : -Infinity;
      for (const c of scene.crates) if (overlaps(box, crateBox(c.x, c.y, c.z))) top = Math.max(top, c.y + CRATE_HEIGHT);
      y = top;
      grounded = true;
    } else {
      let ceiling = onTerrain ? Math.ceil(ny + HEIGHT) - 1 : Infinity;
      for (const c of scene.crates) if (overlaps(box, crateBox(c.x, c.y, c.z))) ceiling = Math.min(ceiling, c.y);
      y = ceiling - HEIGHT - EPS;
    }
    vy = 0;
  } else {
    y = ny;
    // Heads are platforms: a body coming down onto another one stands on it. Nobody is
    // carried: if the one below walks away, the one above falls where it was.
    if (vy <= 0) {
      for (const other of scene.bodies) {
        if (other.id === before.id || other.status !== 'active') continue;
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
    const layer = Math.floor(bodyBox(x, y, z, dim).z0 + EPS);
    for (const fx of [x, x - HALF + EPS, x + HALF - EPS]) {
      const under = vec(Math.floor(fx), Math.floor(y - 0.5), layer);
      const cell = cellAt(level, under);
      if (cell?.solid && solidCell(scene, under.x, under.y, under.z)) {
        slab = cell.fragile ? cellIndex(level.size, under) : null;
        break;
      }
    }
  }

  return { ...before, x, y, z, vx, vy, vz, dim, wire: null, grounded, coyote, buffer, jumpHeld: jumping, shiftHeld: input.shift, facing, slab };
}

// -------------------------------------------------------------------------------- crates

/** Crates fall, rest on the ground, on each other or on a head, and settle into a slice. */
function settleCrates(scene: Scene, pushedDeep: ReadonlySet<number>): void {
  // Lowest first, so that a stack comes down together.
  const order = [...scene.crates].sort((a, b) => a.y - b.y || a.id - b.id);
  for (const listed of order) {
    const index = scene.crates.findIndex((c) => c.id === listed.id);
    let crate = scene.crates[index];
    if (!crate) continue;

    if (!pushedDeep.has(crate.id)) {
      const lane = Math.round(crate.z - 0.5) + 0.5;
      if (Math.abs(crate.z - lane) > EPS) {
        const z = approach(crate.z, lane, LANE_SPEED * DT);
        if (crateFits(scene, crate, crate.x, crate.y, z)) crate = { ...crate, z };
      }
    }

    const vy = Math.max(-MAX_FALL, crate.vy - GRAVITY * DT);
    const ny = crate.y + vy * DT;
    const box = crateBox(crate.x, ny, crate.z);
    let top = terrainHits(scene, box) ? Math.floor(ny + EPS) + 1 : -Infinity;
    for (const other of scene.crates) {
      if (other.id !== crate.id && other.y < crate.y && overlaps(box, crateBox(other.x, other.y, other.z))) top = Math.max(top, other.y + CRATE_HEIGHT);
    }
    for (const body of scene.bodies) {
      if (body.status !== 'active') continue;
      const head = body.y + HEIGHT;
      if (crate.y >= head - EPS && ny <= head && overlaps({ ...box, y0: head - 1, y1: head + 1 }, { ...bodyBox(body.x, body.y, body.z, body.dim), y0: head - 1, y1: head + 1 })) {
        top = Math.max(top, head);
      }
    }
    const landed = top > -Infinity;
    // A crate at rest stays the same object: most frames change nothing.
    if (!(landed && crate.y === top && crate.vy === 0 && crate.grounded)) {
      crate = landed ? { ...crate, y: top, vy: 0, grounded: true } : { ...crate, y: ny, vy, grounded: false };
    }
    if (crate.y < -3) scene.crates.splice(index, 1);
    else scene.crates[index] = crate;
  }
}

// ---------------------------------------------------------------------------------- step

/** Advances the world by one sixtieth of a second. `inputs` is index-aligned with the bodies. */
export function stepFlow(world: FlowWorld, inputs: readonly (FrameInput | null)[]): FlowWorld {
  const { level } = world;
  const broken = new Set(world.broken);
  const scene: Scene = { level, live: liveChannels(world), broken, bodies: [...world.bodies], crates: [...world.crates] };
  const pushedDeep = new Set<number>();
  let toggled = world.toggled;

  for (let i = 0; i < scene.bodies.length; i++) {
    const before = scene.bodies[i];
    if (!before || before.status !== 'active') continue;
    const input = inputs[i] ?? IDLE;
    const moved = before.dim === 1 && before.wire !== null ? rideWire(scene, before, before.wire, input) : walk(scene, before, before.dim === 3 ? 3 : 2, input, pushedDeep);

    if (moved.dim === 1) {
      scene.bodies[i] = moved;
      continue;
    }
    const at = vec(Math.floor(moved.x), Math.floor(moved.y + EPS), Math.floor(moved.z));
    const cell = cellAt(level, at);
    const index = cell ? cellIndex(level.size, at) : -1;
    if (index !== before.cell && moved.grounded && cell?.lever) {
      const lever = cell.lever;
      toggled = toggled.includes(lever) ? toggled.filter((c) => c !== lever) : [...toggled, lever].sort();
    }
    const status: Body['status'] = moved.y < -3 ? 'fallen' : before.role === 'player' && cell?.exit ? 'exited' : 'active';
    scene.bodies[i] = {
      ...moved,
      status,
      // A lever is only "arrived on" with the feet down: flying over it does nothing.
      cell: moved.grounded ? index : before.cell === index ? index : -1,
    };
  }

  if (scene.crates.length > 0) settleCrates(scene, pushedDeep);

  // A slab holds as long as someone stands on it, and goes when the last one has left.
  // Leaving it by a wire is not leaving it on foot: a rider weighs nothing.
  for (const was of world.bodies) {
    if (was.slab === null) continue;
    if (scene.bodies[was.id]?.dim === 1) continue;
    if (!scene.bodies.some((b) => b.status === 'active' && b.slab === was.slab)) broken.add(was.slab);
  }

  return {
    level,
    tick: world.tick + 1,
    bodies: scene.bodies,
    crates: world.crates.length === scene.crates.length && world.crates.every((c, k) => c === scene.crates[k]) ? world.crates : scene.crates,
    toggled,
    broken: broken.size === world.broken.length ? world.broken : [...broken].sort((a, b) => a - b),
  };
}
