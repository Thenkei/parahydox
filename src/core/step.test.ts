import { describe, expect, it } from 'vitest';
import { vec } from './grid';
import { cloneOf, levelFrom, play } from './testing';
import { isDoorClosed, outcomeOf, playerOf } from './world';

describe('2D: left, right, and gravity', () => {
  const stairs = levelFrom(`
name: stairs
z=0
@...
#..X
####
`);

  it('falls until something holds the actor', () => {
    const { world } = play(stairs, 'R');
    expect(playerOf(world).pos).toEqual(vec(1, 1, 0));
  });

  it('loses the step when the move has no meaning in the plane', () => {
    const { world } = play(stairs, 'DD');
    expect(playerOf(world).pos).toEqual(stairs.start);
    expect(world.tick).toBe(2);
  });

  it('finds only void past the edge of the grid', () => {
    expect(outcomeOf(play(stairs, 'L').world)).toBe('fallen');
  });

  it('climbs an obstacle one cell high, and is stopped by a taller one', () => {
    const steps = levelFrom(`
name: steps
z=0
....#.
...##.
@.###X
######
`);
    expect(playerOf(play(steps, 'RR').world).pos).toEqual(vec(2, 2, 0));
    expect(playerOf(play(steps, 'RRR').world).pos).toEqual(vec(3, 3, 0));
    const low = levelFrom(`
name: low
z=0
..##.
@.##X
#####
`);
    expect(playerOf(play(low, 'RR').world).pos).toEqual(vec(1, 1, 0));
  });

  it('ends the loop when the actor falls into the void', () => {
    const pit = levelFrom(`
name: pit
z=0
@..X
#..#
`);
    const fallen = play(pit, 'R');
    expect(outcomeOf(fallen.world)).toBe('fallen');
    expect(play(pit, 'R', fallen)).toBe(fallen);
  });

  it('wins when the player reaches the exit, even by falling onto it', () => {
    const drop = levelFrom(`
name: drop
z=0
@.
#X
##
`);
    expect(outcomeOf(play(drop, 'R').world)).toBe('won');
    expect(outcomeOf(play(stairs, 'RRR').world)).toBe('won');
  });
});

describe('1D: a point on a wire', () => {
  const wire = levelFrom(`
name: wire
z=0
@*===*X
##...##
`);

  it('ignores gravity and the void', () => {
    const { world } = play(wire, 'RERR');
    expect(playerOf(world)).toMatchObject({ dim: 1, pos: vec(3, 1, 0), status: 'active' });
  });

  it('only leaves the wire through an anchor', () => {
    const midWire = play(wire, 'RERRE');
    expect(playerOf(midWire.world).dim).toBe(1);

    const farAnchor = play(wire, 'RERRRRE');
    expect(playerOf(farAnchor.world)).toMatchObject({ dim: 2, pos: vec(5, 1, 0) });
  });

  it('is steered by the direction the wire takes', () => {
    const lift = levelFrom(`
name: lift
z=0
.==*X
.=.##
@*.##
#####
`);
    // Right does nothing at the foot of a vertical wire; up follows it, then right.
    const { world } = play(lift, 'RERUURR');
    expect(playerOf(world)).toMatchObject({ dim: 1, pos: vec(3, 3, 0) });
    expect(world.tick).toBe(7);
  });

  it('cannot enter the wire away from an anchor', () => {
    const { world } = play(wire, 'E');
    expect(playerOf(world).dim).toBe(2);
  });

  it('is blocked by a crate, which cannot be pushed along the wire', () => {
    const corked = levelFrom(`
name: corked
glyph: % = anchor + crate
z=0
@*===%X
##...##
`);
    const { world } = play(corked, 'RERRRRRR');
    expect(playerOf(world).pos).toEqual(vec(4, 1, 0));
    expect(world.crates[0]?.pos).toEqual(vec(5, 1, 0));
  });

  it('cannot pass a clone on the same wire', () => {
    const shared = levelFrom(`
name: shared
clones: 1
z=0
@*===*X
##...##
`);
    // Loop 1 stops mid-wire. Loop 2 lets the clone go first, then runs into it.
    const state = play(shared, 'RERR|..RERRRR');
    expect(cloneOf(state).pos).toEqual(vec(3, 1, 0));
    expect(playerOf(state.world).pos).toEqual(vec(2, 1, 0));
  });
});

