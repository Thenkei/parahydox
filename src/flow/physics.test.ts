import { describe, expect, it } from 'vitest';
import { levelFrom } from '../core/testing';
import type { Level } from '../core/types';
import { type FlowWorld, liveChannels, outcomeOfFlow, playerOfFlow } from './physics';
import { parseTape, runTape } from './tape';

const run = (level: Level, tape: string, settle = 0): FlowWorld => {
  const parsed = parseTape(tape);
  if (!parsed.ok) throw new Error(parsed.error);
  return runTape(level, parsed.value, settle).world;
};
const hero = (level: Level, tape: string, settle = 0) => playerOfFlow(run(level, tape, settle));

const flat = levelFrom(`
name: flat
z=0
....................
@..................X
####################
`);

describe('running and jumping', () => {
  it('a held jump peaks a little over one cell, never two', () => {
    let top = 0;
    for (let frames = 1; frames < 40; frames++) top = Math.max(top, hero(flat, `J${frames}`).y);
    expect(top - 1).toBeGreaterThan(1.05);
    expect(top - 1).toBeLessThan(1.6);
  });

  it('a tapped jump is much lower than a held one', () => {
    const apex = (tape: string): number => {
      let top = 0;
      const parsed = parseTape(tape);
      if (!parsed.ok) throw new Error(parsed.error);
      for (let n = 1; n <= (parsed.value[0]?.length ?? 0); n++) top = Math.max(top, playerOfFlow(runTape(flat, [parsed.value[0]?.slice(0, n) ?? []]).world).y);
      return top - 1;
    };
    expect(apex('J3 _40')).toBeLessThan(apex('J30 _10') * 0.6);
  });

  it('running reaches a steady speed of about five cells a second', () => {
    const a = hero(flat, 'R60').x;
    const b = hero(flat, 'R90').x;
    expect((b - a) * 2).toBeGreaterThan(4.5);
    expect((b - a) * 2).toBeLessThan(6);
  });

  it('a tape too long to be a run is refused, not built', () => {
    expect(parseTape('R999999999').ok).toBe(false);
    expect(parseTape('R20000 | L20000').ok).toBe(false);
    expect(parseTape('R600 | L600').ok).toBe(true);
  });

  it('is deterministic: the same tape ends in the same place', () => {
    expect(run(flat, 'R40 RJ20 L30 J8 R12')).toEqual(run(flat, 'R40 RJ20 L30 J8 R12'));
  });

  it('the up arrow jumps in a slice, like the jump key', () => {
    expect(hero(flat, 'U12').y).toBeCloseTo(hero(flat, 'J12').y, 6);
    expect(hero(flat, 'U12').y).toBeGreaterThan(1.5);
  });

  it('a clone replays the keys of the loop before, frame for frame', () => {
    const level = levelFrom(`
name: twice
clones: 1
z=0
....................
@..................X
####################
`);
    const world = run(level, 'R60 RJ20 _30 | _110');
    expect(world.bodies[0]?.x).toBeCloseTo(hero(level, 'R60 RJ20 _30').x, 6);
    expect(playerOfFlow(world).x).toBeCloseTo(0.5, 6);
  });

  it('beside the grid there is only void, and no way back from it', () => {
    // A jump that overshoots the exit ends outside the grid: steering back does not bring it in.
    const tower = levelFrom(`
name: tower
z=0
.....
@....
###.X
###.#
`);
    expect(outcomeOfFlow(run(tower, 'R30 RJ30 R30 L60', 60))).toBe('fallen');
  });

  it('a head is a platform, and nobody is carried', () => {
    const wall = levelFrom(`
name: wall
clones: 1
z=0
..........
.........X
.....#####
@....#####
##########
`);
    // Alone, two cells are a wall.
    expect(hero(wall, 'R50 RJ30 RJ1 RJ30 R30', 20).y).toBeLessThan(2);
    // From the head of a clone standing at its foot, they are two jumps.
    const climbed = run(wall, 'R60 | _40 R28 RJ20 _10 RJ26 R60');
    expect(outcomeOfFlow(climbed)).toBe('won');
  });
});

