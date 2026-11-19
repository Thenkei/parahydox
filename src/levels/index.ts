import { formatLevelErrors, parseLevel } from '../core/level-parser';
import type { Level } from '../core/types';

const sources = import.meta.glob('./*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Chapter titles, indexed by `level.world - 1`. */
export const WORLD_NAMES: readonly string[] = ['Le fil', 'Le volume', 'La boucle', 'Le croisement', 'La divergence', 'Le levier', 'Le reflet', "L'éphémère"];

/** Levels in play order: files are numbered, and the number is the order. The id is the file name. */
export const LEVEL_SOURCES: readonly { readonly id: string; readonly source: string }[] = Object.keys(sources)
  .sort()
  .map((path) => ({ id: path.replace(/^\.\//, '').replace(/\.txt$/, ''), source: sources[path] ?? '' }));

/** A level that does not parse is a build error, not something to discover while playing. */
export function loadLevels(): Level[] {
  return LEVEL_SOURCES.map(({ id, source }) => {
    const parsed = parseLevel(source);
    if (!parsed.ok) throw new Error(formatLevelErrors(id, parsed.error));
    return parsed.value;
  });
}
