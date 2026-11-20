import { cellAt, cellIndex, vec } from '../core/grid';
import type { Cell, Channel, Level, Vec3 } from '../core/types';

/**
 * The rules of the game. Bodies move continuously: they run, jump and fall, ride a wire as
 * a point (1D), walk a slice (2D) or the whole volume (3D), and a clone replays the keys
 * of a past loop frame by frame.
 *
 * Three side rules, each switched on by the level: ice (no grip), antipodes (clones that
 * fall upward) and wrapping (a grid without edges along x, y or both).
 *
 * The simulation is a pure function of the previous state and one input per body, at a
 * fixed 60 steps a second, so a loop replayed from its inputs is always the same loop.
 */
export const FPS = 60;
const DT = 1 / FPS;

const RUN = 5.2;
const GROUND_ACCEL = 70;
const AIR_ACCEL = 42;
/** Whoever has stood on ice has no grip, on the ground or in the air, until the feet rest on something that has. */
export const ICE_ACCEL = 5;
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
  /** The up and down arrows: depth in 3D (1 goes deeper), the wire's own way in 1D; nothing in 2D. */
  readonly z: -1 | 0 | 1;
  /** The jump key (Space), the only one in every dimension: the up arrow never jumps. */
  readonly jump: boolean;
  /** Change dimension on an anchor or a threshold. */
  readonly shift: boolean;
  /** One-frame equipment command, also recorded by clones. */
  readonly boots?: boolean;
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
  /** Centre of the box's underside: the feet, or the head of whoever falls upward. */
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
  readonly boots: boolean;
  readonly status: 'active' | 'fallen' | 'exited';
  readonly coyote: number;
  readonly buffer: number;
  readonly jumpHeld: boolean;
  readonly shiftHeld: boolean;
  readonly facing: 1 | -1;
  /** Index of the fragile slab the body stands on, if any. */
  readonly slab: number | null;
  /** The feet last rested on ice: no grip, through jumps and falls, until they rest on something else. */
  readonly slick: boolean;
  /** Index of the cell the feet are in, to notice arriving on a lever. */
  readonly cell: number;
}

