import { describe, expect, it } from 'vitest';
import { levelFrom } from '../core/testing';
import { outcomeOfFlow } from './physics';
import { searchRun } from './search';
import { parseTape, runTape } from './tape';

const replay = (source: string, tape: string | null) => {
  const parsed = parseTape(tape ?? '');
  if (!parsed.ok) throw new Error(parsed.error);
  return outcomeOfFlow(runTape(levelFrom(source), parsed.value).world);
};

describe('searchRun on the side rules', () => {
  it('on ice, gaining half a cell a second is already somewhere else: it finds the way across', () => {
    const lake = `
name: lake
z=0
........
@......X
iiiiiiii
`;
    const found = searchRun(levelFrom(lake));
    expect(found.found).toBe(true);
    expect(replay(lake, found.tape)).toBe('won');
  });

  it('sends a crate over the ice to the plate that opens the way', () => {
    const curling = `
name: curling
z=0
.........#..
.........A..
@.o.....aA.X
iiiiiiii####
`;
    const found = searchRun(levelFrom(curling));
    expect(found.found).toBe(true);
    expect(replay(curling, found.tape)).toBe('won');
  });

  it('goes round a grid that wraps', () => {
    const ring = `
name: ring
wrap: x
z=0
..#.....
@.#...X.
########
`;
    const found = searchRun(levelFrom(ring));
    expect(found.found).toBe(true);
    expect(replay(ring, found.tape)).toBe('won');
    expect(searchRun(levelFrom(ring.replace('wrap: x', ''))).found).toBe(false);
  });
});