describe('crates', () => {
  const yard = levelFrom(`
name: yard
z=0
..............
@..o.........X
#####..#######
#####..#######
##############
`);

  it('a crate is pushed by walking into it, at half pace', () => {
    const pushed = run(yard, 'R60');
    const crate = pushed.crates[0];
    expect(crate?.x).toBeGreaterThan(3.6);
    expect(playerOfFlow(pushed).x).toBeLessThan(hero(flat, 'R60').x - 0.5);
    // The crate stays against whoever pushes it.
    expect((crate?.x ?? 0) - playerOfFlow(pushed).x).toBeCloseTo(0.75, 2);
  });

  it('a crate pushed over an edge falls, and what it lands on carries it', () => {
    const crate = run(yard, 'R110', 30).crates[0];
    expect(crate?.y).toBeCloseTo(1, 5);
    expect(crate?.grounded).toBe(true);
  });

  it('a crate is a step: from its top, the wall it leans on can be jumped', () => {
    // In the pit alone, two cells are too high; the crate that fell in makes it one jump.
    const out = hero(yard, 'R110 _30 LJ6 _6 J6 RJ6 R6 _6 R12', 10);
    expect(out.y).toBeCloseTo(3, 5);
    expect(out.x).toBeGreaterThan(7);
  });

  it('a crate cannot be pushed from the air: it is a wall to whoever jumps into it', () => {
    const world = run(yard, 'R12 RJ30', 0);
    expect(world.crates[0]?.x).toBeCloseTo(3.5, 5);
  });

  it('a crate holds a plate, and a doorway it stands in cannot close', () => {
    const level = levelFrom(`
name: hands
z=0
.......#..
.......A..
@.o.a#.A.X
##########
`);
    const world = run(level, 'R70', 10);
    expect(liveChannels(world).has('a')).toBe(true);
    // The hero has let go: the door stays open because the crate has not.
    const through = run(level, 'R70 J6 R12 RJ6 R80');
    expect(outcomeOfFlow(through)).toBe('won');
  });

  it('two crates in a row do not move', () => {
    const level = levelFrom(`
name: row
z=0
..........
@..oo....X
##########
`);
    const world = run(level, 'R120');
    // The first closes the hand's breadth between them, then both stand still.
    expect(world.crates[0]?.x).toBeLessThan(3.7);
    expect(world.crates[1]?.x).toBe(4.5);
  });
});

describe('wires', () => {
  const span = levelFrom(`
name: span
glyph: ! = wire + door a
z=0
#................
#@..*====!===*..X
#####...a....####
#####........####
`);

  it('E on an anchor folds the body into the wire, and the void no longer matters', () => {
    const riding = hero(span, 'R34 _6 E1 R30');
    expect(riding.dim).toBe(1);
    expect(riding.y).toBe(2);
    expect(riding.x).toBeGreaterThan(6);
  });

  it('a wire is only left at an anchor', () => {
    const middle = hero(span, 'R34 _6 E1 R30 _2 E1 _30');
    expect(middle.dim).toBe(1);
  });

  it('a barrier on the wire stops the rider until its plate is held', () => {
    const stopped = hero(span, 'R34 _6 E1 R200');
    expect(stopped.dim).toBe(1);
    expect(stopped.x).toBeLessThan(9);
  });

  it('a barrier bars the wire, not the air around it: a walker goes through', () => {
    const level = levelFrom(`
name: ring
glyph: ! = wire + door a
z=0
.........a
..........
@*==!==*.X
##########
`);
    expect(outcomeOfFlow(run(level, 'R200'))).toBe('won');
    expect(hero(level, 'R8 E1 R200').x).toBeLessThan(4);
  });

  it('without the wire, the same void is a fall', () => {
    expect(outcomeOfFlow(run(span, 'R200'))).toBe('fallen');
  });

  const lift = levelFrom(`
name: lift
z=0
...=====*.X.
...=....####
#..=....####
#@.*....####
########....
`);

  it('a wire is followed with the arrow that points along it, and turns', () => {
    // Holding up stops at the corner; right takes over from there.
    const corner = hero(lift, 'R18 _6 E1 U80');
    expect(corner.y).toBe(4);
    expect(corner.x).toBeCloseTo(3.5, 5);
    expect(outcomeOfFlow(run(lift, 'R18 _6 E1 U40 R70 E1 R40'))).toBe('won');
  });

  it('both arrows held together round the corner without stopping', () => {
    const rounded = hero(lift, 'R18 _6 E1 UR50');
    expect(rounded.x).toBeGreaterThan(4);
  });

  it('an anchor can be caught in mid-air', () => {
    const level = levelFrom(`
name: catch
z=0
..........
....*===*X
@.......##
###.....##
`);
    expect(hero(level, 'R200').status).toBe('fallen');
    const caught = hero(level, 'R36 RJ6 _6 E1 R6');
    expect(caught.dim).toBe(1);
  });

  it('a rider does not fall, weighs on a plate threaded on its wire, and its head carries', () => {
    const level = levelFrom(`
name: stone
clones: 1
glyph: _ = wire + plate a
z=0
........#...
........A...
@.*=_*..A..X
###.....####
`);
    const world = run(level, 'R22 E1 R24 _20');
    expect(playerOfFlow(world).dim).toBe(1);
    expect(liveChannels(world).has('a')).toBe(true);
  });

  it('a crate sitting on the wire bars it', () => {
    const level = levelFrom(`
name: plug
glyph: % = wire + crate
z=0
............
@*===%==*..X
############
`);
    const stopped = hero(level, 'R8 E1 R200');
    expect(stopped.dim).toBe(1);
    expect(stopped.x).toBeLessThan(5);
  });
});