export interface FlowCrate {
  readonly id: number;
  /** Centre of the base. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The pace it was last pushed at on ice, kept until something stops it; 0 at rest. */
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
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

/** Steps between two reversals of the hyperspace field. */
export const PULSE_TICKS = FPS * 2;

export function fallOf(level: Level, body: Pick<Body, 'role' | 'boots'>, tick = 0): 1 | -1 {
  if (level.gravity !== 'normal') {
    if (body.boots) return -1;
    return level.gravity === 'pulse' && Math.floor(tick / PULSE_TICKS) % 2 === 1 ? -1 : 1;
  }
  return level.antipode && body.role === 'clone' ? 1 : -1;
}

export function initialFlow(level: Level, clones: number): FlowWorld {
  const { start } = level;
  const onIce = cellAt(level, gridCell(level, start.x, start.y - 1, start.z))?.ice === true;
  const bodies: Body[] = Array.from({ length: clones + 1 }, (_, id) => {
    const role = id === clones ? 'player' : 'clone';
    // An antipode has nothing under its feet in the start cell: it leaves it falling upward.
    const standing = fallOf(level, { role, boots: false }) < 0;
    return {
      id,
      role,
      x: start.x + 0.5,
      y: start.y,
      z: start.z + 0.5,
      vx: 0,
      vy: 0,
      vz: 0,
      dim: 2,
      wire: null,
      grounded: standing,
      boots: false,
      status: 'active',
      coyote: standing ? COYOTE : 0,
      buffer: 0,
      jumpHeld: false,
      shiftHeld: false,
      facing: 1,
      slab: null,
      slick: standing && onIce,
      cell: cellIndex(level.size, start),
    };
  });
  const crates: FlowCrate[] = level.crates.map((p, id) => ({ id, x: p.x + 0.5, y: p.y, z: p.z + 0.5, vx: 0, vy: 0, vz: 0, grounded: true }));
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

/** A coordinate brought back into [0, span); one already there is returned as it is, to the last bit. */
const turned = (value: number, span: number): number => (value >= 0 && value < span ? value : ((value % span) + span) % span);

/** Where a point is kept: on a wrapped axis, what leaves by one side is on the other. */
const seamX = (level: Level, x: number): number => (level.wrap.x ? turned(x, level.size.w) : x);
const seamY = (level: Level, y: number): number => (level.wrap.y ? turned(y, level.size.h) : y);

/**
 * Where something is felt from `from`: across a seam, its copy nearest to there. Every
 * comparison of two places goes through these, so that a seam is nowhere in particular.
 */
const nearX = (level: Level, from: number, x: number): number => (level.wrap.x ? x + level.size.w * Math.round((from - x) / level.size.w) : x);
const nearY = (level: Level, from: number, y: number): number => (level.wrap.y ? y + level.size.h * Math.round((from - y) / level.size.h) : y);

/** The cell at these coordinates. A box near a seam asks for column -1 or w: on a wrapped axis that is the other side. */
function gridCell(level: Level, cx: number, cy: number, cz: number): Vec3 {
  return vec(level.wrap.x ? turned(cx, level.size.w) : cx, level.wrap.y ? turned(cy, level.size.h) : cy, cz);
}

/** The cell a point of the world is in. */
const cellUnder = (level: Level, x: number, y: number, z: number): Vec3 => gridCell(level, Math.floor(x), Math.floor(y + EPS), Math.floor(z));

/** The grid cell a body is in: the one its box starts in, or the nearest one along its wire. */
export function cellOfBody(level: Level, body: Pick<Body, 'x' | 'y' | 'z' | 'wire'>): Vec3 {
  if (body.wire !== null) {
    const cells = level.wires[body.wire.id]?.cells ?? [];
    const node = cells[Math.round(body.wire.s)];
    if (node) return node;
  }
  return cellUnder(level, body.x, body.y, body.z);
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

/** Whether two boxes of a level overlap, the second taken where it is nearest to the first. */
function touches(level: Level, a: Box, b: Box): boolean {
  if (!level.wrap.x && !level.wrap.y) return overlaps(a, b);
  const dx = nearX(level, (a.x0 + a.x1) / 2, (b.x0 + b.x1) / 2) - (b.x0 + b.x1) / 2;
  const dy = nearY(level, (a.y0 + a.y1) / 2, (b.y0 + b.y1) / 2) - (b.y0 + b.y1) / 2;
  return overlaps(a, { x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy, z0: b.z0, z1: b.z1 });
}

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
    const plate = cellAt(level, cellUnder(level, crate.x, crate.y, crate.z))?.plate;
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
    } else if (touches(scene.level, doorway, bodyBox(b.x, b.y, b.z, b.dim))) return false;
  }
  for (const c of scene.crates) {
    if (touches(scene.level, doorway, crateBox(c.x, c.y, c.z))) return false;
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
  const at = gridCell(scene.level, cx, cy, cz);
  const cell = cellAt(scene.level, at);
  if (!cell) return false;
  if (cell.solid) return !(cell.fragile && scene.broken.has(cellIndex(scene.level.size, at)));
  // A barrier threaded on a wire bars the wire, not the air around it: only a rider is stopped.
  return cell.wire === null && doorShut(scene, cell, at.x, at.y, at.z);
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
  scene.crates.find((c) => c.id !== except && touches(scene.level, box, crateBox(c.x, c.y, c.z))) ?? null;

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
    return touches(scene.level, box, body) && !touches(scene.level, now, body);
  });
}

