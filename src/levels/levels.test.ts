import { describe, expect, it } from 'vitest';
import { vec } from '../core/grid';
import { cheapestWithOneClone, solveSolo, solveWithOneClone, solveWithOneCloneExact } from '../core/solver';
import { totalActions } from '../core/session';
import { play } from '../core/testing';
import type { Level } from '../core/types';
import { isDoorClosed, outcomeOf, playerOf } from '../core/world';
import { LEVEL_SOURCES, WORLD_NAMES, loadLevels } from './index';

const levels = loadLevels();
const entries = levels.map((level, i) => ({ level, id: LEVEL_SOURCES[i]?.id ?? '', n: i + 1 }));
const table = entries.map((e) => [e.n, e.level.name, e.level] as const);

/** Finds a level by the slug of its file name, so tests survive reordering. */
const named = (slug: string): Level => {
  const found = entries.find((e) => e.id.endsWith(`-${slug}`));
  if (!found) throw new Error(`No level "${slug}"`);
  return found.level;
};

describe('the level set', () => {
  it('is eight worlds of eight levels, in order', () => {
    expect(levels).toHaveLength(64);
    expect(WORLD_NAMES).toHaveLength(8);
    expect(levels.map((l) => l.world)).toEqual(Array.from({ length: 64 }, (_, i) => Math.floor(i / 8) + 1));
  });

  it('gives every level a message, a hint and an intended solution', () => {
    for (const { level } of entries) {
      expect(level.tip, level.name).not.toBeNull();
      expect(level.hint, level.name).not.toBeNull();
      expect(level.solution, level.name).not.toBeNull();
    }
  });

  it.each(table)('level %i (%s) is won by its intended solution, in par', (_n, _name, level) => {
    const state = play(level, level.solution ?? '');
    expect(outcomeOf(state.world)).toBe('won');
    expect(level.par).toBe((level.solution ?? '').replace(/[|.]/g, '').length);
  });

  describe('levels without clones have no shortcut', () => {
    it.each(table.filter(([, , l]) => l.maxClones === 0))('level %i (%s)', (_n, _name, level) => {
      expect(solveSolo(level, 80)?.length).toBe(level.par);
    });
  });

  describe('levels with clones cannot be finished alone', () => {
    it.each(table.filter(([, , l]) => l.maxClones > 0))('level %i (%s)', (_n, _name, level) => {
      expect(solveSolo(level, 45)).toBeNull();
    });
  });

  describe('levels built on a lost key press resist a clone that merely runs an errand', () => {
    const mimes = [
      'le-relais',
      'le-coup-de-main',
      'le-mime',
      'renvoyer-l-ascenseur',
      'le-marchepied',
      'le-saut-de-la-foi',
      'le-mime-sur-le-fil',
      'le-mime-croise',
      'l-aide-memoire',
      'la-telecommande',
    ];
    it.each(mimes)('%s', (slug) => {
      expect(solveWithOneClone(named(slug))).toBeNull();
    });
  });

  describe('levels for two clones cannot be done with one clone on a plain errand', () => {
    it.each(['le-trio', 'les-trois-postes', 'chacun-son-tour', 'deux-reflets', 'la-caravane'])('%s', (slug) => {
      expect(named(slug).maxClones).toBe(2);
      expect(solveWithOneClone(named(slug))).toBeNull();
    });
  });
});

