import { describe, expect, it } from 'vitest';
import type { Level } from '../core/types';
import { outcomeOfFlow, playerOfFlow } from '../flow/physics';
import { parseTape, runTape } from '../flow/tape';
import { CAMPAIGNS, type CampaignId, LEVEL_SOURCES, campaignById, chapterLabel, loadLevels } from './index';

const levels = loadLevels();
const entries = levels.map((level, i) => ({ id: LEVEL_SOURCES[i]?.id ?? '', campaign: LEVEL_SOURCES[i]?.campaign ?? 'main', level }));
const levelsOf = (campaign: CampaignId): Level[] => entries.filter((e) => e.campaign === campaign).map((e) => e.level);
/** Eight levels per chapter, chapter after chapter. */
const eightEach = (campaign: CampaignId): number[] => campaignById(campaign).chapters.flatMap((chapter) => Array.from({ length: 8 }, () => chapter.world));
const named = (slug: string): Level => {
  const found = entries.find((e) => e.id.endsWith(slug));
  if (!found) throw new Error(`No level "${slug}"`);
  return found.level;
};
const loopsOf = (tape: string) => {
  const parsed = parseTape(tape);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};
const run = (level: Level, tape: string, settle = 0) => runTape(level, loopsOf(tape), settle).world;

describe('the campaigns', () => {
  it('main is eight worlds of eight levels, in the order of the files', () => {
    expect(campaignById('main').chapters).toHaveLength(8);
    expect(levelsOf('main').map((level) => level.world)).toEqual(eightEach('main'));
  });

  it('hardcore is four chapters of eight levels, played after the main campaign and opened by it', () => {
    const hardcore = campaignById('hardcore');
    expect(hardcore.chapters).toHaveLength(4);
    expect(hardcore.requires).toBe('main');
    expect(levelsOf('hardcore').map((level) => level.world)).toEqual(eightEach('hardcore'));
    // Play order is one list: every main level comes before the first hardcore one.
    expect(entries.map((e) => e.campaign)).toEqual([...levelsOf('main').map(() => 'main'), ...levelsOf('hardcore').map(() => 'hardcore')]);
  });

  it('numbers its chapters once across campaigns, and counts them from one in each', () => {
    const worlds = CAMPAIGNS.flatMap((campaign) => campaign.chapters.map((chapter) => chapter.world));
    expect(new Set(worlds).size).toBe(worlds.length);
    expect(chapterLabel(3)).toBe('3');
    expect(chapterLabel(9)).toBe('H1');
    expect(chapterLabel(12)).toBe('H4');
  });

  it('saves progress under ids that tell the campaigns apart', () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    for (const e of entries) expect(e.id.startsWith('hardcore/')).toBe(e.campaign === 'hardcore');
  });

  it('gives every level a name of its own, an opening line and a hint', () => {
    expect(new Set(levels.map((level) => level.name)).size).toBe(levels.length);
    for (const { id, level } of entries) {
      expect(level.tip, `${id}: tip`).not.toBeNull();
      expect(level.hint, `${id}: hint`).not.toBeNull();
    }
  });

  it('keeps the first two worlds without clones, and reflections for the seventh', () => {
    const main = levelsOf('main');
    for (const level of main.filter((l) => l.world <= 2)) expect(level.maxClones).toBe(0);
    for (const level of main.filter((l) => l.mirror)) expect([7, 8]).toContain(level.world);
    expect(main.filter((l) => l.world === 7).every((l) => l.mirror)).toBe(true);
  });

  it('hardcore: le vertige is walked alone, le contre-jour is all reflections, la ruine all slabs', () => {
    const hardcore = levelsOf('hardcore');
    for (const level of hardcore.filter((l) => l.world === 9)) expect(level.maxClones, level.name).toBe(0);
    for (const level of hardcore.filter((l) => l.world === 11)) expect(level.mirror, level.name).toBe(true);
    for (const level of hardcore.filter((l) => l.world === 12)) expect(level.cells.some((cell) => cell.fragile), level.name).toBe(true);
  });
});

describe('every level', () => {
  it.each(entries.map((e) => [e.id, e.level] as const))('%s is finished by its own run', (_id, level) => {
    expect(level.tape).not.toBeNull();
    const loops = loopsOf(level.tape ?? '');
    // A run never uses more clones than the level lets the player keep.
    expect(loops.length - 1).toBeLessThanOrEqual(level.maxClones);
    expect(outcomeOfFlow(runTape(level, loops).world)).toBe('won');
  });

  const withClones = entries.filter((e) => e.level.maxClones > 0);
  it.each(withClones.map((e) => [e.id, e.level] as const))('%s: the last loop of its run goes nowhere alone', (_id, level) => {
    const last = loopsOf(level.tape ?? '').at(-1) ?? [];
    expect(outcomeOfFlow(runTape(level, [last], 120).world)).not.toBe('won');
  });
});

