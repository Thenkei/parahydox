import type { Level, Vec3 } from '../../core/types';
import type { Camera } from './camera';

/**
 * A level that wraps has no edge along an axis: its left side is its right side. On screen
 * the grid is still a rectangle, so what lies just past a joined edge is drawn there too,
 * fading: a copy of the far side of the level, and of whoever is about to arrive from it.
 * Nothing here knows about the rules; it only says where a thing is seen, and how solidly.
 */

/** How many cells of the far side are shown past a joined edge. */
export const GHOST_CELLS = 2;
/** How solid the copy is right at the edge; it has faded out `GHOST_CELLS` further. */
const GHOST_ALPHA = 0.62;

/** One place where a thing is drawn: itself (no offset) or a copy across a joined edge. */
export interface Copy {
  /** Offset in cells, a multiple of the level's width and height. */
  readonly dx: number;
  readonly dy: number;
  readonly alpha: number;
}

const HERE: readonly Copy[] = [{ dx: 0, dy: 0, alpha: 1 }];

const turned = (value: number, span: number): number => ((value % span) + span) % span;

/** The grid cell these coordinates name: across a joined edge, the cell on the other side. */
export const seamCell = (level: Level, x: number, y: number, z: number): Vec3 => ({
  x: level.wrap.x ? turned(x, level.size.w) : x,
  y: level.wrap.y ? turned(y, level.size.h) : y,
  z,
});

/**
 * How visible a copy is, `d` cells outside the grid. What still overlaps the grid is really
 * there and fully drawn; past the edge it drops to a ghost at once, then fades with distance.
 */
export const ghostAlpha = (d: number): number => (d <= 0 ? 1 : Math.max(0, 1 - d * 5, GHOST_ALPHA * (1 - d / GHOST_CELLS)));

/** How far the span [a, b] lies outside [0, size]; 0 when they overlap. */
const outside = (a: number, b: number, size: number): number => Math.max(0, a - size, -b);

/**
 * Every place the box [x0, x1] × [y0, y1] is seen: where it is, and across each joined edge
 * it is close to. A body halfway through a seam is thus whole on both sides, and one coming
 * up to an edge is already announced on the other.
 */
export function copiesOf(level: Level, x0: number, x1: number, y0: number, y1: number): readonly Copy[] {
  if (!level.wrap.x && !level.wrap.y) return HERE;
  const { w, h } = level.size;
  const copies: Copy[] = [];
  for (const j of level.wrap.y ? [-1, 0, 1] : [0]) {
    for (const i of level.wrap.x ? [-1, 0, 1] : [0]) {
      const alpha = i === 0 && j === 0 ? 1 : ghostAlpha(Math.hypot(outside(x0 + i * w, x1 + i * w, w), outside(y0 + j * h, y1 + j * h, h)));
      if (alpha > 0.01) copies.push({ dx: i * w, dy: j * h, alpha });
    }
  }
  return copies;
}

/** The camera that draws a copy: the same view, the world slid by the copy's offset. */
export const shifted = (cam: Camera, copy: Pick<Copy, 'dx' | 'dy'>): Camera =>
  copy.dx === 0 && copy.dy === 0 ? cam : { ...cam, ox: cam.ox + copy.dx * cam.cell, oy: cam.oy - copy.dy * cam.cell };