/** The block a crate rests on, under its centre; null over a void, on another crate or on a head. */
function crateFloor(scene: Scene, crate: FlowCrate): Cell | null {
  const under = gridCell(scene.level, Math.floor(crate.x), Math.floor(crate.y - 0.5), Math.floor(crate.z));
  const cell = cellAt(scene.level, under);
  return cell?.solid && solidCell(scene, under.x, under.y, under.z) ? cell : null;
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
    const at = gridCell(level, Math.floor(x), Math.floor(height), Math.floor(z));
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
  const here = cellAt(level, cellUnder(level, body.x, body.y, body.z));
  if (!(body.grounded && here?.threshold)) return null;
  return body.dim === 2 ? 'unfold' : 'fold';
}

// ------------------------------------------------------------------------------- walking

/**
 * Moves a body one axis at a time. A crate met on the ground is pushed, anything else stops.
 * Along a wrapped x the place returned may lie past the seam: the caller brings it back.
 */
function slide(scene: Scene, before: Body, axis: 'x' | 'z', x: number, y: number, z: number, dim: 2 | 3, speed: number, pushedDeep: Set<number>): { at: number; speed: number } {
  const { level } = scene;
  const from = axis === 'x' ? x : z;
  const to = from + speed * DT;
  const boxAt = (value: number): Box => (axis === 'x' ? bodyBox(value, y, z, dim) : bodyBox(x, y, value, dim));
  const stopAt = (value: number): { at: number; speed: number } => ({ at: blocked(scene, boxAt(value)) ? from : value, speed: 0 });

  // Beside the grid there is only void, and no way back from it: whoever has gone over the
  // side keeps falling. Otherwise the outside would be a way round every wall. A grid that
  // wraps along x has no side to go over.
  if (axis === 'x' && !level.wrap.x && (from + HALF <= 0 ? to + HALF > 0 : from - HALF >= level.size.w && to - HALF < level.size.w)) {
    return { at: from, speed: 0 };
  }
  // The volume has a front and a back: depth ends with the grid, there is no way round outside it.
  if (axis === 'z' && (to - HALF < 0 || to + HALF > level.size.d)) {
    return { at: Math.min(level.size.d - HALF, Math.max(HALF, from)), speed: 0 };
  }
  if (terrainHits(scene, boxAt(to))) {
    return stopAt(speed > 0 ? Math.floor(to + HALF) - HALF - EPS : Math.ceil(to - HALF) + HALF + EPS);
  }
  const crate = crateHit(scene, boxAt(to));
  if (crate === null) return { at: to, speed };

  const dir = Math.sign(speed) || 1;
  const reach = HALF + CRATE_HALF;
  const centre = axis === 'x' ? nearX(level, from, crate.x) : crate.z;
  const against = centre - dir * (reach + EPS);
  // Already inside it (a crate fell there): walk out, never push.
  if (touches(level, boxAt(from), crateBox(crate.x, crate.y, crate.z))) return { at: to, speed };
  if (!(before.grounded && crate.grounded)) return stopAt(against);

  const pace = Math.min(Math.abs(speed), PUSH);
  const pushed = from + dir * pace * DT;
  const moved = pushed + dir * reach;
  if (dir * (moved - centre) <= 0) return { at: pushed, speed: dir * pace };
  const index = scene.crates.indexOf(crate);
  const fits = axis === 'x' ? crateFits(scene, crate, moved, crate.y, crate.z) : crateFits(scene, crate, crate.x, crate.y, moved);
  if (!fits || index < 0) return stopAt(against);
  const shoved: FlowCrate = axis === 'x' ? { ...crate, x: seamX(level, moved) } : { ...crate, z: moved };
  // Stone holds a crate where it is left. Ice does not: the crate keeps the pace of the push.
  // Over an edge nothing holds it and nothing sends it: it keeps the pace it had.
  const floor = crateFloor(scene, shoved);
  const pushOff = floor === null ? (axis === 'x' ? crate.vx : crate.vz) : floor.ice ? dir * pace : 0;
  scene.crates[index] = axis === 'x' ? { ...shoved, vx: pushOff } : { ...shoved, vz: pushOff };
  if (axis === 'z') pushedDeep.add(crate.id);
  return { at: pushed, speed: dir * pace };
}