describe('what the levels are about', () => {
  it("l'élan: running without jumping ends in the first gap", () => {
    expect(outcomeOfFlow(run(named('l-elan'), 'R200'))).toBe('fallen');
  });

  it('le fil: the void is only crossed on the wire', () => {
    expect(outcomeOfFlow(run(named('03-le-fil'), 'R200'))).toBe('fallen');
  });

  it('tiens-moi la porte: alone, the door stays shut', () => {
    const world = run(named('tiens-moi-la-porte'), 'R200');
    expect(outcomeOfFlow(world)).toBe('playing');
    expect(playerOfFlow(world).x).toBeLessThan(9);
  });

  it('la courte échelle: two cells cannot be jumped without a head to stand on', () => {
    const world = run(named('la-courte-echelle'), 'R70 RJ30 RJ1 RJ30 R40', 30);
    expect(playerOfFlow(world).y).toBeLessThan(2);
  });

  it('sous ton ombre: a runner who stops finds the door shut again', () => {
    const late = run(named('sous-ton-ombre'), 'RJ16 R260 | R40 _120 R200');
    expect(outcomeOfFlow(late)).toBe('playing');
    expect(playerOfFlow(late).x).toBeLessThan(7);
  });

  it('le contretemps: a clone that never pauses is gone before the runner reaches the second door', () => {
    const level = named('le-contretemps');
    const naive = run(level, 'RJ16 R330 | R420');
    expect(outcomeOfFlow(naive)).toBe('playing');
    expect(playerOfFlow(naive).x).toBeLessThan(17);
    // Any reasonable pause between the two pairs of plates is enough.
    for (const pause of [25, 45, 70]) expect(outcomeOfFlow(run(level, `RJ16 R150 _${pause} R200 | R420`))).toBe('won');
  });

  it('le mime: the keys lost against a shut door carry the clone through once it is held open', () => {
    const level = named('33-le-mime');
    // Alone, the long press ends against the door.
    expect(playerOfFlow(run(level, 'R150')).x).toBeLessThan(8);
    // Replayed while the plate is held, the same press ends on the far plates.
    const replayed = run(level, 'R150 | R22 _140');
    expect(replayed.bodies[0]?.x).toBeGreaterThan(11);
  });

  it('le portier: flipping the lever back too early shuts the door on the runner', () => {
    const world = run(named('le-portier'), 'RJ16 R36 _5 R9 _6 L9 _10 | R400');
    expect(outcomeOfFlow(world)).toBe('playing');
    expect(playerOfFlow(world).x).toBeLessThan(10);
  });

  it('le portier: a lever never flipped back leaves the grille shut', () => {
    const world = run(named('le-portier'), 'RJ16 R36 _100 | R400');
    expect(outcomeOfFlow(world)).toBe('playing');
    expect(playerOfFlow(world).x).toBeLessThan(15);
  });

  it('le miroir: the reflection jumps when the recorder jumps, and falls if the recorder does not', () => {
    const level = named('le-miroir');
    expect(run(level, 'R120 | _120').bodies[0]?.status).toBe('fallen');
    const landed = run(level, 'R31 RJ22 R14 _20 | _120').bodies[0];
    expect(landed?.status).toBe('active');
    expect(landed?.x).toBeLessThan(3);
  });

  it('le reflet grimpe: up is not mirrored, and the keys of a slice ride a wire', () => {
    const level = named('le-reflet-grimpe');
    const reflection = run(level, `${(level.tape ?? '').split('|')[0]} | _400`).bodies[0];
    // The recorder only jumped on the spot against its door; the reflection is up on the ledge.
    expect(reflection?.y).toBe(4);
    expect(reflection?.x).toBeLessThan(2);
  });

  it('les dalles: a slab falls once the runner has left it', () => {
    expect(run(named('les-dalles'), 'R58 RJ14 R34').broken.length).toBeGreaterThanOrEqual(3);
  });

  it('le passeur: the slab is gone for whoever comes after the clone has left it', () => {
    const level = named('le-passeur');
    expect(outcomeOfFlow(run(level, 'R43 RJ22 R6 _150 RJ24 R21 _20 | _240 R43 RJ22 R4 _12 RJ24 R260'))).toBe('fallen');
  });

  it("l'ancre fragile: crossing on foot takes the anchor's slab away, and the way back with it", () => {
    const level = named('l-ancre-fragile');
    const onFoot = run(level, 'R110');
    expect(onFoot.broken.length).toBeGreaterThanOrEqual(4);
    expect(outcomeOfFlow(run(level, level.tape ?? ''))).toBe('won');
    expect(run(level, level.tape ?? '').broken.length).toBeLessThan(2);
  });
});