describe('the volume', () => {
  const room = levelFrom(`
name: room
z=0
........
@^.....X
########
z=1
........
....o...
########
z=2
........
........
########
`);

  it('a threshold unfolds the depth, and folding back keeps the slice reached', () => {
    const deep = hero(room, 'R10 _8 E1 _3 U30');
    expect(deep.dim).toBe(3);
    expect(deep.z).toBeGreaterThan(2);
    expect(hero(room, 'R10 _8 E1 _3 E1 _3').dim).toBe(2);
  });

  it('depth ends with the grid: there is no way round in front of it or behind it', () => {
    expect(hero(room, 'R10 _8 E1 _3 D60').z).toBeGreaterThanOrEqual(0.3);
    expect(hero(room, 'R10 _8 E1 _3 U90').z).toBeLessThanOrEqual(2.7);
    expect(hero(room, 'R10 _8 E1 _3 D60').status).toBe('active');
  });

  it('a diagonal is not faster than a straight line', () => {
    const straight = hero(room, 'R10 _8 E1 _3 U13').z;
    const diagonal = hero(room, 'R10 _8 E1 _3 UR13').z;
    expect(diagonal).toBeLessThan(straight);
  });

  it('a crate pushed in depth settles into the nearest slice', () => {
    // From the front slice, push the crate of the middle slice toward the back.
    // It goes as far as the grid does while pushed, and clicks into its slice once let go.
    expect(run(room, 'R10 _8 E1 _3 R36 _6 U40').crates[0]?.z).toBeGreaterThan(2.5);
    expect(run(room, 'R10 _8 E1 _3 R36 _6 U40 D12', 40).crates[0]?.z).toBeCloseTo(2.5, 5);
  });
});

describe('levers and slabs', () => {
  it('a lever is flipped by feet coming down on it, not by flying over', () => {
    const level = levelFrom(`
name: levers
z=0
...........#...
...........E...
@..e...e...E..X
###############
`);
    expect(run(level, 'R220').toggled).toEqual([]);
    expect(run(level, 'R68 RJ22 R20').toggled).toEqual(['e']);
  });

  const bridge = levelFrom(`
name: bridge
z=0
............
@..*====*..X
###~~~~~####
`);

  it('a slab falls once whoever stood on it has walked away', () => {
    expect(run(bridge, 'R80').broken.length).toBeGreaterThanOrEqual(3);
  });

  it('a rider weighs nothing: leaving a slab by the wire does not break it', () => {
    expect(run(bridge, 'R32 _6 E1 R60').broken).toEqual([]);
  });
});