/** 2D and 3D: run, jump, fall, push; or leave the plane on an anchor or a threshold. */
function walk(scene: Scene, before: Body, from: 2 | 3, input: FrameInput, pushedDeep: Set<number>, fall: 1 | -1): Body {
  const { level } = scene;
  // An antipode is the same body with the vertical turned over: its ground is a ceiling, and
  // it jumps downward. Its box stays [y, y + HEIGHT] like everyone's.
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
    const here = cellAt(level, cellUnder(level, x, y, z));
    if (before.grounded && here?.threshold) {
      dim = dim === 2 ? 3 : 2;
      if (dim === 2) {
        z = Math.floor(z) + 0.5;
        vz = 0;
      }
    }
  }

  const accel = (before.slick ? ICE_ACCEL : before.grounded ? GROUND_ACCEL : AIR_ACCEL) * DT;
  // A diagonal is not a shortcut: the two axes share the running speed.
  const pace = dim === 3 && input.x !== 0 && input.z !== 0 ? RUN * Math.SQRT1_2 : RUN;
  vx = approach(vx, input.x * pace, accel);
  vz = dim === 3 ? approach(vz, input.z * pace, accel) : 0;
  if (input.x !== 0) facing = input.x;

  // Only Space jumps. The up arrow used to jump in a slice too, but it means "deeper" one
  // E away, and the same finger did one thing in 2D and another in 3D.
  const jumping = input.jump;
  if (jumping && !before.jumpHeld) buffer = BUFFER;
  else if (buffer > 0) buffer--;
  if (buffer > 0 && (before.grounded || coyote > 0)) {
    vy = -fall * JUMP_SPEED;
    buffer = 0;
    coyote = 0;
  } else if (!jumping && -fall * vy > JUMP_SPEED * JUMP_CUT) {
    vy = -fall * JUMP_SPEED * JUMP_CUT;
  }
  vy = fall < 0 ? Math.max(-MAX_FALL, vy - GRAVITY * DT) : Math.min(MAX_FALL, vy + GRAVITY * DT);

  // One axis at a time: slide along what stops the others.
  if (vx !== 0) ({ at: x, speed: vx } = slide(scene, before, 'x', x, y, z, dim, vx, pushedDeep));
  if (dim === 3 && vz !== 0) ({ at: z, speed: vz } = slide(scene, before, 'z', x, y, z, dim, vz, pushedDeep));

  let grounded = false;
  const ny = y + vy * DT;
  const box = bodyBox(x, ny, z, dim);
  const onTerrain = terrainHits(scene, box);
  const onCrate = crateHit(scene, box);
  // Going the way it falls, a body comes to rest on what it meets; going the other way it bumps.
  const falling = fall < 0 ? vy <= 0 : vy >= 0;
  if (onTerrain || onCrate !== null) {
    const down = falling === fall < 0;
    if (down) {
      // Come down on the highest thing under the box.
      let top = onTerrain ? Math.floor(ny + EPS) + 1 : -Infinity;
      for (const c of scene.crates) if (touches(level, box, crateBox(c.x, c.y, c.z))) top = Math.max(top, nearY(level, ny, c.y) + CRATE_HEIGHT);
      y = falling ? top : top + EPS;
    } else {
      // Come up under the lowest thing over the box.
      let ceiling = onTerrain ? Math.ceil(ny + HEIGHT) - 1 : Infinity;
      for (const c of scene.crates) if (touches(level, box, crateBox(c.x, c.y, c.z))) ceiling = Math.min(ceiling, nearY(level, ny, c.y));
      y = falling ? ceiling - HEIGHT : ceiling - HEIGHT - EPS;
    }
    grounded = falling;
    vy = 0;
  } else {
    y = ny;
    // Heads are platforms: a body falling onto another one comes to rest against it, on its
    // top or, falling upward, under its bottom. Nobody is carried: if the one who holds
    // walks away, the one held falls where it was.
    if (falling) {
      for (const other of scene.bodies) {
        if (other.id === before.id || other.status !== 'active') continue;
        const sameDepth = dim === 2 && other.dim === 2 ? Math.floor(other.z) === Math.floor(z) : Math.abs(other.z - z) < HALF * 2;
        if (!(sameDepth && Math.abs(nearX(level, x, other.x) - x) < HALF * 2 - 0.05)) continue;
        const theirs = nearY(level, before.y, other.y);
        const rest = fall < 0 ? theirs + HEIGHT : theirs - HEIGHT;
        // Whoever bumps into the crate on their own head is set back by exactly one EPS: an
        // antipode holding them up allows for it, or rounding alone would decide if it lets go.
        if (fall < 0 ? before.y >= rest - EPS && y <= rest : before.y <= rest + EPS * 1.5 && y >= rest) {
          y = rest;
          vy = 0;
          grounded = true;
          break;
        }
      }
    }
  }
  coyote = grounded ? COYOTE : Math.max(0, coyote - 1);

  // What the feet rest on: a slab to hold, ice that takes the grip away. A crate or a head
  // is neither, and gives the grip back.
  let slab: number | null = null;
  let { slick } = before;
  if (grounded) {
    slick = false;
    const layer = Math.floor(bodyBox(x, y, z, dim).z0 + EPS);
    const row = Math.floor(fall < 0 ? y - 0.5 : y + HEIGHT + 0.5);
    for (const fx of [x, x - HALF + EPS, x + HALF - EPS]) {
      const under = gridCell(level, Math.floor(fx), row, layer);
      const cell = cellAt(level, under);
      if (cell?.solid && solidCell(scene, under.x, under.y, under.z)) {
        slab = cell.fragile ? cellIndex(level.size, under) : null;
        slick = cell.ice;
        break;
      }
    }
  }

  return { ...before, x: seamX(level, x), y: seamY(level, y), z, vx, vy, vz, dim, wire: null, grounded, coyote, buffer, jumpHeld: jumping, shiftHeld: input.shift, facing, slab, slick };
}

