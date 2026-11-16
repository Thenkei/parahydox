import { cellAt, cellIndex, sameCell } from './grid';
import type { Actor, Channel, Crate, Level, Outcome, Vec3, World } from './types';

/**
 * Every loop starts from this state: all clones and the player share the start cell.
 * Bodies only collide when one *enters* a cell, so the shared spawn is legal.
 */
export function initialWorld(level: Level, cloneCount: number): World {
  const actors: Actor[] = [];
  for (let i = 0; i < cloneCount; i++) {
    actors.push({ id: i, role: 'clone', pos: level.start, dim: 2, status: 'active', air: 0 });
  }
  actors.push({ id: cloneCount, role: 'player', pos: level.start, dim: 2, status: 'active', air: 0 });
  return {
    level,
    tick: 0,
    actors,
    crates: level.crates.map((pos, id) => ({ id, pos })),
    toggled: [],
    broken: [],
  };
}

/** The player is always the last actor. */
export function playerOf(world: World): Actor {
  const player = world.actors[world.actors.length - 1];
  if (!player) throw new Error('Invariant violated: a world always holds a player');
  return player;
}

export function outcomeOf(world: World): Outcome {
  const { status } = playerOf(world);
  return status === 'exited' ? 'won' : status === 'fallen' ? 'fallen' : 'playing';
}

/** An actor that still takes up space. Fallen and exited actors have left the grid. */
export const actorAt = (world: World, p: Vec3): Actor | null =>
  world.actors.find((a) => a.status === 'active' && sameCell(a.pos, p)) ?? null;

export const crateAt = (world: World, p: Vec3): Crate | null =>
  world.crates.find((c) => sameCell(c.pos, p)) ?? null;

/** True when a body (actor or crate) fills the cell. */
export const isOccupied = (world: World, p: Vec3): boolean =>
  actorAt(world, p) !== null || crateAt(world, p) !== null;

/** A plate is held down by any body standing on it; any one plate of a channel is enough. */
export function isPlatePressed(world: World, channel: Channel): boolean {
  const plates = world.level.plates.get(channel) ?? [];
  return plates.some((p) => isOccupied(world, p));
}

/** A channel is live while one of its plates is held, or once a lever has switched it on. */
export const isChannelActive = (world: World, channel: Channel): boolean =>
  world.toggled.includes(channel) || isPlatePressed(world, channel);

/**
 * A door is open while its channel is live. Plates make that a derived fact; levers are
 * the one piece of door state that is stored. A door also never closes on a body, so an
 * occupied door cell counts as open.
 */
export function isDoorClosed(world: World, p: Vec3): boolean {
  const cell = cellAt(world.level, p);
  if (!cell || cell.door === null) return false;
  const open = isChannelActive(world, cell.door) !== cell.inverted;
  return !open && !isOccupied(world, p);
}

/** Terrain that is still there: a fragile block stops being solid once it has crumbled. */
export function isSolid(world: World, p: Vec3): boolean {
  const cell = cellAt(world.level, p);
  if (cell === null || !cell.solid) return false;
  return !(cell.fragile && world.broken.includes(cellIndex(world.level.size, p)));
}

/**
 * Static obstruction: solid terrain or a closed door. Outside the grid there is only
 * void: nothing stops a body from stepping out, and nothing holds it up once it has.
 */
export function isWall(world: World, p: Vec3): boolean {
  return isSolid(world, p) || isDoorClosed(world, p);
}
