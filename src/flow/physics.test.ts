import { describe, expect, it } from 'vitest';
import { levelFrom } from '../core/testing';
import type { Level } from '../core/types';
import { type FlowWorld, HEIGHT, ICE_ACCEL, fallOf, liveChannels, outcomeOfFlow, playerOfFlow } from './physics';
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

describe('ice', () => {
  const lake = levelFrom(`
name: lake
z=0
..............................
@............................X
iiiiiiiiiiiiiiiiiiiiiiiiiiiiii
`);
  const pond = levelFrom(`
name: pond
z=0
....................
@..................X
####iiiiiiii########
`);

  it('is slow to start on', () => {
    const half = hero(lake, 'R30');
    expect(half.slick).toBe(true);
    expect(half.vx).toBeCloseTo(ICE_ACCEL / 2, 6);
    // Half a second of running covers two cells and a half on stone, not one on ice.
    expect(half.x - 0.5).toBeLessThan(0.7);
    expect(hero(flat, 'R30').x - 0.5).toBeGreaterThan(2.3);
    // Full speed is the same as anywhere, a second later.
    expect(hero(lake, 'R62').vx).toBeLessThan(5.2);
    expect(hero(lake, 'R63').vx).toBe(5.2);
  });

  it('is long to stop on', () => {
    expect(hero(lake, 'R70 _30').vx).toBeGreaterThan(2.5);
    const slid = hero(lake, 'R70 _70').x - hero(lake, 'R70').x;
    expect(hero(lake, 'R70 _70').vx).toBe(0);
    expect(slid).toBeGreaterThan(2.5);
    expect(slid).toBeLessThan(2.8);
    // Holding the other way does not stop any sooner.
    expect(hero(lake, 'R70 L30').vx).toBeGreaterThan(2.5);
  });

  it('a jump does not give control back, and is as high as any other', () => {
    const flying = hero(lake, 'R70 LJ24');
    expect(flying.grounded).toBe(false);
    expect(flying.slick).toBe(true);
    // On stone, steering back in the air for that long would have turned the body round.
    expect(flying.vx).toBeGreaterThan(3);
    expect(hero(flat, 'R70 LJ24').vx).toBeLessThan(0);
    for (const frames of [6, 14, 24]) expect(hero(lake, `J${frames}`).y).toBe(hero(flat, `J${frames}`).y);
  });

  it('the grip is lost on the ice and comes back on stone', () => {
    expect(hero(pond, 'R30').slick).toBe(false);
    const sliding = hero(pond, 'R60 _30');
    expect(sliding.slick).toBe(true);
    expect(sliding.vx).toBeGreaterThan(2.5);
    // Jumped off the ice, the grip is still gone in the air; landed on stone, it is back.
    expect(hero(pond, 'R100 RJ20')).toMatchObject({ grounded: false, slick: true });
    const landed = hero(pond, 'R150');
    expect(landed.x).toBeGreaterThan(12.3);
    expect(landed.slick).toBe(false);
    expect(hero(pond, 'R150 _6').vx).toBe(0);
  });

  it('a crate gives the grip back too', () => {
    const level = levelFrom(`
name: perch
z=0
..........
@..o.....X
iiiiiiiiii
`);
    const perched = hero(level, 'R40 RJ22 _30');
    expect(perched.y).toBeCloseTo(1.9, 5);
    expect(perched).toMatchObject({ grounded: true, slick: false });
  });

  it('a crate pushed on ice keeps the pace of the push, up to the next obstacle', () => {
    const level = levelFrom(`
name: curling
z=0
....................
@.o........#.......X
iiiiiiiiiiiiiiiiiiii
`);
    // The hero has let go and is coming to a stop; the crate is not.
    const gliding = run(level, 'R60 _40');
    expect(gliding.crates[0]?.vx).toBe(2.6);
    expect(playerOfFlow(gliding).vx).toBe(0);
    expect((gliding.crates[0]?.x ?? 0) - playerOfFlow(gliding).x).toBeGreaterThan(1.5);
    // It stops against the wall, within one step of touching it.
    const stopped = run(level, 'R60 _200').crates[0];
    expect(stopped?.vx).toBe(0);
    expect(stopped?.x).toBeGreaterThan(10.5);
    expect(stopped?.x).toBeLessThan(10.55);
  });

  it('a short push is a slow slide', () => {
    const level = levelFrom(`
name: nudge
z=0
....................
@o.................X
iiiiiiiiiiiiiiiiiiii
`);
    const nudged = run(level, 'R20 _60').crates[0];
    expect(nudged?.vx).toBeGreaterThan(0.5);
    expect(nudged?.vx).toBeLessThan(2);
    expect(nudged?.vx).toBe(run(level, 'R20 _90').crates[0]?.vx);
  });

  it('a sliding crate stops on stone', () => {
    const shore = `
name: shore
z=0
....................
@.o................X
iiiiiiiiiiii########
`;
    const crate = run(levelFrom(shore), 'R60 _240').crates[0];
    expect(crate?.vx).toBe(0);
    // Its centre has just come over the stone: that is the column it now stands in.
    expect(crate?.x).toBeGreaterThanOrEqual(12);
    expect(crate?.x).toBeLessThan(12.05);
    // A crate pushed on stone never slides: it stays against whoever pushed it.
    const dry = run(levelFrom(shore.replace('iiiiiiiiiiii', '############')), 'R60 _60');
    expect(dry.crates[0]?.vx).toBe(0);
    expect((dry.crates[0]?.x ?? 0) - playerOfFlow(dry).x).toBeCloseTo(0.75, 2);
  });

  it('a sliding crate falls straight off the end of the ice', () => {
    const level = levelFrom(`
name: brink
z=0
....................
@.o................X
iiiiiiii....########
####################
`);
    const crate = run(level, 'R60 _240').crates[0];
    // It left the ground with its edge just past the brink, and came down against the wall of ice.
    expect(crate?.x).toBeGreaterThanOrEqual(8.45);
    expect(crate?.x).toBeLessThan(8.5);
    expect(crate).toMatchObject({ y: 1, vx: 0, grounded: true });
  });

  it('a sliding crate pushes nothing: the next crate stops it', () => {
    const level = levelFrom(`
name: pair
z=0
....................
@.o....o...........X
iiiiiiiiiiiiiiiiiiii
`);
    const [first, second] = run(level, 'R60 _200').crates;
    expect(second).toMatchObject({ x: 7.5, vx: 0 });
    expect(first?.vx).toBe(0);
    expect(first?.x).toBeGreaterThan(6.55);
    expect(first?.x).toBeLessThanOrEqual(6.6);
  });

  it('in the volume a crate slides in depth too, and stops in a slice', () => {
    const rink = `
name: rink
z=0
........
@^.....X
########
z=1
........
....o...
iiiiiiii
z=2
........
........
iiiiiiii
z=3
........
........
iiiiiiii
`;
    // A short push toward the back from the stone of the front slice, then hands off.
    const tape = 'R10 _8 E1 _3 R36 _6 U14';
    const sliding = run(levelFrom(rink), `${tape} _20`).crates[0];
    expect(sliding?.vz).toBe(2.6);
    expect(sliding?.z).toBeGreaterThan(2.2);
    // The back of the grid stops it; it then settles into the last slice like any crate.
    expect(run(levelFrom(rink), `${tape} _120`).crates[0]).toMatchObject({ z: 3.5, vz: 0 });
    // On stone the same push leaves it where the hand left it, short of the next slice.
    expect(run(levelFrom(rink.replaceAll('iiiiiiii', '########')), `${tape} _120`).crates[0]?.z).toBeLessThan(2);
  });

  it('a clone in the way stops a sliding crate, and is not moved by it', () => {
    const level = levelFrom(`
name: goalkeeper
clones: 1
z=0
....................
..@.o..............X
iiiiiiiiiiiiiiiiiiii
`);
    // The clone goes over the crate and slides to a stop further on; the hero then sends the crate at it.
    const world = run(level, 'R30 RJ24 R30 _200 | _160 R50 _200');
    const keeper = world.bodies[0];
    const crate = world.crates[0];
    expect(crate?.vx).toBe(0);
    expect(crate?.x).toBeGreaterThan(6);
    // One step short of touching, at most.
    expect((keeper?.x ?? 0) - (crate?.x ?? 0)).toBeGreaterThan(0.75);
    expect((keeper?.x ?? 0) - (crate?.x ?? 0)).toBeLessThan(0.8);
    expect(keeper?.x).toBe(run(level, 'R30 RJ24 R30 _200 | _410').bodies[0]?.x);
  });
});

