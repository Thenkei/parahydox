/**
 * Looks for a run through a level (see src/flow/search.ts):
 *
 *   npm run explore -- <level.txt> [--with "<tape of the earlier loops>"] [--from "<tape>"] [--goal x,y[,z]] [--chunk n] [--seconds n] [--states n] [--fine]
 *
 * Without --goal it looks for the exit; with it, for the hero standing in that cell.
 * `--with` replays earlier loops as clones first ("|" between loops), and the search is
 * for the loop after them; `--from` gives the beginning of that loop. Prints the tape found, or says whether everything reachable
 * was visited.
 */
import { readFileSync } from 'node:fs';
import { formatLevelErrors, parseLevel } from '../src/core/level-parser';
import { type FlowWorld, playerOfFlow } from '../src/flow/physics';
import { searchRun } from '../src/flow/search';
import { parseTape } from '../src/flow/tape';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && a.endsWith('.txt'));
const option = (name: string): string | null => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
if (!file) throw new Error('Usage: npm run explore -- <level.txt> [--with "<tape>"] [--goal x,y[,z]] [--chunk n] [--seconds n] [--states n]');
const parsed = parseLevel(readFileSync(file, 'utf8'));
if (!parsed.ok) throw new Error(formatLevelErrors(file, parsed.error));
const level = parsed.value;

const earlier = option('with');
const clones = earlier === null ? [] : (() => {
  const tape = parseTape(earlier);
  if (!tape.ok) throw new Error(tape.error);
  return tape.value;
})();
const fromArg = option('from');
const prefix = fromArg === null ? [] : (() => {
  const tape = parseTape(fromArg);
  if (!tape.ok) throw new Error(tape.error);
  return tape.value[0] ?? [];
})();
const goalArg = option('goal');
const goalCell = goalArg === null ? null : goalArg.split(',').map(Number);
const goal =
  goalCell === null
    ? undefined
    : (world: FlowWorld): boolean => {
        const p = playerOfFlow(world);
        const [x = 0, y = 0, z] = goalCell;
        return (p.grounded || p.dim === 1) && Math.floor(p.x) === x && Math.floor(p.y + 0.01) === y && (z === undefined || Math.floor(p.z) === z);
      };

const started = Date.now();
const result = searchRun(level, {
  clones,
  prefix,
  ...(goal === undefined ? {} : { goal }),
  fine: args.includes('--fine'),
  chunk: Number(option('chunk') ?? 6),
  maxFrames: Number(option('seconds') ?? 40) * 60,
  maxStates: Number(option('states') ?? 600_000),
});
const took = ((Date.now() - started) / 1000).toFixed(1);
if (result.found) console.log(`found in ${result.frames} frames (${result.states} states, ${took} s):\n${result.tape}`);
else console.log(`not found: ${result.exhausted ? 'everything reachable was visited' : 'gave up at the limit'} (${result.states} states, ${took} s)`);
