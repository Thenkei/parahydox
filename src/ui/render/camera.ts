import { cellAt } from '../../core/grid';
import type { Level, World } from '../../core/types';
import { playerOf } from '../../core/world';

/**
 * One projection serves the three dimensions. The world is always drawn as an oblique
 * view whose depth can be folded flat:
 *
 *   depth = 0  →  the 2D slice: every layer collapses onto the plane, only `zRef` shows
 *   depth = 1  →  the 3D volume: layers behind the plane slide out up and to the right
 *
 * Changing dimension is therefore not a cut but a movement of the camera, and what was
 * hidden behind the plane literally comes out from behind it.
 */
export const DEPTH_X = 0.42;
export const DEPTH_Y = 0.56;

export interface Camera {
  /** Side of a cell on screen, in CSS pixels. */
  cell: number;
  /** Screen position of the world origin (x = 0, y = 0, on the plane zRef). */
  ox: number;
  oy: number;
  depth: number;
  zRef: number;
  /** 1 when the whole world is visible, 0 when only the wire exists (1D). */
  world: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** World coordinates are in cells, y up; a cell (x, y, z) spans [x, x+1] × [y, y+1] × [z, z+1]. */
export const project = (cam: Camera, x: number, y: number, z: number): Point => ({
  x: cam.ox + (x + DEPTH_X * cam.depth * (z - cam.zRef)) * cam.cell,
  y: cam.oy - (y + DEPTH_Y * cam.depth * (z - cam.zRef)) * cam.cell,
});

/** How visible a depth layer is: only the slice in 2D, everything in 3D. */
export const layerAlpha = (cam: Camera, z: number): number =>
  Math.min(1, Math.max(cam.depth, 1 - Math.abs(z - cam.zRef)));

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

const MAX_CELL = 84;
const MIN_CELL = 18;

/** One cell size per level, chosen so that the unfolded 3D view still fits the screen. */
export function cellSizeFor(level: Level, view: Viewport): number {
  const { w, h, d } = level.size;
  const deep = d > 1;
  const spanX = w + (deep ? DEPTH_X * d : 0) + 2;
  const spanY = h + (deep ? DEPTH_Y * d : 0) + 3.2;
  return Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(Math.min(view.width / spanX, view.height / spanY))));
}

/** Where the camera wants to be for this world: slice, volume or wire, centred on the level. */
export function cameraTarget(world: World, view: Viewport): Camera {
  const { level } = world;
  const { w, h, d } = level.size;
  const player = playerOf(world);
  const cell = cellSizeFor(level, view);

  let depth = 0;
  if (player.dim === 3) depth = 1;
  if (player.dim === 1) {
    // A wire that leaves its plane can only be followed if the depth is unfolded.
    const ref = cellAt(level, player.pos)?.wire;
    const cells = ref ? (level.wires[ref.wire]?.cells ?? []) : [];
    if (cells.some((c) => c.z !== cells[0]?.z)) depth = 1;
  }
  const zRef = depth === 0 ? Math.min(d - 1, Math.max(0, player.pos.z)) : 0;

  // Centre the footprint of what is visible: the slice alone, or the unfolded volume.
  const minX = 0;
  const maxX = w + DEPTH_X * depth * d;
  const minY = 0;
  const maxY = h + DEPTH_Y * depth * d;
  return {
    cell,
    depth,
    zRef,
    world: player.dim === 1 ? 0 : 1,
    ox: view.width / 2 - ((minX + maxX) / 2) * cell,
    // Slightly below centre: the HUD sits on top and islands hang below their ground.
    oy: view.height / 2 + ((minY + maxY) / 2) * cell + cell * 0.2,
  };
}

/** Moves `cam` toward `target`; `amount` is the share of the remaining distance covered. */
export function approach(cam: Camera, target: Camera, amount: number): void {
  const mix = (from: number, to: number): number => (Math.abs(to - from) < 0.0005 ? to : from + (to - from) * amount);
  cam.cell = target.cell;
  cam.ox = mix(cam.ox, target.ox);
  cam.oy = mix(cam.oy, target.oy);
  cam.depth = mix(cam.depth, target.depth);
  cam.world = mix(cam.world, target.world);
  // Folding back onto another plane: let the reference slide only while depth is open,
  // otherwise the 2D view would scrub through the layers in between.
  cam.zRef = cam.depth < 0.02 && target.depth === 0 ? target.zRef : mix(cam.zRef, target.zRef);
}
