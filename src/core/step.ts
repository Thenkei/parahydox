import { DOWN, UP, add, cellAt, cellIndex, sameCell, vec } from './grid';
import type { Actor, Dim, Dir, Input, Vec3, World } from './types';
import { actorAt, crateAt, isOccupied, isSolid, isWall } from './world';

/**
 * Advances the world by one step. Pure and deterministic: actors act in array order
 * (clones oldest → newest, then the player) and gravity settles after each of them.
 *
 * `inputs` is index-aligned with `world.actors`; null means the actor has nothing to do
 * (a clone whose log is exhausted stays where it is).
 *
 * An input that cannot be carried out is simply lost. That is the whole divergence rule:
 * clones replay inputs, not positions, so there is never a paradox to arbitrate.
 */
export function step(world: World, inputs: readonly (Input | null)[]): World {
  let next = world;
  for (let i = 0; i < next.actors.length; i++) {
    const input = inputs[i] ?? null;
    const before = next;
    const actor = next.actors[i];
    if (actor?.status === 'active') {
      if (actor.air > 0) next = fly(next, i, input);
      else if (input !== null) next = act(next, i, input);
    }
    next = resolveExit(pullLevers(before, settle(crumble(before, next))));
  }
  return { ...next, tick: world.tick + 1 };
}

/**
 * A fragile block holds as long as someone stands on it. The moment a character walks
 * off, it crumbles, and whatever else was resting there falls with the next settle.
 */
function crumble(before: World, after: World): World {
  const broken = new Set(after.broken);
  for (const was of before.actors) {
    const is = after.actors[was.id];
    if (!is || was.status !== 'active' || was.dim === 1 || sameCell(was.pos, is.pos)) continue;
    const support = add(was.pos, DOWN);
    if (!cellAt(after.level, support)?.fragile || !isSolid(after, support)) continue;
    const stillHeld = after.actors.some((a) => a.status === 'active' && a.dim !== 1 && sameCell(a.pos, was.pos));
    if (!stillHeld) broken.add(cellIndex(after.level.size, support));
  }
  return broken.size === after.broken.length ? after : { ...after, broken: [...broken].sort((a, b) => a - b) };
}

/** A lever flips each time a character arrives on its tile, however it got there. */
function pullLevers(before: World, after: World): World {
  let toggled = after.toggled;
  for (const is of after.actors) {
    const was = before.actors[is.id];
    if (!was || is.status !== 'active' || sameCell(was.pos, is.pos)) continue;
    const lever = cellAt(after.level, is.pos)?.lever;
    if (lever === null || lever === undefined) continue;
    toggled = toggled.includes(lever) ? toggled.filter((c) => c !== lever) : [...toggled, lever].sort();
  }
  return toggled === after.toggled ? after : { ...after, toggled };
}

function act(world: World, index: number, input: Input): World {
  switch (input.kind) {
    case 'wait':
      return world;
    case 'shift':
      return shift(world, index);
    case 'move':
      return move(world, index, input.dir);
  }
}

/** How far a jump carries sideways before gravity takes over again. */
const JUMP_REACH = 2;

/**
 * 2D only: up is a jump. The actor rises one cell and hangs there for two moves, enough
 * to clear a gap of one cell or to pass over something one cell high without touching it.
 * It needs ground to push off from and room overhead.
 */
function jump(world: World, index: number): World {
  const actor = actorOrThrow(world, index);
  const above = add(actor.pos, UP);
  if (!isSupported(world, actor.pos) || isWall(world, above) || isOccupied(world, above)) return world;
  return updateActor(world, index, { pos: above, air: JUMP_REACH });
}

/**
 * One turn in the air. Left and right drift one cell if the way is clear; nothing is
 * pushed or climbed in flight. Any other key, or no key at all, ends the jump at once.
 * Touching down early ends it too.
 */