// -------------------------------------------------------------------------------- crates

/**
 * A crate set going on ice keeps going. The ice carries it, and so does the edge it is
 * sliding off; stone grips it, and so does whatever is in its way: a sliding crate pushes
 * nothing. This runs before anyone moves, so that whoever pushes it again this step finds
 * it where its own pace has taken it, and only ever makes it faster.
 */
function slideCrates(scene: Scene): void {
  const { level } = scene;
  for (const [index, resting] of scene.crates.entries()) {
    if (resting.vx === 0 && resting.vz === 0) continue;
    let crate = resting;
    const floor = crateFloor(scene, crate);
    if (floor !== null && !floor.ice) {
      crate = { ...crate, vx: 0, vz: 0 };
    } else {
      if (crate.vx !== 0) {
        const x = crate.x + crate.vx * DT;
        crate = crateFits(scene, crate, x, crate.y, crate.z) ? { ...crate, x: seamX(level, x) } : { ...crate, vx: 0 };
      }
      if (crate.vz !== 0) {
        const z = crate.z + crate.vz * DT;
        crate = crateFits(scene, crate, crate.x, crate.y, z) ? { ...crate, z } : { ...crate, vz: 0 };
      }
    }
    scene.crates[index] = crate;
  }
}

/**
 * Lowest first, so that a stack comes down together. Along a wrapped y nothing is lowest:
 * the order starts above the widest gap between crates, the one place no stack can span.
 */