describe('3D: four directions on the ground', () => {
  const room = levelFrom(`
name: room
z=0
@^*=*X
######
z=1
......
######
`);

  it('only changes dimension on a threshold', () => {
    expect(playerOf(play(room, 'RE').world).dim).toBe(3);
    expect(playerOf(play(room, 'REE').world).dim).toBe(2);
  });

  it('walks along z, and re-slices the world where it comes back to 2D', () => {
    const { world } = play(room, 'REU');
    expect(playerOf(world).pos).toEqual(vec(1, 1, 1));
  });

  it('has no direct passage to 1D: an anchor does nothing for a 3D actor', () => {
    const { world } = play(room, 'RERE');
    expect(playerOf(world)).toMatchObject({ dim: 3, pos: vec(2, 1, 0) });
  });
});

describe('crates, plates and doors', () => {
  it('pushes a crate, which then obeys gravity', () => {
    const ledge = levelFrom(`
name: ledge
z=0
@o..X
##.##
`);
    const { world } = play(ledge, 'R');
    expect(playerOf(world).pos).toEqual(vec(1, 1, 0));
    expect(world.crates).toHaveLength(0);
  });

  it('cannot push two crates at once, and climbs the stuck one instead', () => {
    const jam = levelFrom(`
name: jam
z=0
.....
@oo.X
#####
`);
    const { world } = play(jam, 'R');
    expect(playerOf(world).pos).toEqual(vec(1, 2, 0));
    expect(world.crates.map((c) => c.pos.x)).toEqual([1, 2]);
  });

  it('opens a door while its plate is held, by a crate as well as by an actor', () => {
    const gate = levelFrom(`
name: gate
z=0
@oa.AX
######
`);
    const closed = play(gate, '');
    expect(isDoorClosed(closed.world, vec(4, 1, 0))).toBe(true);

    const held = play(gate, 'R');
    expect(held.world.crates[0]?.pos).toEqual(vec(2, 1, 0));
    expect(isDoorClosed(held.world, vec(4, 1, 0))).toBe(false);
  });

  it('closes the door again as soon as the plate is released', () => {
    const gate = levelFrom(`
name: gate
z=0
...#.
...A.
@a.AX
#####
`);
    expect(isDoorClosed(play(gate, 'R').world, vec(3, 1, 0))).toBe(false);
    const stuck = play(gate, 'RRRR');
    expect(playerOf(stuck.world).pos).toEqual(vec(2, 1, 0));
    expect(outcomeOf(stuck.world)).toBe('playing');
  });
});

describe('clones', () => {
  const corridor = levelFrom(`
name: corridor
clones: 1
z=0
......
@....X
######
`);

  it('is solid, and serves as a step', () => {
    // The clone walks one cell and stops; the player climbs onto it, then over it.
    const onTop = play(corridor, 'R|.R');
    expect(playerOf(onTop.world).pos).toEqual(vec(1, 2, 0));

    const over = play(corridor, 'R', onTop);
    expect(playerOf(over.world).pos).toEqual(vec(2, 1, 0));
  });

  it('diverges by losing the impossible step, then carries on with its sequence', () => {
    const tunnel = levelFrom(`
name: tunnel
clones: 1
z=0
######
@....X
######
`);
    // Loop 1: wait twice, walk to x=2, step back. Loop 2: the player gets to x=2 first.
    // With no headroom to climb, the clone's second move is lost: it ends at x=0, not x=1.
    const state = play(tunnel, '..RRL|RR...');
    expect(playerOf(state.world).pos).toEqual(vec(2, 1, 0));
    expect(cloneOf(state).pos).toEqual(vec(0, 1, 0));
  });

  it('stays where it is once its inputs run out', () => {
    const state = play(corridor, 'RR|....');
    expect(cloneOf(state).pos).toEqual(vec(2, 1, 0));
  });
});

describe('levers', () => {
  const hall = levelFrom(`
name: hall
z=0
....#..
....E..
@.e.E.X
#######
`);
  const door = vec(4, 1, 0);

  it('switches its door on when stepped on, and the door stays open after leaving', () => {
    expect(isDoorClosed(play(hall, 'R').world, door)).toBe(true);
    expect(isDoorClosed(play(hall, 'RR').world, door)).toBe(false);
    expect(outcomeOf(play(hall, 'RRRRRR').world)).toBe('won');
  });

  it('flips back every time someone arrives on it again', () => {
    expect(isDoorClosed(play(hall, 'RRRL').world, door)).toBe(true);
    expect(isDoorClosed(play(hall, 'RRRLL').world, door)).toBe(true);
    expect(isDoorClosed(play(hall, 'RRRLLRR').world, door)).toBe(false);
  });

  it('is flipped by a clone replaying the loop, then again by the player', () => {
    const clones = levelFrom(`
name: clones
clones: 1
z=0
....#..
....E..
@.e.E.X
#######
`);
    // The clone opens the door on its way; the player following it closes it again.
    const state = play(clones, 'RRR|...RR');
    expect(isDoorClosed(state.world, door)).toBe(true);
  });
});

