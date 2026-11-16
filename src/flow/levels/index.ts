import { formatLevelErrors, parseLevel } from '../../core/level-parser';
import type { Level } from '../../core/types';
import { WORLD_NAMES } from '../../levels';

const sources = import.meta.glob('./*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Flow levels, in file order. Their ids never collide with the step levels' ("flow-…"). */
export const FLOW_SOURCES: readonly { readonly id: string; readonly source: string }[] = Object.keys(sources)
  .sort()
  .map((path) => ({ id: `flow-${path.replace(/^\.\//, '').replace(/\.txt$/, '')}`, source: sources[path] ?? '' }));

/** Chapter titles with the flow chapter added: the same world, on the run. */
export const ALL_WORLD_NAMES: readonly string[] = [...WORLD_NAMES, "L'élan"];

export function loadFlowLevels(): Level[] {
  return FLOW_SOURCES.map(({ id, source }) => {
    const parsed = parseLevel(source);
    if (!parsed.ok) throw new Error(formatLevelErrors(id, parsed.error));
    return parsed.value;
  });
}
