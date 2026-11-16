import { describe, expect, it } from 'vitest';
import { levelFrom } from '../core/testing';
import type { Level } from '../core/types';
import { FLOW_SOURCES, loadFlowLevels } from './levels';
import { outcomeOfFlow, playerOfFlow } from './physics';
import { parseTape, runTape } from './tape';

const levels = loadFlowLevels();
const entries = levels.map((level, i) => ({ id: FLOW_SOURCES[i]?.id ?? '', level }));
const named = (slug: string): Level => {
  const found = entries.find((e) => e.id.endsWith(slug));
  if (!found) throw new Error(`No flow level "${slug}"`);
  return found.level;
};
const run = (level: Level, tape: string, settle = 0) => {
  const parsed = parseTape(tape);
  if (!parsed.ok) throw new Error(parsed.error);
  return runTape(level, parsed.value, settle).world;
};

const flat = levelFrom(`
name: flat
flow: true
z=0
....................
@..................X
####################
`);

describe('movement', () => {
  it('a held jump peaks a little over one cell, never two', () => {
    let top = 0;
    for (let frames = 1; frames < 40; frames++) top = Math.max(top, playerOfFlow(run(flat, `J${frames}`)).y);
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
    const a = playerOfFlow(run(flat, 'R60')).x;
    const b = playerOfFlow(run(flat, 'R90')).x;
    expect((b - a) * 2).toBeGreaterThan(4.5);
    expect((b - a) * 2).toBeLessThan(6);
  });

  it('is deterministic: the same tape ends in the same place', () => {
    const level = named('01-l-elan');
    expect(run(level, level.tape ?? '')).toEqual(run(level, level.tape ?? ''));
  });
});

describe('every flow level', () => {
  it.each(entries.map((e) => [e.id, e.level] as const))('%s is finished by its tape', (_id, level) => {
    expect(level.flow).toBe(true);
    expect(level.tape).not.toBeNull();
    expect(outcomeOfFlow(run(level, level.tape ?? ''))).toBe('won');
  });
});

describe('what the flow levels are about', () => {
  it("l'élan: running without jumping ends in the first gap", () => {
    expect(outcomeOfFlow(run(named('01-l-elan'), 'R200'))).toBe('fallen');
  });

  it('les dalles: a slab falls once the runner has left it', () => {
    const world = run(named('02-les-dalles'), 'R58 RJ14 R34');
    expect(world.broken.length).toBeGreaterThanOrEqual(3);
  });

  it('tiens-moi la porte: alone, the door stays shut', () => {
    const world = run(named('03-tiens-moi-la-porte'), 'R200');
    expect(outcomeOfFlow(world)).toBe('playing');
    expect(playerOfFlow(world).x).toBeLessThan(9);
  });

  it('la courte échelle: two cells cannot be jumped without a head to stand on', () => {
    const world = run(named('04-la-courte-echelle'), 'R70 RJ30 RJ1 RJ30 R40', 30);
    expect(playerOfFlow(world).y).toBeLessThan(2);
  });

  it('sous ton ombre: a runner who stops finds the door shut again', () => {
    const level = named('05-sous-ton-ombre');
    const late = run(level, 'RJ16 R260 | R40 _120 R200');
    expect(outcomeOfFlow(late)).toBe('playing');
    expect(playerOfFlow(late).x).toBeLessThan(7);
  });

  it('pair, impair: walking over both levers shuts the door again', () => {
    const world = run(named('06-pair-impair'), 'R220');
    expect(world.toggled).toEqual([]);
    expect(outcomeOfFlow(world)).toBe('playing');
  });

  it('pair, impair: a lever is only flipped with the feet down', () => {
    expect(run(named('06-pair-impair'), 'R68 RJ22 R20').toggled).toEqual(['e']);
  });

  it('le passeur: the slab is gone for whoever comes after the clone has left it', () => {
    const level = named('07-le-passeur');
    expect(outcomeOfFlow(run(level, 'R43 RJ22 R6 _150 RJ24 R21 _20 | _240 R43 RJ22 R4 _12 RJ24 R260'))).toBe('fallen');
  });

  it('le passeur: alone, the door stays shut', () => {
    const world = run(named('07-le-passeur'), 'R43 RJ22 R4 _12 RJ24 R260');
    expect(outcomeOfFlow(world)).toBe('playing');
  });

  it('le volume: in 2D the wall cannot be passed', () => {
    const world = run(named('08-le-volume'), 'R60 RJ30 R60', 20);
    expect(playerOfFlow(world).x).toBeLessThan(5);
  });

  it('le contretemps: a clone that never pauses is gone before the runner reaches the second door', () => {
    const level = named('10-le-contretemps');
    const naive = run(level, 'RJ16 R330 | R420');
    expect(outcomeOfFlow(naive)).toBe('playing');
    expect(playerOfFlow(naive).x).toBeLessThan(17);
    // Any reasonable pause between the two pairs of plates is enough.
    for (const pause of [25, 45, 70]) expect(outcomeOfFlow(run(level, `RJ16 R150 _${pause} R200 | R420`))).toBe('won');
  });

  it('le miroir: the reflection jumps when the recorder jumps, and falls if the recorder does not', () => {
    const level = named('11-le-miroir');
    const { bodies } = run(level, 'R120 | _120');
    expect(bodies[0]?.status).toBe('fallen');
    const landed = run(level, 'R31 RJ22 R14 _20 | _120').bodies[0];
    expect(landed?.status).toBe('active');
    expect(landed?.x).toBeLessThan(3);
  });

  it('le miroir: a reflection that keeps running leaves the plate and falls off the far side', () => {
    const world = run(named('11-le-miroir'), 'R31 RJ22 R80 | R200');
    expect(outcomeOfFlow(world)).toBe('playing');
  });

  it('le portier: flipping the lever back too early shuts the door on the runner', () => {
    const world = run(named('12-le-portier'), 'RJ16 R36 _5 R9 _6 L9 _10 | R400');
    expect(outcomeOfFlow(world)).toBe('playing');
    expect(playerOfFlow(world).x).toBeLessThan(10);
  });

  it('le portier: a lever never flipped back leaves the grille shut', () => {
    const world = run(named('12-le-portier'), 'RJ16 R36 _100 | R400');
    expect(outcomeOfFlow(world)).toBe('playing');
    expect(playerOfFlow(world).x).toBeLessThan(15);
  });

  it('in 3D a diagonal is not faster than a straight line', () => {
    const level = named('08-le-volume');
    const straight = playerOfFlow(run(level, 'R10 _8 E1 _3 U13')).z;
    const diagonal = playerOfFlow(run(level, 'R10 _8 E1 _3 UR13')).z;
    expect(diagonal).toBeLessThan(straight);
  });

  it('le détour: without anyone on the plate behind, the door stays shut', () => {
    const world = run(named('09-le-detour'), 'R26 RJ22 R160');
    expect(outcomeOfFlow(world)).toBe('playing');
    expect(playerOfFlow(world).x).toBeLessThan(9);
  });
});
