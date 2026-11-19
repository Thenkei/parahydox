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
