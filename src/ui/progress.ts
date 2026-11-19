import { CAMPAIGNS, type CampaignId, campaignById } from '../levels';

const STORAGE_KEY = 'parahydox.progress.v4';

export interface Progress {
  /**
   * The level last opened, by id: ids survive a campaign being added or reordered, positions
   * do not. A number is a save from before that: a position in the play order of its day.
   */
  readonly last: string | number | null;
  /** Fastest winning time in seconds, by level id. A level with a time is a level solved. */
  readonly times: Readonly<Record<string, number>>;
}

const EMPTY: Progress = { last: null, times: {} };

/** Progress is a convenience: the game must run the same when storage is unavailable. */
export function loadProgress(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Progress> | null;
    if (raw === null || typeof raw !== 'object') return EMPTY;
    const times: Record<string, number> = {};
    for (const [id, value] of Object.entries((raw.times ?? {}) as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) times[id] = value;
    }
    return { last: typeof raw.last === 'string' || typeof raw.last === 'number' ? raw.last : null, times };
  } catch {
    return EMPTY;
  }
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Private mode or blocked storage: nothing to do, progress just won't persist.
  }
}

/** Records a win, keeping the fastest time. */
export function withWin(progress: Progress, id: string, seconds: number): Progress {
  const fastest = progress.times[id];
  return fastest !== undefined && fastest <= seconds ? progress : { ...progress, times: { ...progress.times, [id]: seconds } };
}

/** What the unlock rules read of a level: who it is, and which campaign it belongs to. */
export interface Unlockable {
  readonly id: string;
  readonly campaign: CampaignId;
}

type Times = Readonly<Record<string, number>>;

/** Levels of a campaign solved so far. A time under an id that is not one of its levels counts for nothing. */
export const solvedIn = (campaign: CampaignId, entries: readonly Unlockable[], times: Times): number =>
  entries.filter((entry) => entry.campaign === campaign && entry.id in times).length;

/** Levels of a campaign still to solve. */
export const remainingIn = (campaign: CampaignId, entries: readonly Unlockable[], times: Times): number =>
  entries.filter((entry) => entry.campaign === campaign && !(entry.id in times)).length;

/**
 * Solves the campaign it waits on still lacks before `campaign` can open; 0 when it has
 * what it asks for, or asks for nothing.
 */
export function missingFor(campaign: CampaignId, entries: readonly Unlockable[], times: Times): number {
  const { requires } = campaignById(campaign);
  return requires === null ? 0 : Math.max(0, requires.solved - solvedIn(requires.campaign, entries, times));
}

/**
 * A campaign opens once enough levels of the one it waits on are solved: a count, whichever
 * levels they are, since N lets the player skip. The campaign waited on must be open itself.
 */
export function campaignOpen(campaign: CampaignId, entries: readonly Unlockable[], times: Times): boolean {
  const { requires } = campaignById(campaign);
  return requires === null || (campaignOpen(requires.campaign, entries, times) && missingFor(campaign, entries, times) === 0);
}

/** Campaigns that `after` opens and `before` did not, in play order: what a win has just earned. */
export const openedBetween = (before: Times, after: Times, entries: readonly Unlockable[]): CampaignId[] =>
  CAMPAIGNS.map((campaign) => campaign.id).filter((id) => !campaignOpen(id, entries, before) && campaignOpen(id, entries, after));

/** Among the campaigns that still lack solves of `campaign`, the closest to opening, and how many it lacks; null when none waits. */
export function nextWaitingOn(campaign: CampaignId, entries: readonly Unlockable[], times: Times): { readonly campaign: CampaignId; readonly missing: number } | null {
  const waiting = CAMPAIGNS.filter((other) => other.requires?.campaign === campaign)
    .map((other) => ({ campaign: other.id, missing: missingFor(other.id, entries, times) }))
    .filter(({ missing }) => missing > 0)
    .sort((a, b) => a.missing - b.missing);
  return waiting[0] ?? null;
}

/**
 * Within an open campaign, a level opens once the one before it is solved, and a solved
 * level stays open. The first level of a campaign needs nothing but its campaign.
 */
export function levelOpen(index: number, entries: readonly Unlockable[], times: Times): boolean {
  const entry = entries[index];
  if (!entry || !campaignOpen(entry.campaign, entries, times)) return false;
  const previous = entries[index - 1];
  return previous === undefined || previous.campaign !== entry.campaign || entry.id in times || previous.id in times;
}