function fly(world: World, index: number, input: Input | null): World {
  const actor = actorOrThrow(world, index);
  const sideways = input?.kind === 'move' && (input.dir === 'left' || input.dir === 'right') ? input.dir : null;
  if (sideways === null) {
    const grounded = updateActor(world, index, { air: 0 });
    return input === null || input.kind === 'wait' || input.kind === 'move' ? grounded : act(grounded, index, input);
  }
  const target = add(actor.pos, vec(sideways === 'right' ? 1 : -1, 0, 0));
  const pos = isWall(world, target) || isOccupied(world, target) ? actor.pos : target;
  const moved = updateActor(world, index, { pos, air: 0 });
  return isSupported(moved, pos) ? moved : updateActor(world, index, { pos, air: actor.air - 1 });
}

function actorOrThrow(world: World, index: number): Actor {
  const actor = world.actors[index];
  if (!actor) throw new Error(`Invariant violated: no actor at index ${index}`);
  return actor;
}

const updateActor = (world: World, index: number, patch: Partial<Actor>): World => ({
  ...world,
  actors: world.actors.map((a, i) => (i === index ? { ...a, ...patch } : a)),
});

/**
 * Transitions only happen on dedicated tiles. 2D is the mandatory hub: there is no
 * direct 1D ↔ 3D passage, which keeps every transition readable.
 */
function shift(world: World, index: number): World {
  const actor = actorOrThrow(world, index);
  const cell = cellAt(world.level, actor.pos);
  if (cell === null) return world;

  const target = ((): Dim | null => {
    switch (actor.dim) {
      case 1:
        return cell.anchor ? 2 : null;
      case 2:
        return cell.anchor ? 1 : cell.threshold ? 3 : null;
      case 3:
        return cell.threshold ? 2 : null;
    }
  })();
  return target === null ? world : updateActor(world, index, { dim: target });
}

function move(world: World, index: number, dir: Dir): World {
  const actor = actorOrThrow(world, index);
  if (actor.dim === 1) return moveOnWire(world, index, dir);
  if (actor.dim === 2 && dir === 'up') return jump(world, index);
  const delta = groundDelta(actor.dim, dir);
  return delta === null ? world : moveOnGround(world, index, delta);
}

/** In 2D the plane is fixed: left and right walk, up jumps. In 3D up/down walk along z. */
function groundDelta(dim: 2 | 3, dir: Dir): Vec3 | null {
  switch (dir) {
    case 'left':
      return vec(-1, 0, 0);
    case 'right':
      return vec(1, 0, 0);
    case 'up':
      return dim === 3 ? vec(0, 0, 1) : null;
    case 'down':
      return dim === 3 ? vec(0, 0, -1) : null;
  }
}

/**
 * 1D: forward or backward along the wire, steered by the direction the wire takes on
 * screen (a wire climbing a cliff is followed with "up"). Nothing can be walked around,
 * so any body or closed barrier on the next cell blocks the way. Gravity and the void do
 * not exist here.
 */
function moveOnWire(world: World, index: number, dir: Dir): World {
  const actor = actorOrThrow(world, index);
  const ref = cellAt(world.level, actor.pos)?.wire;
  const cells = ref ? world.level.wires[ref.wire]?.cells : undefined;
  if (!ref || !cells) return world;

  const forward = cells[ref.index + 1];
  const backward = cells[ref.index - 1];
  const target =
    forward && wireHeading(actor.pos, forward) === dir
      ? forward
      : backward && wireHeading(actor.pos, backward) === dir
        ? backward
        : null;
  if (target === null || isWall(world, target) || isOccupied(world, target)) return world;
  return updateActor(world, index, { pos: target });
}

/** Screen direction from one wire cell to the next. Depth reads as "up", like walking in 3D. */
export function wireHeading(from: Vec3, to: Vec3): Dir {
  if (to.x !== from.x) return to.x > from.x ? 'right' : 'left';
  if (to.y !== from.y) return to.y > from.y ? 'up' : 'down';
  return to.z > from.z ? 'up' : 'down';
}

/**
 * 2D and 3D: walk one cell. A crate in the way is pushed; whatever cannot be walked
 * through or pushed (a ledge, a stuck crate, another actor) is climbed if it is one cell
 * high. Taller obstacles stop the move, and drops are free: gravity settles afterwards.
 */