describe('antipodes', () => {
  const hall = levelFrom(`
name: hall
antipode: true
clones: 1
z=0
######.....#####
.....a..........
................
@..............X
################
`);

  it('a clone falls upward and stands under the ceiling; the player does not', () => {
    const world = run(hall, '_40 | _40');
    const [clone, player] = world.bodies;
    expect(clone && fallOf(hall, clone)).toBe(1);
    expect(player && fallOf(hall, player)).toBe(-1);
    expect(clone).toMatchObject({ y: 4 - HEIGHT, grounded: true, vy: 0 });
    expect(player).toMatchObject({ y: 1, grounded: true });
  });

  it('it leaves the start cell falling, not standing: a jump pressed there does nothing', () => {
    const clone = run(hall, 'J8 | _8').bodies[0];
    expect(clone?.grounded).toBe(false);
    expect(clone?.vy).toBeGreaterThan(0);
    expect(clone?.y).toBeGreaterThan(1);
  });

  it('it weighs on a plate under its ceiling, where the player on the floor does not', () => {
    const world = run(hall, 'R58 _30 | R58 _30');
    expect(world.bodies[0]?.grounded).toBe(true);
    expect(Math.floor(world.bodies[0]?.x ?? 0)).toBe(5);
    expect(liveChannels(world).has('a')).toBe(true);
    expect(liveChannels(run(hall, 'R58 _30')).has('a')).toBe(false);
  });

  it('it jumps downward, as far as anyone jumps up, and comes back to its ceiling', () => {
    let lowest = Infinity;
    let highest = 0;
    for (let frames = 1; frames < 40; frames++) {
      const world = run(hall, `_30 J${frames} | _30 J${frames}`);
      lowest = Math.min(lowest, world.bodies[0]?.y ?? 0);
      highest = Math.max(highest, playerOfFlow(world).y);
    }
    expect(4 - HEIGHT - lowest).toBeCloseTo(highest - 1, 6);
    expect(4 - HEIGHT - lowest).toBeGreaterThan(1.05);
    expect(run(hall, '_30 J20 _40 | _90').bodies[0]).toMatchObject({ y: 4 - HEIGHT, grounded: true });
  });

  it('what is over its head is its ground: a lever is flipped there, ice has no grip, a slab falls once it has left', () => {
    const frieze = (ceiling: string) =>
      levelFrom(`
name: frieze
antipode: true
clones: 1
z=0
${ceiling}
....e.......
@..........X
############
`);
    // The lever hangs under the ceiling: the clone runs through it, the player runs under it.
    expect(run(frieze('############'), 'R100 | _100').toggled).toEqual(['e']);
    expect(run(frieze('############'), 'R100').toggled).toEqual([]);

    const icy = frieze('###iiiiii###');
    const sliding = run(icy, 'R50 _20 | _70').bodies[0];
    expect(sliding).toMatchObject({ grounded: true, slick: true });
    expect(sliding?.vx).toBeGreaterThan(3);
    expect(run(icy, 'R50 _20 | _70').bodies[1]?.slick).toBe(false);

    const brittle = frieze('###~~~~#####');
    // Standing under the first slab holds it; running on brings down the ones left behind.
    expect(run(brittle, 'R40 _60 | _100').broken).toEqual([]);
    expect(run(brittle, 'R100 | _100').broken.length).toBeGreaterThanOrEqual(3);
    expect(run(brittle, 'R100').broken).toEqual([]);
  });

  it('the player is untouched: the same keys are the same run as without antipodes', () => {
    const twice = playerOfFlow(run(hall, 'R40 RJ20 L30 J8 R12 | R40 RJ20 L30 J8 R12'));
    const alone = hero(hall, 'R40 RJ20 L30 J8 R12');
    expect({ x: twice.x, y: twice.y, vx: twice.vx, vy: twice.vy }).toEqual({ x: alone.x, y: alone.y, vx: alone.vx, vy: alone.vy });
  });

  it('past the end of its ceiling it leaves by the top, and is lost', () => {
    const world = run(hall, 'R120 | _140');
    expect(world.bodies[0]?.status).toBe('fallen');
    expect(world.bodies[0]?.y).toBeGreaterThan(hall.size.h + 3);
    expect(outcomeOfFlow(world)).toBe('playing');
  });

  const soles = `
name: soles
antipode: true
clones: 1
z=0
#####.....#####
..............X
@..............
#####.....#####
###############
`;
  // Both jump at once: they cross in the air, fall back toward each other and meet halfway.
  const meet = '_30 J20 _40';

  it('sole to sole in mid-air, a player and an antipode hold each other up', () => {
    const level = levelFrom(soles);
    const world = run(level, `${meet} | ${meet} _300`);
    const [clone, player] = world.bodies;
    expect(clone?.grounded).toBe(true);
    expect(player?.grounded).toBe(true);
    expect((player?.y ?? 0) - (clone?.y ?? 0)).toBeCloseTo(HEIGHT, 9);
    // Neither touches anything else: the floor is a cell under the player, the ceiling a cell over the clone.
    expect(player?.y).toBeGreaterThan(2.9);
    expect(player?.y).toBeLessThan(3.1);
    // Five seconds later nothing has moved.
    expect(player?.y).toBe(playerOfFlow(run(level, `${meet} | ${meet} _10`)).y);
  });

  it('holding the same keys they run together across a void', () => {
    const level = levelFrom(soles);
    const over = run(level, `${meet} R80 | ${meet} R80`);
    const [clone, player] = over.bodies;
    // Over the pit, with neither floor nor ceiling in reach.
    expect(player?.x).toBeGreaterThan(6);
    expect(player?.x).toBeLessThan(9);
    expect(player?.x).toBe(clone?.x);
    expect(player?.grounded && clone?.grounded).toBe(true);
    expect((player?.y ?? 0) - (clone?.y ?? 0)).toBeCloseTo(HEIGHT, 9);
    expect(outcomeOfFlow(run(level, `${meet} R200 | ${meet} R200`))).toBe('won');
    // The same keys without antipodes: two bodies in the pit.
    const plain = run(levelFrom(soles.replace('antipode: true', 'antipode: false')), `${meet} R200 | ${meet} R200`);
    expect(outcomeOfFlow(plain)).toBe('playing');
    expect(playerOfFlow(plain).y).toBe(1);
  });

  it('nobody is carried: when one of the two stops, both are lost to their own fall', () => {
    const level = levelFrom(soles);
    const world = run(level, `${meet} R70 _150 | ${meet} R150`, 60);
    expect(world.bodies[0]?.status).toBe('fallen');
    expect(playerOfFlow(world)).toMatchObject({ y: 1, grounded: true });
  });

  it('a crate still falls down: an antipode rising under it rests there, and holds it up', () => {
    const level = levelFrom(`
name: hat
antipode: true
clones: 1
z=0
o.....
......
......
@....X
######
`);
    const world = run(level, '_90 | _90');
    const clone = world.bodies[0];
    const crate = world.crates[0];
    expect(clone).toMatchObject({ grounded: true, status: 'active' });
    expect(crate?.grounded).toBe(true);
    expect((crate?.y ?? 0) - (clone?.y ?? 0)).toBeCloseTo(HEIGHT, 9);
    expect(crate?.y).toBeGreaterThan(2.5);
    expect(crate?.y).toBe(run(level, '_90 | _60').crates[0]?.y);
  });
});

