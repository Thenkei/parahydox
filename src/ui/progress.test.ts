import { describe, expect, it } from 'vitest';
import { CAMPAIGNS, type CampaignId, campaignById } from '../levels';
import { openedLine } from './hud';
import { type Unlockable, campaignOpen, levelOpen, missingFor, nextWaitingOn, openedBetween, remainingIn, solvedIn, withWin } from './progress';

/** The shape of the real game, in play order: the rules read their thresholds off the real campaigns. */
const SIZES: readonly (readonly [CampaignId, string, number])[] = [
  ['main', 'm', 64],
  ['givre', 'g', 16],
  ['tore', 't', 16],
  ['envers', 'e', 16],
  ['hardcore', 'h', 32],
  ['hyperspace', 'x', 8],
];
const entries: Unlockable[] = SIZES.flatMap(([campaign, prefix, count]) => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i + 1}`, campaign })));
const indexOf = (id: string): number => entries.findIndex((entry) => entry.id === id);
const solved = (...ids: string[]): Record<string, number> => Object.fromEntries(ids.map((id) => [id, 10]));
/** The first `count` levels of a campaign, optionally leaving some out. */
const firstOf = (prefix: string, count: number, except: readonly number[] = []): string[] =>
  Array.from({ length: count }, (_, i) => i + 1)
    .filter((n) => !except.includes(n))
    .map((n) => `${prefix}${n}`);
const openCampaigns = (times: Record<string, number>): CampaignId[] => CAMPAIGNS.map((campaign) => campaign.id).filter((id) => campaignOpen(id, entries, times));

describe('what is open', () => {
  it('starts with the first level of the main campaign and nothing else', () => {
    expect(entries.filter((_, i) => levelOpen(i, entries, {})).map((entry) => entry.id)).toEqual(['m1']);
    expect(openCampaigns({})).toEqual(['main']);
  });

  it('opens a level once the one before it is solved, and keeps solved levels open', () => {
    expect(entries.filter((_, i) => levelOpen(i, entries, solved('m1'))).map((entry) => entry.id)).toEqual(['m1', 'm2']);
    // A level solved out of order (skipped to with N) stays open, and opens the next.
    expect(levelOpen(indexOf('m3'), entries, solved('m2'))).toBe(true);
    expect(levelOpen(indexOf('m4'), entries, solved('m2'))).toBe(false);
  });

  it('opens a campaign at its count, not one solve before', () => {
    const almost = solved(...firstOf('m', 23));
    expect(campaignOpen('givre', entries, almost)).toBe(false);
    expect(missingFor('givre', entries, almost)).toBe(1);
    expect(levelOpen(indexOf('g1'), entries, almost)).toBe(false);

    const there = solved(...firstOf('m', 24));
    expect(campaignOpen('givre', entries, there)).toBe(true);
    expect(missingFor('givre', entries, there)).toBe(0);
    // Its first level needs nothing but its campaign; the second waits for the first, as anywhere.
    expect(levelOpen(indexOf('g1'), entries, there)).toBe(true);
    expect(levelOpen(indexOf('g2'), entries, there)).toBe(false);
  });

  it('lets several campaigns wait on the same one, each at its own count', () => {
    expect(openCampaigns(solved(...firstOf('m', 24)))).toEqual(['main', 'givre']);
    expect(openCampaigns(solved(...firstOf('m', 39)))).toEqual(['main', 'givre']);
    expect(openCampaigns(solved(...firstOf('m', 40)))).toEqual(['main', 'givre', 'tore']);
    expect(openCampaigns(solved(...firstOf('m', 56)))).toEqual(['main', 'givre', 'tore', 'envers']);
    expect(openCampaigns(solved(...firstOf('m', 63)))).toEqual(['main', 'givre', 'tore', 'envers']);
    expect(openCampaigns(solved(...firstOf('m', 64)))).toEqual(['main', 'givre', 'tore', 'envers', 'hardcore']);

    const times = solved(...firstOf('m', 30));
    expect(CAMPAIGNS.map((campaign) => missingFor(campaign.id, entries, times))).toEqual([0, 0, 10, 26, 34, 32]);
  });

  it('counts solves wherever they are: skipped levels do not hold a campaign shut', () => {
    // Twenty-four solved out of the first twenty-seven: three were skipped with N on the way.
    const skipping = solved(...firstOf('m', 27, [5, 11, 20]));
    expect(solvedIn('main', entries, skipping)).toBe(24);
    expect(campaignOpen('givre', entries, skipping)).toBe(true);
    // The last ones count like any other.
    expect(campaignOpen('givre', entries, solved(...firstOf('m', 64).slice(-24)))).toBe(true);
  });

  it('keeps hardcore shut until every level of the main campaign is solved', () => {
    expect(campaignById('hardcore').requires).toEqual({ campaign: 'main', solved: 64 });
    // The last main level alone is not the campaign: it can be reached by skipping.
    const holed = solved(...firstOf('m', 64, [2]));
    expect(campaignOpen('hardcore', entries, holed)).toBe(false);
    expect(levelOpen(indexOf('h1'), entries, holed)).toBe(false);
    expect(remainingIn('main', entries, holed)).toBe(1);
    expect(missingFor('hardcore', entries, holed)).toBe(1);

    const all = solved(...firstOf('m', 64));
    expect(campaignOpen('hardcore', entries, all)).toBe(true);
    expect(levelOpen(indexOf('h1'), entries, all)).toBe(true);
    expect(levelOpen(indexOf('h2'), entries, all)).toBe(false);
  });

  it('opens the finale when all 32 distinct hardcore levels are solved', () => {
    const before = solved(...firstOf('m', 64), ...firstOf('h', 32, [2]));
    const after = { ...before, h2: 20 };
    expect(levelOpen(indexOf('x1'), entries, before)).toBe(false);
    expect(openedBetween(before, after, entries)).toEqual(['hyperspace']);
    expect(levelOpen(indexOf('x1'), entries, after)).toBe(true);
    expect(levelOpen(indexOf('x2'), entries, after)).toBe(false);
  });

  it('opens nothing with times that belong to another campaign', () => {
    // Times left by `?unlock` or an older save must not stand in for the main campaign,
    const elsewhere = solved(...firstOf('g', 16), ...firstOf('t', 16), ...firstOf('e', 16), ...firstOf('h', 32));
    expect(openCampaigns(elsewhere)).toEqual(['main']);
    expect(levelOpen(indexOf('g1'), entries, elsewhere)).toBe(false);
    expect(levelOpen(indexOf('h2'), entries, elsewhere)).toBe(false);
    // nor make up the count: twenty-three main levels and any number of others are still twenty-three,
    const padded = { ...elsewhere, ...solved(...firstOf('m', 23)) };
    expect(solvedIn('main', entries, padded)).toBe(23);
    expect(campaignOpen('givre', entries, padded)).toBe(false);
    // and neither does a time under an id that is no level at all.
    expect(campaignOpen('givre', entries, { ...solved(...firstOf('m', 23)), 'm99-gone': 10 })).toBe(false);
  });

  it('is false outside the list', () => {
    expect(levelOpen(-1, entries, {})).toBe(false);
    expect(levelOpen(999, entries, {})).toBe(false);
  });
});

describe('a win', () => {
  it('keeps the fastest time', () => {
    const first = withWin({ last: null, times: {}, seenLessons: [] }, 'm1', 12);
    expect(withWin(first, 'm1', 15).times.m1).toBe(12);
    expect(withWin(first, 'm1', 9).times.m1).toBe(9);
  });

  it('opens a campaign exactly once: on the solve that reaches its count', () => {
    const before = solved(...firstOf('m', 23));
    expect(openedBetween(before, { ...before, m24: 10 }, entries)).toEqual(['givre']);
    // A better time on a level already solved opens nothing, and neither does the solve after.
    expect(openedBetween(before, { ...before, m1: 5 }, entries)).toEqual([]);
    expect(openedBetween({ ...before, m24: 10 }, { ...before, m24: 10, m25: 10 }, entries)).toEqual([]);
    expect(openedBetween(solved(...firstOf('m', 63)), solved(...firstOf('m', 64)), entries)).toEqual(['hardcore']);
  });

  it('names every campaign it opens, in play order', () => {
    expect(openedBetween(solved(...firstOf('m', 23)), solved(...firstOf('m', 40)), entries)).toEqual(['givre', 'tore']);
    expect(openedBetween({}, solved(...firstOf('m', 64)), entries)).toEqual(['givre', 'tore', 'envers', 'hardcore']);
  });

  it('knows which campaign is closest to opening behind the one being played', () => {
    expect(nextWaitingOn('main', entries, {})).toEqual({ campaign: 'givre', missing: 24 });
    expect(nextWaitingOn('main', entries, solved(...firstOf('m', 30)))).toEqual({ campaign: 'tore', missing: 10 });
    expect(nextWaitingOn('main', entries, solved(...firstOf('m', 64, [2])))).toEqual({ campaign: 'hardcore', missing: 1 });
    expect(nextWaitingOn('main', entries, solved(...firstOf('m', 64)))).toBeNull();
    expect(nextWaitingOn('givre', entries, {})).toBeNull();
  });

  it('says what opened in one line', () => {
    expect(openedLine([campaignById('givre')])).toBe('Le givre est ouvert : Échap pour y aller.');
    expect(openedLine([campaignById('givre'), campaignById('tore')])).toBe('Le givre et Le tore sont ouverts : Échap pour y aller.');
    expect(openedLine((['givre', 'tore', 'envers'] as const).map(campaignById))).toBe("Le givre, Le tore et L'envers sont ouverts : Échap pour y aller.");
  });
});