function fallOrder(level: Level, crates: readonly FlowCrate[]): FlowCrate[] {
  const order = [...crates].sort((a, b) => a.y - b.y || a.id - b.id);
  if (!level.wrap.y) return order;
  let first = 0;
  let widest = -Infinity;
  for (const [i, crate] of order.entries()) {
    const below = order[i - 1]?.y ?? ((order[order.length - 1]?.y ?? 0) - level.size.h);
    if (crate.y - below > widest) {
      widest = crate.y - below;
      first = i;
    }
  }
  return [...order.slice(first), ...order.slice(0, first)];
}

/** Crates fall, rest on the ground, on each other or on a head, and settle into a slice. */
function settleCrates(scene: Scene, pushedDeep: ReadonlySet<number>): void {
  const { level } = scene;
  for (const listed of fallOrder(level, scene.crates)) {
    const index = scene.crates.findIndex((c) => c.id === listed.id);
    let crate = scene.crates[index];
    if (!crate) continue;

    // A crate still sliding in depth is not between two slices yet.
    if (!pushedDeep.has(crate.id) && crate.vz === 0) {
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
      const theirs = nearY(level, crate.y, other.y);
      if (other.id !== crate.id && theirs < crate.y && touches(level, box, crateBox(other.x, other.y, other.z))) top = Math.max(top, theirs + CRATE_HEIGHT);
    }
    for (const body of scene.bodies) {
      if (body.status !== 'active') continue;
      const head = nearY(level, crate.y, body.y) + HEIGHT;
      if (crate.y >= head - EPS && ny <= head && touches(level, { ...box, y0: head - 1, y1: head + 1 }, { ...bodyBox(body.x, body.y, body.z, body.dim), y0: head - 1, y1: head + 1 })) {
        top = Math.max(top, head);
      }
    }
    const landed = top > -Infinity;
    // A crate at rest stays the same object: most frames change nothing.
    if (!(landed && crate.y === top && crate.vy === 0 && crate.grounded)) {
      // In the air a crate falls straight down, whatever pace it left the ice with.
      crate = landed ? { ...crate, y: seamY(level, top), vy: 0, grounded: true } : { ...crate, y: seamY(level, ny), vx: 0, vy, vz: 0, grounded: false };
    }
    // A grid that wraps along y has no bottom to fall out of.
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

  slideCrates(scene);

  for (let i = 0; i < scene.bodies.length; i++) {
    const before = scene.bodies[i];
    if (!before || before.status !== 'active') continue;
    const input = inputs[i] ?? IDLE;
    const equipped = input.boots && level.gravity !== 'normal' ? { ...before, boots: !before.boots } : before;
    const fall = fallOf(level, equipped, world.tick);
    const body = level.gravity !== 'normal' && fall !== fallOf(level, before, Math.max(0, world.tick - 1))
      ? { ...equipped, grounded: false, coyote: 0, buffer: 0 }
      : equipped;
    const moved = body.dim === 1 && body.wire !== null ? rideWire(scene, body, body.wire, input) : walk(scene, body, body.dim === 3 ? 3 : 2, input, pushedDeep, fall);

    if (moved.dim === 1) {
      scene.bodies[i] = moved;
      continue;
    }
    const at = cellUnder(level, moved.x, moved.y, moved.z);
    const cell = cellAt(level, at);
    const index = cell ? cellIndex(level.size, at) : -1;
    if (index !== before.cell && moved.grounded && cell?.lever) {
      const lever = cell.lever;
      toggled = toggled.includes(lever) ? toggled.filter((c) => c !== lever) : [...toggled, lever].sort();
    }
    // Out by the bottom, or by the top for who falls upward. Along a wrapped y there is no out.
    const gone = moved.y < -3 || ((level.gravity !== 'normal' || fall > 0) && moved.y > level.size.h + 3);
    const status: Body['status'] = gone ? 'fallen' : before.role === 'player' && cell?.exit ? 'exited' : 'active';
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