describe('what individual levels are about', () => {
  it('le bouchon: the crate corks the upper wire until it is pushed off on foot', () => {
    const level = named('le-bouchon');
    const corked = play(level, 'RERRRRRRRR');
    expect(playerOf(corked.world)).toMatchObject({ dim: 1, pos: vec(8, 4, 0) });
    expect(corked.world.crates).toHaveLength(1);
  });

  it('tenir la porte: standing on the clone is not enough to clear the door', () => {
    const { world } = play(named('tenir-la-porte'), 'RRRRRR|.RRRRRRRRR');
    expect(playerOf(world).pos).toEqual(vec(7, 2, 0));
    expect(outcomeOf(world)).toBe('playing');
  });

  it('le relais: a clone that leaves the first plate too early shuts the player out', () => {
    const { world } = play(named('le-relais'), 'RRRR|RRRRRRRRRRRRR');
    expect(outcomeOf(world)).toBe('playing');
    expect(playerOf(world).pos.x).toBeLessThan(8);
  });

  it('le croisement: the barrier opens on the very step the clone reaches the plate', () => {
    const level = named('le-croisement');
    const barrier = vec(5, 2, 0);
    const waiting = play(level, 'REUURRRR|RRERR..');
    expect(isDoorClosed(waiting.world, barrier)).toBe(true);
    expect(playerOf(play(level, 'R', waiting).world).pos).toEqual(barrier);
  });

  it('le croisement inverse: the door cannot be climbed over from the clone', () => {
    // The clone parks against the door; the lintel stops the player on its head.
    const { world } = play(named('le-croisement-inverse'), 'REUURRRR|R.EUURRRRRRRRR');
    expect(outcomeOf(world)).toBe('playing');
    expect(playerOf(world).pos.x).toBeLessThan(6);
  });

  it('le mime: a clone parked on the first plate does not open the way out', () => {
    const { world } = play(named('le-mime'), 'RR|...RRRRRRRR');
    expect(playerOf(world).pos).toEqual(vec(11, 1, 0));
    expect(outcomeOf(world)).toBe('playing');
  });

  it('le marchepied: the clone only gets up the wall if the player stands at its foot', () => {
    const level = named('le-marchepied');
    expect(play(level, '.RRRRR|LL......').world.actors[0]?.pos).toEqual(vec(6, 1, 0));
    expect(play(level, '.RRRRR|RRR...').world.actors[0]?.pos).toEqual(vec(8, 3, 0));
  });

  it('saute-mouton: without the wait, the player lands on the lever and shuts the door', () => {
    const { world } = play(named('saute-mouton'), 'RRRRRRRRR|RRRRRRRRRRRRRR');
    expect(outcomeOf(world)).toBe('playing');
  });

  it('le grand saut: the loop that sends the reflection to its plate ends in the void', () => {
    const level = named('le-grand-saut');
    expect(outcomeOf(play(level, 'RR').world)).toBe('fallen');
    expect(play(level, 'RR|..').world.actors[0]?.pos).toEqual(vec(3, 1, 0));
  });

  it('le passeur: a clone that does not wait on the slab takes it down behind it', () => {
    const { world } = play(named('le-passeur'), 'RRRRRR|.RRRRRRRRRR');
    expect(outcomeOf(world)).not.toBe('won');
  });
});

describe('the exhaustive one-clone search', () => {
  // Proved by exhaustion, lost keys, waits and hops on a lever included. Earlier versions of
  // the last two could be finished by one clone that never stopped walking: each door opened
  // just in time. The plain-errand search above cannot see that kind of solution.
  // The same proof holds for la-caravane but takes half a minute: it is left to
  // `npm run solve -- --exact src/levels/62-*.txt`.
  it.each(['le-trio', 'chacun-son-tour', 'deux-reflets'])('%s: no tape at all lets a single clone do it', (slug) => {
    expect(solveWithOneCloneExact(named(slug))).toBeNull();
  });

  it('la caravane: three travellers who simply walk lose the bridge under the second one', () => {
    // Found by the third playtest when the slabs still had ground under them.
    const { world } = play(named('la-caravane'), 'RRRRRRR|.RRRRRRRRRR|..RRRRRRRRRRRRRRR');
    expect(outcomeOf(world)).not.toBe('won');
  });

  it('la caravane: the clone that went down to the lower plate cannot come back up to the other', () => {
    // It walks over the upper plate, drops, holds the lower one, then tries to return.
    const { world } = play(named('la-caravane'), 'RRURRRRRRRRLLLL');
    expect(playerOf(world).pos).toEqual(vec(10, 1, 0));
  });

  it('chacun son tour: hopping on the spot flips the lever again', () => {
    const { world } = play(named('chacun-son-tour'), 'RRRU.');
    expect(world.toggled).toEqual([]);
  });

  it('le pont de singes: a single clone is enough if it walks on while the player is in the air', () => {
    const level = named('le-pont-de-singes');
    expect(solveWithOneCloneExact(level)).toMatchObject({ ticks: 12 });
    expect(cheapestWithOneClone(level)).toMatchObject({ actions: level.par });
  });

  it('le pont de singes: two clones standing still do it too, for two stars', () => {
    const { world, session } = play(named('le-pont-de-singes'), 'RRERRR|..RRERR|.......RRURRRURRRRR');
    expect(outcomeOf(world)).toBe('won');
    expect(totalActions(session)).toBeGreaterThan(named('le-pont-de-singes').par ?? 0);
  });

  it('la télécommande: the tape that works begins by going down the pit', () => {
    const found = solveWithOneCloneExact(named('la-telecommande'));
    expect(found).not.toBeNull();
    expect(found).not.toBe('too large');
    if (found !== null && found !== 'too large') expect(found.first.replace(/^\.+/, '').startsWith('L')).toBe(true);
  });

  it('le sacrifice: nothing shorter than sending the clone down and walking over it', () => {
    const found = solveWithOneCloneExact(named('le-sacrifice'));
    expect(found).toMatchObject({ ticks: 10 });
  });
});

describe('three stars stand for the best score there is', () => {
  // Exhaustive search over both loops, waits free. Run on every one-clone level with
  // `npm run solve -- --cheapest`; a few quick ones are pinned here.
  it.each(['tenir-la-porte', 'le-coup-de-main', 'le-mime', 'le-marchepied', 'la-telecommande'])('%s', (slug) => {
    const level = named(slug);
    expect(cheapestWithOneClone(level)).toMatchObject({ actions: level.par });
  });
});