describe('fragile blocks', () => {
  const bridge = levelFrom(`
name: bridge
z=0
@...X
#~~~#
`);

  it('holds while someone stands on it and crumbles once they have walked off', () => {
    const on = play(bridge, 'R');
    expect(on.world.broken).toHaveLength(0);
    const off = play(bridge, 'RR');
    expect(off.world.broken).toHaveLength(1);
    expect(outcomeOf(play(bridge, 'RRRR').world)).toBe('won');
  });

  it('cannot be crossed twice', () => {
    expect(outcomeOf(play(bridge, 'RRLL').world)).toBe('fallen');
  });

  it('is not broken by a crate, and drops what rests on a neighbour only when that one goes', () => {
    const shelf = levelFrom(`
name: shelf
z=0
@o..X
##~~#
`);
    const { world } = play(shelf, 'R');
    expect(world.crates[0]?.pos).toEqual(vec(2, 1, 0));
    expect(world.broken).toHaveLength(0);
  });
});

describe('mirror clones', () => {
  const hall = levelFrom(`
name: mirror
clones: 1
mirror: true
z=0
......X
...@...
#######
`);

  it('replays left as right', () => {
    const state = play(hall, 'RR|LL');
    expect(cloneOf(state).pos).toEqual(vec(1, 1, 0));
    expect(playerOf(state.world).pos).toEqual(vec(1, 2, 0));
  });
});

describe('jumping', () => {
  const gap = levelFrom(`
name: gap
z=0
.......
@.....X
##.#.##
`);

  it('rises one cell, hangs for two moves, then comes down', () => {
    expect(playerOf(play(gap, 'U').world)).toMatchObject({ pos: vec(0, 2, 0), air: 2 });
    expect(playerOf(play(gap, 'UR').world)).toMatchObject({ pos: vec(1, 2, 0), air: 1 });
    expect(playerOf(play(gap, 'URL').world)).toMatchObject({ pos: vec(0, 1, 0), air: 0 });
  });

  it('clears a gap one cell wide', () => {
    const { world } = play(gap, 'RURR');
    expect(playerOf(world).pos).toEqual(vec(3, 1, 0));
    expect(outcomeOf(world)).toBe('playing');
  });

  it('comes straight down when the key is not a move sideways', () => {
    expect(playerOf(play(gap, 'U.').world)).toMatchObject({ pos: vec(0, 1, 0), air: 0 });
  });

  it('does not clear a two-cell wall, nor two cells of void', () => {
    const wall = levelFrom(`
name: wall
z=0
...#...
...#...
@..#..X
#######
`);
    expect(playerOf(play(wall, 'RRURR').world).pos).toEqual(vec(2, 1, 0));
    const wide = levelFrom(`
name: wide
z=0
.......
@.....X
##..###
`);
    expect(outcomeOf(play(wide, 'RURR').world)).toBe('fallen');
  });

  it('passes over a crate and a lever without touching them', () => {
    const hall = levelFrom(`
name: hall
z=0
..........
@.o..e...X
##########
`);
    const { world } = play(hall, 'RURRRURR');
    expect(playerOf(world).pos).toEqual(vec(6, 1, 0));
    expect(world.crates[0]?.pos).toEqual(vec(2, 1, 0));
    expect(world.toggled).toEqual([]);
  });

  it('needs ground to push off from: no second jump in the air', () => {
    expect(playerOf(play(gap, 'UU').world)).toMatchObject({ pos: vec(0, 1, 0), air: 0 });
  });

  it('ends when a clone runs out of keys in mid-air', () => {
    const two = levelFrom(`
name: two
clones: 1
z=0
.......
@.....X
#######
`);
    const state = play(two, 'U|RR');
    expect(cloneOf(state)).toMatchObject({ pos: vec(0, 1, 0), air: 0 });
  });
});

