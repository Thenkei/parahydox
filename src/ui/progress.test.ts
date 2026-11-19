import { describe, expect, it } from 'vitest';
import { type Unlockable, campaignOpen, levelOpen, remainingIn, withWin } from './progress';

const entries: Unlockable[] = [
  { id: 'm1', campaign: 'main' },
  { id: 'm2', campaign: 'main' },
  { id: 'm3', campaign: 'main' },
  { id: 'h1', campaign: 'hardcore' },
  { id: 'h2', campaign: 'hardcore' },
];
const solved = (...ids: string[]): Record<string, number> => Object.fromEntries(ids.map((id) => [id, 10]));

describe('what is open', () => {
  it('starts with the first level of the main campaign and nothing else', () => {
    expect(entries.map((_, i) => levelOpen(i, entries, {}))).toEqual([true, false, false, false, false]);
  });

  it('opens a level once the one before it is solved, and keeps solved levels open', () => {
    expect(entries.map((_, i) => levelOpen(i, entries, solved('m1')))).toEqual([true, true, false, false, false]);
    // A level solved out of order (skipped to with N) stays open, and opens the next.
    expect(levelOpen(2, entries, solved('m2'))).toBe(true);
  });

  it('keeps hardcore shut until every level of the main campaign is solved', () => {
    // The last main level alone is not the campaign: it can be reached by skipping.
    expect(campaignOpen('hardcore', entries, solved('m1', 'm3'))).toBe(false);
    expect(levelOpen(3, entries, solved('m1', 'm3'))).toBe(false);
    expect(remainingIn('main', entries, solved('m1', 'm3'))).toBe(1);

    const all = solved('m1', 'm2', 'm3');
    expect(campaignOpen('hardcore', entries, all)).toBe(true);
    expect(entries.map((_, i) => levelOpen(i, entries, all))).toEqual([true, true, true, true, false]);
  });

  it('does not let a hardcore time open hardcore by itself', () => {
    // A time left by `?unlock` or an older save must not stand in for the main campaign.
    expect(levelOpen(3, entries, solved('h1'))).toBe(false);
    expect(levelOpen(4, entries, solved('h1'))).toBe(false);
  });

  it('is false outside the list', () => {
    expect(levelOpen(-1, entries, {})).toBe(false);
    expect(levelOpen(99, entries, {})).toBe(false);
  });
});

describe('a win', () => {
  it('keeps the fastest time', () => {
    const first = withWin({ last: 0, times: {} }, 'm1', 12);
    expect(withWin(first, 'm1', 15).times.m1).toBe(12);
    expect(withWin(first, 'm1', 9).times.m1).toBe(9);
  });
});
