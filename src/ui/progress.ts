const STORAGE_KEY = 'parahydox.progress.v3';

export interface Progress {
  /** Index of the level last opened. */
  readonly last: number;
  /** Fewest steps of a winning timeline (all loops included), by level id. */
  readonly best: Readonly<Record<string, number>>;
  /** Fastest winning run in seconds, by level id: the other way to play, against the clock. */
  readonly times: Readonly<Record<string, number>>;
}

const EMPTY: Progress = { last: 0, best: {}, times: {} };

/** Progress is a convenience: the game must run the same when storage is unavailable. */
export function loadProgress(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Progress> | null;
    if (raw === null || typeof raw !== 'object') return EMPTY;
    const numbers = (source: unknown): Record<string, number> => {
      const kept: Record<string, number> = {};
      for (const [id, value] of Object.entries((source ?? {}) as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) kept[id] = value;
      }
      return kept;
    };
    return { last: typeof raw.last === 'number' ? raw.last : 0, best: numbers(raw.best), times: numbers(raw.times) };
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

export type Stars = 1 | 2 | 3;

/** Three stars for matching the intended solution, two for coming close, one for finishing. */
export function starsFor(par: number | null, steps: number): Stars {
  if (par === null || steps <= par) return 3;
  return steps <= Math.ceil(par * 1.35) ? 2 : 1;
}

export const starText = (stars: Stars): string => '★'.repeat(stars) + '☆'.repeat(3 - stars);

export function withWin(progress: Progress, id: string, steps: number, seconds: number | null = null): Progress {
  const previous = progress.best[id];
  const fastest = progress.times[id];
  const best = previous !== undefined && previous <= steps ? progress.best : { ...progress.best, [id]: steps };
  const times = seconds === null || (fastest !== undefined && fastest <= seconds) ? progress.times : { ...progress.times, [id]: seconds };
  return best === progress.best && times === progress.times ? progress : { ...progress, best, times };
}

/**
 * The time to beat for the lightning mark, in seconds: the intended solution played
 * without hesitating, at about twice the time the hero needs to carry it out. It asks for
 * a run that is known by heart and timed on the move, which is the platformer in this game.
 */
export function swiftSeconds(solution: string | null): number | null {
  if (solution === null) return null;
  const keys = solution.replace(/[|/\s]/g, '').length;
  const rewinds = (solution.match(/[|/]/g) ?? []).length;
  const shifts = (solution.match(/E/gi) ?? []).length;
  return Math.ceil(keys * 0.2 + rewinds * 1.4 + shifts * 0.45 + 1.5);
}