describe('a grid that wraps', () => {
  const ring = `
name: ring
wrap: x
clones: 1
z=0
..........
.X......@.
##########
`;

  it('x: who runs off the right arrives on the left', () => {
    const level = levelFrom(ring);
    const across = hero(level, 'R24');
    expect(across).toMatchObject({ status: 'active', y: 1, grounded: true });
    expect(across.x).toBeGreaterThanOrEqual(0);
    expect(across.x).toBeLessThan(1);
    expect(outcomeOfFlow(run(level, 'R40'))).toBe('won');
    // Without the wrap the same run goes over the side and is lost.
    expect(outcomeOfFlow(run(levelFrom(ring.replace('wrap: x', '')), 'R40', 60))).toBe('fallen');
  });

  it('x: a wall across the seam stops who comes from the other side', () => {
    const level = levelFrom(`
name: gatepost
wrap: x
z=0
..........
#...X...@.
##########
`);
    const stopped = hero(level, 'R60');
    expect(stopped.x).toBeCloseTo(10 - 0.3, 3);
    expect(stopped.vx).toBe(0);
  });

  it('x: a door across the seam is a door: shut it stops, open it lets through', () => {
    const level = levelFrom(`
name: turnstile
wrap: x
z=0
..........
A.X..ao.@.
##########
`);
    const barred = hero(level, 'R60');
    expect(barred.x).toBeCloseTo(10 - 0.3, 3);
    // The crate pushed onto the plate holds the door, and the way round is open.
    expect(liveChannels(run(level, 'L40 _10')).has('a')).toBe(true);
    expect(outcomeOfFlow(run(level, 'L40 R100'))).toBe('won');
  });

  it('x: a crate is pushed across the seam', () => {
    const level = levelFrom(`
name: carousel
wrap: x
z=0
..........
....X..@.o
##########
`);
    const world = run(level, 'R80');
    const crate = world.crates[0];
    expect(crate?.x).toBeGreaterThan(1.5);
    expect(crate?.x).toBeLessThan(3);
    // Still a hand's breadth ahead of whoever pushes it.
    expect((crate?.x ?? 0) - playerOfFlow(world).x).toBeCloseTo(0.75, 2);
  });

  it('x: two crates in a row do not move, even with the seam between them', () => {
    const level = levelFrom(`
name: bollards
wrap: x
z=0
..........
o...X..@.o
##########
`);
    const world = run(level, 'R120');
    // The first closes the hand's breadth between them, then both stand still.
    expect(world.crates[0]?.x).toBe(0.5);
    expect(world.crates[1]?.x).toBeGreaterThan(9.5);
    expect(world.crates[1]?.x).toBeLessThan(9.7);
    expect(playerOfFlow(world).x).toBeLessThan(9);
  });

  it('x: a head across the seam can be stood on', () => {
    const level = levelFrom(ring);
    // The clone stops astride the seam; the player jumps from the right and lands on it from the left.
    const world = run(level, 'R17 _60 | _20 RJ18 _40');
    const [clone, player] = world.bodies;
    expect(clone?.x).toBeGreaterThan(9.7);
    expect(player?.x).toBeLessThan(0.5);
    expect(player).toMatchObject({ y: 1 + HEIGHT, grounded: true });
  });

  const well = `
name: well
wrap: y
z=0
#...#
#..X#
#.###
#@..#
##.##
`;

  it('y: who falls out of the bottom comes back from the top, and lands', () => {
    const level = levelFrom(well);
    const falling = hero(level, 'R14 _16');
    expect(falling.y).toBeGreaterThan(3);
    expect(falling.vy).toBeLessThan(-8);
    const landed = hero(level, 'R14 _60');
    expect(landed).toMatchObject({ status: 'active', y: 3, grounded: true });
    expect(outcomeOfFlow(run(level, 'R14 _60 R20'))).toBe('won');
  });

  it('y: without the wrap the same fall is a fall', () => {
    expect(outcomeOfFlow(run(levelFrom(well.replace('wrap: y', '')), 'R14 _60'))).toBe('fallen');
  });

  it('y: nobody is ever lost, however long the fall, and it gets no faster', () => {
    const level = levelFrom(`
name: shaft
wrap: y
z=0
#..#
#..#
#@.X
##.#
#..#
`);
    const dropped = hero(level, 'R14 _600');
    expect(dropped.status).toBe('active');
    expect(dropped.vy).toBe(-19);
    expect(dropped.y).toBeGreaterThanOrEqual(0);
    expect(dropped.y).toBeLessThan(5);
  });

  const chute = `
name: chute
wrap: y
z=0
#..##
#@o.X
###.#
#...#
#...#
`;

  it('y: a crate that falls out of the bottom comes down on what is at the top', () => {
    const crate = run(levelFrom(chute), 'R30 _90').crates[0];
    // The block in the top row is under the bottom row: the crate rests on it, across the seam.
    expect(crate?.y).toBeCloseTo(0, 6);
    expect(crate?.grounded).toBe(true);
    expect(run(levelFrom(chute.replace('wrap: y', '')), 'R30 _90').crates).toEqual([]);
  });

  it('y: an antipode that leaves by the top comes back from the bottom', () => {
    const level = levelFrom(`
name: updraught
antipode: true
wrap: y
clones: 1
z=0
.....
.....
@...X
#####
.....
`);
    const rising = run(level, '_14 | _14').bodies[0];
    expect(rising?.grounded).toBe(false);
    expect(rising?.y).toBeGreaterThan(3);
    // It ends under the very floor it started on.
    expect(run(level, '_60 | _60').bodies[0]).toMatchObject({ status: 'active', y: 1 - HEIGHT, grounded: true });
  });
});
