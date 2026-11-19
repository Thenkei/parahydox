import { formatLevelErrors, parseLevel } from './level-parser';
import type { Level } from './types';

/** Test helper: build a level from text, or fail loudly with the parser's own words. */
export function levelFrom(source: string): Level {
  const parsed = parseLevel(source);
  if (!parsed.ok) throw new Error(formatLevelErrors('test', parsed.error));
  return parsed.value;
}
