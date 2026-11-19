import { describe, expect, it } from 'vitest';
import type { Level } from '../../core/types';
import type { Camera } from './camera';
import { GHOST_CELLS, copiesOf, ghostAlpha, seamCell, shifted } from './seam';

/** Only what the seam reads: the size of the grid and which edges are joined. */
const levelOf = (w: number, h: number, wrap: { x: boolean; y: boolean }): Level => ({ size: { w, h, d: 1 }, wrap }) as unknown as Level;

const flat = levelOf(10, 6, { x: false, y: false });
const ring = levelOf(10, 6, { x: true, y: false });
const torus = levelOf(10, 6, { x: true, y: true });

describe('seamCell', () => {
  it('leaves coordinates alone where nothing is joined', () => {
    expect(seamCell(flat, -1, 7, 0)).toEqual({ x: -1, y: 7, z: 0 });
  });

  it('names the cell on the other side of a joined edge', () => {
    expect(seamCell(ring, -1, 2, 0)).toEqual({ x: 9, y: 2, z: 0 });
    expect(seamCell(ring, 10, -1, 0)).toEqual({ x: 0, y: -1, z: 0 });
    expect(seamCell(torus, 10, -1, 0)).toEqual({ x: 0, y: 5, z: 0 });
  });
});

describe('ghostAlpha', () => {
  it('is whole inside the grid and gone past the ghost strip', () => {
    expect(ghostAlpha(0)).toBe(1);
    expect(ghostAlpha(GHOST_CELLS)).toBe(0);
  });

  it('fades the further it is from the edge', () => {
    expect(ghostAlpha(0.5)).toBeGreaterThan(ghostAlpha(1));
    expect(ghostAlpha(1)).toBeGreaterThan(ghostAlpha(1.5));
  });
});

describe('copiesOf', () => {
  it('draws a thing once in a level without joined edges', () => {
    expect(copiesOf(flat, -0.5, 0.5, 0, 1)).toEqual([{ dx: 0, dy: 0, alpha: 1 }]);
  });

  it('draws a body straddling a side seam whole on both sides', () => {
    const copies = copiesOf(ring, 9.6, 10.4, 1, 1.9);
    expect(copies).toContainEqual({ dx: 0, dy: 0, alpha: 1 });
    expect(copies).toContainEqual({ dx: -10, dy: 0, alpha: 1 });
    expect(copies).toHaveLength(2);
  });

  it('announces on the far side a body nearing an edge, faintly', () => {
    const far = copiesOf(ring, 0.2, 1, 1, 1.9).find((copy) => copy.dx === 10);
    expect(far?.alpha).toBeGreaterThan(0);
    expect(far?.alpha).toBeLessThan(1);
  });

  it('shows nothing across a seam from the middle of the level', () => {
    expect(copiesOf(torus, 4, 5, 2, 3)).toEqual([{ dx: 0, dy: 0, alpha: 1 }]);
  });

  it('crosses both seams at a corner of a torus', () => {
    const copies = copiesOf(torus, 9.6, 10.4, 5.5, 6.4);
    expect(copies.map(({ dx, dy }) => `${dx},${dy}`).sort()).toEqual(['-10,-6', '-10,0', '0,-6', '0,0']);
  });
});

describe('shifted', () => {
  const cam = { ox: 100, oy: 400, cell: 40 } as Camera;

  it('slides the view by whole widths and heights, screen y growing downward', () => {
    const moved = shifted(cam, { dx: -10, dy: 6 });
    expect(moved.ox).toBe(100 - 400);
    expect(moved.oy).toBe(400 - 240);
  });

  it('returns the same camera for the copy that is the thing itself', () => {
    expect(shifted(cam, { dx: 0, dy: 0 })).toBe(cam);
  });
});
