/**
 * Level-design companion: audits level files.
 *
 *   npm run solve -- [--clone] [--exact] [--cheapest] [--pair] [--json] <level.txt> [more.txt ...]
 *
 * For each file: parse errors if any, whether the `solution:` header wins, the shortest
 * solution without clones, and with --clone the shortest two-loop solution in which the
 * clone runs a plain errand (see src/core/solver.ts). --exact adds the exhaustive
 * two-loop search, mimes and pauses included: slow, and only for levels with clones.
 * --cheapest runs the same search for the best score (waits are free). --pair audits
 * levels for two clones: the best score when both clones run plain errands.
 */
import { readFileSync } from 'node:fs';
import { newGame, reduce } from '../src/core/game';
import { formatLevelErrors, parseLevel } from '../src/core/level-parser';
import { parseScript } from '../src/core/script';
import { totalSteps } from '../src/core/session';
import { cheapestWithOneClone, cheapestWithTwoPlainClones, solveSolo, solveWithOneClone, solveWithOneCloneExact } from '../src/core/solver';
import { outcomeOf, playerOf } from '../src/core/world';

const args = process.argv.slice(2);
const withClone = args.includes('--clone');
const asJson = args.includes('--json');
const exact = args.includes('--exact');
const cheapest = args.includes('--cheapest');
const pair = args.includes('--pair');
const files = args.filter((a) => !a.startsWith('--'));

for (const file of files) {
  const parsed = parseLevel(readFileSync(file, 'utf8'));
  if (!parsed.ok) {
    if (asJson) console.log(JSON.stringify({ file, error: formatLevelErrors(file, parsed.error) }));
    else console.log(formatLevelErrors(file, parsed.error));
    continue;
  }
  const level = parsed.value;
  let intended: { outcome: string; steps: number; at: string } | null = null;
  if (level.solution !== null) {
    const commands = parseScript(level.solution);
    if (commands.ok) {
      const state = commands.value.reduce(reduce, newGame(level));
      const p = playerOf(state.world);
      intended = { outcome: outcomeOf(state.world), steps: totalSteps(state.session), at: `${p.pos.x},${p.pos.y},${p.pos.z} ${p.dim}D` };
    } else {
      intended = { outcome: `bad script: ${commands.error}`, steps: 0, at: '' };
    }
  }
  const solo = solveSolo(level, 80);
  const clone = withClone && level.maxClones > 0 && solo === null ? solveWithOneClone(level) : null;

  if (asJson) {
    console.log(JSON.stringify({ file, name: level.name, clones: level.maxClones, par: level.par, intended, solo, clone }));
    continue;
  }
  const { w, h, d } = level.size;
  console.log(`${file} — ${level.name} (${w}x${h}x${d}, clones ${level.maxClones}${level.mirror ? ', mirror' : ''}, par ${level.par ?? '-'})`);
  if (intended) console.log(`  intended: ${intended.outcome} in ${intended.steps} steps, ends at ${intended.at}`);
  console.log(`  solo:     ${solo === null ? 'no solution' : `${solo.length} steps  ${solo}`}`);
  if (exact && level.maxClones > 0 && solo === null) {
    const found = solveWithOneCloneExact(level);
    console.log(
      found === null
        ? '  exact:    no one-clone solution'
        : found === 'too large'
          ? '  exact:    too large to search'
          : `  exact:    second loop of ${found.ticks} steps (${found.explored} states)  ${found.first}|${found.last}`,
    );
  }
  if (cheapest && level.maxClones > 0 && solo === null) {
    const found = cheapestWithOneClone(level);
    console.log(
      found === null
        ? '  cheapest: no one-clone solution'
        : found === 'too large'
          ? '  cheapest: too large to search'
          : `  cheapest: ${found.actions} actions with one clone (${found.explored} states)  ${found.first}|${found.last}`,
    );
  }
  if (pair && level.maxClones > 1 && solo === null) {
    const found = cheapestWithTwoPlainClones(level);
    console.log(found === null ? '  pair:     no solution with two plain-errand clones' : `  pair:     ${found.actions} actions with two plain-errand clones  ${found.script}`);
  }
  if (withClone && level.maxClones > 0) {
    console.log(`  clone:    ${clone === null ? (solo === null ? 'no plain-errand solution' : 'skipped (solvable alone)') : `${clone.steps} steps  ${clone.script}`}`);
  }
}
