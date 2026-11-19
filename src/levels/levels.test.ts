import { describe, expect, it } from 'vitest';
import type { Level } from '../core/types';
import { outcomeOfFlow, playerOfFlow } from '../flow/physics';
import { parseTape, runTape } from '../flow/tape';
import { CAMPAIGNS, type CampaignId, LEVEL_SOURCES, campaignById, chapterLabel, levelIndexOf, levelLabels, loadLevels } from './index';

const levels = loadLevels();
const entries = levels.map((level, i) => ({ id: LEVEL_SOURCES[i]?.id ?? '', campaign: LEVEL_SOURCES[i]?.campaign ?? 'main', level }));
const levelsOf = (campaign: CampaignId): Level[] => entries.filter((e) => e.campaign === campaign).map((e) => e.level);
/** Eight levels per chapter, chapter after chapter. */
const eightEach = (campaign: CampaignId): number[] => campaignById(campaign).chapters.flatMap((chapter) => Array.from({ length: 8 }, () => chapter.world));
/** The campaigns built on one new rule each; the main campaign and hardcore know none of the three. */
const SIDE: readonly CampaignId[] = ['givre', 'tore', 'envers'];
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

  it('hardcore is four chapters of eight levels, opened by the whole main campaign', () => {
    const hardcore = campaignById('hardcore');
    expect(hardcore.chapters).toHaveLength(4);
    expect(hardcore.requires).toEqual({ campaign: 'main', solved: levelsOf('main').length });
    expect(levelsOf('hardcore').map((level) => level.world)).toEqual(eightEach('hardcore'));
  });

  it.each(SIDE)('%s is two chapters of eight levels', (id) => {
    expect(campaignById(id).chapters).toHaveLength(2);
    expect(levelsOf(id).map((level) => level.world)).toEqual(eightEach(id));
  });

  it('plays and lists them in one order: main, the three side campaigns as they open, hardcore last', () => {
    expect(CAMPAIGNS.map((campaign) => campaign.id)).toEqual(['main', 'givre', 'tore', 'envers', 'hardcore']);
    // Play order is one list, a campaign after the other: `?level=<n>` counts along it.
    expect(entries.map((e) => e.campaign)).toEqual(CAMPAIGNS.flatMap((campaign) => levelsOf(campaign.id).map(() => campaign.id)));
  });

  it('opens them along the main campaign, each at a count that can be reached', () => {
    expect(CAMPAIGNS.map((campaign) => campaign.requires)).toEqual([
      null,
      { campaign: 'main', solved: 24 },
      { campaign: 'main', solved: 40 },
      { campaign: 'main', solved: 56 },
      { campaign: 'main', solved: 64 },
    ]);
    for (const { id, requires } of CAMPAIGNS) {
      if (requires === null) continue;
      expect(requires.solved, id).toBeGreaterThan(0);
      // Asking for more levels than there are would shut a campaign for good.
      expect(requires.solved, id).toBeLessThanOrEqual(levelsOf(requires.campaign).length);
    }
  });

  it('numbers its chapters once across campaigns, and counts them from one in each', () => {
    const worlds = CAMPAIGNS.flatMap((campaign) => campaign.chapters.map((chapter) => chapter.world));
    expect(new Set(worlds).size).toBe(worlds.length);
    expect(new Set(CAMPAIGNS.map((campaign) => campaign.tag)).size).toBe(CAMPAIGNS.length);
    expect([1, 3, 8].map(chapterLabel)).toEqual(['1', '3', '8']);
    expect([9, 10, 11, 12].map(chapterLabel)).toEqual(['H1', 'H2', 'H3', 'H4']);
    expect([13, 14].map(chapterLabel)).toEqual(['G1', 'G2']);
    expect([15, 16].map(chapterLabel)).toEqual(['T1', 'T2']);
    expect([17, 18].map(chapterLabel)).toEqual(['E1', 'E2']);
  });

  it('labels a level by its chapter and its place in it, one label each', () => {
    expect(levelLabels([{ world: 1 }, { world: 1 }, { world: 13 }, { world: 14 }, { world: 14 }, { world: 9 }])).toEqual(['1-1', '1-2', 'G1-1', 'G2-1', 'G2-2', 'H1-1']);
    const labels = levelLabels(levels);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.slice(0, 9)).toEqual(['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8', '2-1']);
    expect(labels[entries.findIndex((e) => e.campaign === 'hardcore')]).toBe('H1-1');
    expect(labels.at(-1)).toBe('H4-8');
  });

  it('finds the level a link names, by its place in play order or by its label', () => {
    const labels = ['1-1', '1-2', 'G1-1', 'G1-2', 'H1-1', 'H2-5'];
    // A number counts from one along the play order, and stays inside the list.
    expect(['1', '4', '6', '0', '-3', '99', '', '2.9'].map((asked) => levelIndexOf(asked, labels))).toEqual([0, 3, 5, 0, 0, 5, 0, 1]);
    // A label is what the HUD shows, whatever the case it is typed in.
    expect(['1-2', 'G1-2', 'g1-2', 'H2-5', 'h2-5', ' h1-1 '].map((asked) => levelIndexOf(asked, labels))).toEqual([1, 3, 3, 5, 5, 4]);
    // What names nothing opens nothing: no level is a better guess than another.
    expect(['T1-1', 'G1-3', 'H2', 'givre', '1-'].map((asked) => levelIndexOf(asked, labels))).toEqual([-1, -1, -1, -1, -1]);
    expect(levelIndexOf('1', [])).toBe(-1);
    // In the real list a label survives what a number does not: campaigns placed before it.
    expect(entries[levelIndexOf('h2-5', levelLabels(levels))]?.id).toMatch(/^hardcore\/13-/);
    expect(entries[levelIndexOf('3-2', levelLabels(levels))]?.id).toMatch(/^18-/);
  });

  it('saves progress under ids that tell the campaigns apart: the file name, behind its folder', () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    for (const e of entries) {
      if (e.campaign === 'main') expect(e.id).not.toContain('/');
      else expect(e.id.startsWith(`${e.campaign}/`), e.id).toBe(true);
    }
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

  it('le givre: ice in every level, and la glissade is slid alone', () => {
    const givre = levelsOf('givre');
    for (const level of givre) expect(level.cells.some((cell) => cell.ice === true), level.name).toBe(true);
    for (const level of givre.filter((l) => l.world === 13)) expect(level.maxClones, level.name).toBe(0);
  });

  it('le tore: every level is sewn edge to edge, along one axis at least', () => {
    for (const level of levelsOf('tore')) expect(level.wrap.x || level.wrap.y, level.name).toBe(true);
  });

  it("l'envers: every level has its antipodes, and a clone to send there", () => {
    for (const level of levelsOf('envers')) {
      expect(level.antipode, level.name).toBe(true);
      expect(level.maxClones, level.name).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps ice, sewn edges and antipodes out of every other campaign', () => {
    const elsewhere = entries.filter((e) => !SIDE.includes(e.campaign));
    expect(elsewhere.length).toBeGreaterThan(0);
    for (const { id, level } of elsewhere) {
      expect(level.cells.some((cell) => cell.ice === true), `${id}: ice`).toBe(false);
      expect(level.wrap.x || level.wrap.y, `${id}: wrap`).toBe(false);
      expect(level.antipode, `${id}: antipode`).toBe(false);
    }
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
