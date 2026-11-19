import { type CampaignId, campaignById } from '../levels';

const STORAGE_KEY = 'parahydox.progress.v4';

export interface Progress {
  /** Index of the level last opened. */
  readonly last: number;
  /** Fastest winning time in seconds, by level id. A level with a time is a level solved. */
  readonly times: Readonly<Record<string, number>>;
}

const EMPTY: Progress = { last: 0, times: {} };

/** Progress is a convenience: the game must run the same when storage is unavailable. */
export function loadProgress(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Progress> | null;
    if (raw === null || typeof raw !== 'object') return EMPTY;
    const times: Record<string, number> = {};
    for (const [id, value] of Object.entries((raw.times ?? {}) as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) times[id] = value;
    }
    return { last: typeof raw.last === 'number' ? raw.last : 0, times };
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

/** Levels of a campaign still to solve. */
export const remainingIn = (campaign: CampaignId, entries: readonly Unlockable[], times: Times): number =>
  entries.filter((entry) => entry.campaign === campaign && !(entry.id in times)).length;

/** A campaign opens once the one it requires is finished, every level of it. */
export function campaignOpen(campaign: CampaignId, entries: readonly Unlockable[], times: Times): boolean {
  const { requires } = campaignById(campaign);
  return requires === null || (campaignOpen(requires, entries, times) && remainingIn(requires, entries, times) === 0);
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
