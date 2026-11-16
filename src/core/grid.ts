import type { Cell, Level, Size, Vec3 } from './types';

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export const sameCell = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

export const UP: Vec3 = vec(0, 1, 0);
export const DOWN: Vec3 = vec(0, -1, 0);

export const inBounds = (size: Size, p: Vec3): boolean =>
  p.x >= 0 && p.x < size.w && p.y >= 0 && p.y < size.h && p.z >= 0 && p.z < size.d;

export const cellIndex = (size: Size, p: Vec3): number => p.x + size.w * (p.y + size.h * p.z);

/** The static cell at `p`, or null outside the grid. */
export const cellAt = (level: Level, p: Vec3): Cell | null =>
  inBounds(level.size, p) ? (level.cells[cellIndex(level.size, p)] ?? null) : null;