function moveOnGround(world: World, index: number, delta: Vec3): World {
  const actor = actorOrThrow(world, index);
  const target = add(actor.pos, delta);

  const crate = crateAt(world, target);
  if (crate !== null) {
    const beyond = add(target, delta);
    if (isWall(world, beyond) || isOccupied(world, beyond)) return climb(world, index, target);
    const pushed: World = {
      ...world,
      crates: world.crates.map((c) => (c.id === crate.id ? { ...c, pos: beyond } : c)),
    };
    return updateActor(pushed, index, { pos: target });
  }

  if (isWall(world, target) || actorAt(world, target) !== null) return climb(world, index, target);
  return updateActor(world, index, { pos: target });
}

/** Steps onto the top of `obstacle`, provided there is headroom to rise and room to land. */
function climb(world: World, index: number, obstacle: Vec3): World {
  const actor = actorOrThrow(world, index);
  const headroom = add(actor.pos, UP);
  const perch = add(obstacle, UP);
  const blocked = (p: Vec3): boolean => isWall(world, p) || isOccupied(world, p);
  return blocked(headroom) || blocked(perch) ? world : updateActor(world, index, { pos: perch });
}

type Faller = { readonly kind: 'actor'; readonly index: number } | { readonly kind: 'crate'; readonly id: number };

/** Lets every unsupported body fall, one cell at a time, until nothing moves. */
function settle(world: World): World {
  let next = grounded(world);
  for (;;) {
    const faller = findUnsupported(next);
    if (faller === null) return next;
    next = dropOne(next, faller);
  }
}

/**
 * Nobody is carried through the air: an actor in mid-jump with someone standing on its
 * head comes down at once. Without this a jumping clone would work as a lift.
 */
function grounded(world: World): World {
  const carriers = world.actors.filter(
    (a) => a.status === 'active' && a.air > 0 && world.actors.some((b) => b.status === 'active' && b.air === 0 && sameCell(b.pos, add(a.pos, UP))),
  );
  if (carriers.length === 0) return world;
  return { ...world, actors: world.actors.map((a) => (carriers.includes(a) ? { ...a, air: 0 } : a)) };
}

function isSupported(world: World, p: Vec3): boolean {
  const below = add(p, DOWN);
  if (below.y < 0) return false;
  return isWall(world, below) || isOccupied(world, below);
}

function findUnsupported(world: World): Faller | null {
  for (let index = 0; index < world.actors.length; index++) {
    const actor = world.actors[index];
    // 1D actors hang on their wire, and a jump holds its height for a moment.
    if (actor && actor.status === 'active' && actor.dim !== 1 && actor.air === 0 && !isSupported(world, actor.pos)) {
      return { kind: 'actor', index };
    }
  }
  for (const crate of world.crates) {
    if (!isSupported(world, crate.pos)) return { kind: 'crate', id: crate.id };
  }
  return null;
}

/** Falling below y = 0 means falling into the void: the actor's loop ends, a crate is lost. */
function dropOne(world: World, faller: Faller): World {
  if (faller.kind === 'actor') {
    const actor = actorOrThrow(world, faller.index);
    const pos = add(actor.pos, DOWN);
    return updateActor(world, faller.index, pos.y < 0 ? { pos, status: 'fallen' } : { pos });
  }
  return {
    ...world,
    crates: world.crates.flatMap((c) => {
      if (c.id !== faller.id) return [c];
      const pos = add(c.pos, DOWN);
      return pos.y < 0 ? [] : [{ ...c, pos }];
    }),
  };
}

/** Only the player can finish the level; a clone standing on the exit changes nothing. */
function resolveExit(world: World): World {
  const index = world.actors.length - 1;
  const player = world.actors[index];
  if (!player || player.status !== 'active') return world;
  return cellAt(world.level, player.pos)?.exit ? updateActor(world, index, { status: 'exited' }) : world;
}
