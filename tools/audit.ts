/**
 * Audits levels the way a designer would before shipping them:
 *
 *   npm run audit [-- <level.txt> ...] [--states n] [--no-solo] [--write] [--fewer]
 *
 * For each level (every campaign by default): replays its `tape:` and says how it ends;
 * then looks for a run without any clone. A level without clones must have one (it is
 * printed when the level has no tape yet); a level with clones must not, or the clone is
 * decoration, and the last loop of its run must not win alone. Exits with an error if a
 * level fails a check.
 *
 * `--fewer` replays a run of several clones with one clone missing and looks for a way
 * through anyway: a clone the level can do without is decoration too.
 *
 * While designing, a loop of the tape may be left open with "?" ("R44 _10 | ?"): the audit
 * looks for it with the loops before it as clones, starting from whatever is written before
 * the "?" ("R30 ?"). "?@x,y[,z]" looks for the hero standing in that cell instead of the
 * exit, for a clone that must go and wait somewhere, and "?flat" never unfolds the depth. `--write` puts what it finds, and the
 * run of a level that has no tape at all, into the level file.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatLevelErrors, parseLevel } from '../src/core/level-parser';
import { type FlowWorld, type FrameInput, outcomeOfFlow, playerOfFlow } from '../src/flow/physics';
import { searchRun } from '../src/flow/search';
import { parseTape, runTape } from '../src/flow/tape';

const args = process.argv.slice(2);
const option = (name: string): string | null => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const dir = 'src/levels';
/** One directory per campaign, in play order; a campaign that has no level yet has no directory. */
const dirs = [dir, ...['givre', 'tore', 'envers', 'hardcore'].map((campaign) => join(dir, campaign))].filter((d) => existsSync(d));
const named = args.filter((a) => a.endsWith('.txt'));
const files = named.length > 0 ? named : dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.txt')).sort().map((f) => join(d, f)));
const maxStates = Number(option('states') ?? 400_000);
const solo = !args.includes('--no-solo');
const write = args.includes('--write');
const fewer = args.includes('--fewer');

/** Sets the `tape:` header of a level file, adding it after the other headers if it is missing. */
function saveTape(file: string, tape: string): void {
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((line) => line.startsWith('tape:'));
  if (at >= 0) lines[at] = `tape: ${tape}`;
  else lines.splice(lines.findIndex((line) => /^z\s*=/.test(line)) - 1, 0, `tape: ${tape}`);
  writeFileSync(file, lines.join('\n'));
}
let failures = 0;