describe('levels reworked after the second playtest', () => {
  it('la bonne coupe: the middle slice has a gap of two, and jumping it ends in the void', () => {
    expect(outcomeOf(play(named('la-bonne-coupe'), 'RERUERURR').world)).toBe('fallen');
  });

  it('le sacrifice: whoever goes down to the plate stays there', () => {
    const { world } = play(named('le-sacrifice'), 'RRRRRRLLL');
    expect(outcomeOf(world)).toBe('playing');
    expect(playerOf(world).pos).toEqual(vec(4, 1, 0));
  });

  it('le pont de singes: one head carries a jump, but the next one ends in the void', () => {
    expect(outcomeOf(play(named('le-pont-de-singes'), 'RRERR|......RRURRURR').world)).toBe('fallen');
  });

  it('le pont de singes: a second clone that does not wait climbs on the first and loses its keys', () => {
    const { world } = play(named('le-pont-de-singes'), 'RRERRR|RRERR|.......');
    expect(world.actors[1]?.dim).toBe(2);
  });

  it('chacun son tour: jumping off the ledge leaves the lever alone', () => {
    const { world } = play(named('chacun-son-tour'), 'RRURR');
    expect(world.toggled).toEqual([]);
    expect(playerOf(world).pos).toEqual(vec(4, 1, 0));
  });

  it('chacun son tour: two flips are one short for the last door', () => {
    const { world } = play(named('chacun-son-tour'), '.....RRRRR|RRRRRRRRRRRRRRRRR');
    expect(outcomeOf(world)).toBe('playing');
    expect(playerOf(world).pos.x).toBe(14);
  });

  it('la télécommande: from the pit, every key is lost on the recorder and heard by the reflection', () => {
    const level = named('la-telecommande');
    expect(playerOf(play(level, 'LRURRRR').world).pos).toEqual(vec(4, 1, 0));
    expect(play(level, 'LRURRRR|.......').world.actors[0]?.pos).toEqual(vec(1, 3, 0));
  });

  it('la télécommande: a first step to the right drops the reflection in the pit', () => {
    expect(play(named('la-telecommande'), 'RURRR|.....').world.actors[0]?.pos).toEqual(vec(4, 1, 0));
  });
});

describe('rules the later worlds lean on', () => {
  it("l'ancre fragile: crossing on foot drops the anchor slab, and the wire back ends in the void", () => {
    const level = named('l-ancre-fragile');
    expect(outcomeOf(play(level, 'RRRRRRRRLLELLLLLE').world)).toBe('fallen');
  });

  it('deux reflets: a tower of two reflections does not reach over the lintels', () => {
    // Found by the two-clone audit when the lintels were one cell high.
    expect(outcomeOf(play(named('deux-reflets'), '..L|L|RU.RURRRR').world)).not.toBe('won');
  });

  it('deux reflets: a reflection sent alone to the far plate ends at the bottom of the pit', () => {
    const { world } = play(named('deux-reflets'), 'RRRR|......');
    expect(world.actors[0]?.pos).toEqual(vec(3, 1, 0));
  });

  it('parahydox: walking over both levers shuts the wire again', () => {
    const { world } = play(named('parahydox'), 'EUUU....RRR.....R|EUUURERRRRREDD');
    expect(outcomeOf(world)).toBe('playing');
    expect(world.toggled).toEqual([]);
    expect(playerOf(world)).toMatchObject({ dim: 1, pos: vec(13, 2, 3) });
  });

  it('parahydox: without the last step of the reflection, the grille stays shut', () => {
    const { world } = play(named('parahydox'), 'EUUU....RRR|EUUURERRRURREDDDERR');
    expect(outcomeOf(world)).toBe('playing');
    expect(playerOf(world).pos).toEqual(vec(13, 2, 0));
  });
});

describe('the jump is a tool, not a way round', () => {
  it('la fosse: two cells cannot be jumped without the crate as a springboard', () => {
    const level = named('la-fosse');
    // Hop over the crate, then try to jump the pit from its edge.
    const { world } = play(level, 'RURRURR');
    expect(outcomeOf(world)).toBe('playing');
    expect(playerOf(world).pos.y).toBeLessThan(3);
  });

  it('après toi: the roof is too thick to land on, even from the clone', () => {
    const { world } = play(named('apres-toi'), 'RR|RRURRRRRRURRRR');
    expect(outcomeOf(world)).toBe('playing');
  });

  it('le saut de la foi: the recorded jump fails alone and carries from the player\'s head', () => {
    const level = named('le-saut-de-la-foi');
    const alone = play(level, '.RRRURRRR');
    expect(playerOf(alone.world).pos).toEqual(vec(7, 1, 0));
    const carried = play(level, '.RRRURRRR|RRR......');
    expect(carried.world.actors[0]?.pos).toEqual(vec(10, 3, 0));
  });
});