for (const file of files) {
  const parsed = parseLevel(readFileSync(file, 'utf8'));
  if (!parsed.ok) {
    console.log(formatLevelErrors(file, parsed.error));
    failures++;
    continue;
  }
  let level = parsed.value;
  const notes: string[] = [];
  let bad = false;

  // Loops left open with "?": find them one after the other, the loops before running as clones.
  if (level.tape !== null && level.tape.includes('?')) {
    const loops = level.tape.split('|').map((loop) => loop.trim());
    const done: FrameInput[][] = [];
    let failed: string | null = null;
    for (const [i, text] of loops.entries()) {
      const open = /^(.*)\?(flat)?(?:@(\d+),(\d+)(?:,(\d+))?)?\s*(.*)$/.exec(text);
      if (!open) {
        const whole = parseTape(text);
        if (!whole.ok) failed = whole.error;
        else done.push(whole.value[0] ?? []);
        if (failed !== null) break;
        continue;
      }
      const [, before = '', flat, gx, gy, gz, after = ''] = open;
      const opening = parseTape(before);
      if (!opening.ok) {
        failed = opening.error;
        break;
      }
      // "?@x,y[,z]" looks for the hero standing in that cell instead of the exit.
      const goal =
        gx === undefined
          ? undefined
          : (world: FlowWorld): boolean => {
              const p = playerOfFlow(world);
              return (p.grounded || p.dim === 1) && Math.floor(p.x) === Number(gx) && Math.floor(p.y + 0.01) === Number(gy) && (gz === undefined || Math.floor(p.z) === Number(gz));
            };
      const found = searchRun(level, { clones: done, prefix: opening.value[0] ?? [], maxStates: maxStates * 3, maxFrames: 60 * 25, flat: flat !== undefined, ...(goal === undefined ? {} : { goal }) });
      if (!found.found || found.tape === null) {
        failed = `loop ${i + 1} NOT found (${found.exhausted ? 'exhausted' : 'limit'}, ${found.states} states)`;
        break;
      }
      // A clone that has arrived stays a moment before the loop is cut.
      loops[i] = `${found.tape}${gx === undefined ? '' : ' _30'}${after === '' ? '' : ` ${after}`}`.trim();
      notes.push(`loop ${i + 1}: ${loops[i]}`);
      const parsedLoop = parseTape(loops[i] ?? '');
      if (parsedLoop.ok) done.push(parsedLoop.value[0] ?? []);
    }
    if (failed !== null) {
      console.log(`FAIL  ${file.replace(`${dir}/`, '')}  ${level.world}  ${[...notes, failed].join(' · ')}`);
      failures++;
      continue;
    }
    // The search jumps for no reason: drop every jump the run wins without, so the tape reads like a run.
    const wins = (candidate: readonly string[]): boolean => {
      const tape = parseTape(candidate.join(' | '));
      return tape.ok && outcomeOfFlow(runTape(level, tape.value).world) === 'won';
    };
    if (wins(loops)) {
      const last = loops.length - 1;
      const tokens = (loops[last] ?? '').split(/\s+/);
      for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t] ?? '';
        if (!token.includes('J')) continue;
        const plain = token.replace('J', '').replace(/^(\d+)$/, '_$1');
        const candidate = [...tokens.slice(0, t), plain, ...tokens.slice(t + 1)];
        if (wins([...loops.slice(0, last), candidate.join(' ')])) tokens[t] = plain;
      }
      loops[last] = tokens.join(' ');
    }
    const whole = loops.join(' | ');
    if (write) saveTape(file, whole);
    level = { ...level, tape: whole };
  }

  if (level.tape === null) {
    notes.push('no tape');
    bad = true;
  } else {
    const tape = parseTape(level.tape);
    if (!tape.ok) {
      notes.push(`tape: ${tape.error}`);
      bad = true;
    } else {
      const { world } = runTape(level, tape.value);
      const frames = tape.value.reduce((sum, loop) => sum + loop.length, 0);
      const outcome = outcomeOfFlow(world);
      notes.push(`tape ${outcome} (${tape.value.length} loop${tape.value.length > 1 ? 's' : ''}, ${(frames / 60).toFixed(1)} s)`);
      if (outcome !== 'won') bad = true;
      if (tape.value.length - 1 > level.maxClones) {
        notes.push(`tape uses ${tape.value.length - 1} clones, level allows ${level.maxClones}`);
        bad = true;
      }
      if (level.maxClones > 0 && outcomeOfFlow(runTape(level, [tape.value.at(-1) ?? []], 120).world) === 'won') {
        notes.push('the LAST LOOP WINS ALONE');
        bad = true;
      }
      if (fewer && outcome === 'won' && tape.value.length > 2) {
        const clones = tape.value.slice(0, -1);
        clones.forEach((_, missing) => {
          const result = searchRun(level, { clones: clones.filter((__, i) => i !== missing), maxStates });
          if (result.found) {
            notes.push(`WORKS WITHOUT clone ${missing + 1}: ${result.tape}`);
            bad = true;
          } else {
            notes.push(`clone ${missing + 1} ${result.exhausted ? 'is needed' : `not replaced within ${result.states} states`}`);
          }
        });
      }
    }
  }

  if (solo && (level.maxClones > 0 || level.tape === null)) {
    const result = searchRun(level, { maxStates });
    if (level.maxClones === 0) {
      notes.push(result.found ? `solo run: ${result.tape}` : `NO solo run (${result.exhausted ? 'exhausted' : 'limit'})`);
      if (result.found && result.tape !== null && write) saveTape(file, result.tape);
    } else if (result.found) {
      notes.push(`SHORTCUT without a clone: ${result.tape}`);
      bad = true;
    } else {
      notes.push(result.exhausted ? 'needs a clone' : `no solo run within ${result.states} states`);
    }
  }
  if (bad) failures++;
  console.log(`${bad ? 'FAIL' : ' ok '}  ${file.replace(`${dir}/`, '')}  ${level.world}  ${notes.join(' · ')}`);
}
if (failures > 0) {
  console.log(`${failures} level${failures > 1 ? 's' : ''} to fix`);
  process.exitCode = 1;
}
