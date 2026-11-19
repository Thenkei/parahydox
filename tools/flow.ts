/**
 * Tries a level without a keyboard:
 *
 *   npm run flow -- <level.txt> ["<tape>"] [every]
 *
 * Prints where everyone is every `every` frames of the last loop (default 10; 0 for none),
 * how each loop ends, and a picture of the hero's slice at the end. The level's own
 * `tape:` header is used when no tape is given.
 */
import { readFileSync } from 'node:fs';
import { cellAt, vec } from '../src/core/grid';
import { formatLevelErrors, parseLevel } from '../src/core/level-parser';
import { type FlowWorld, initialFlow, outcomeOfFlow, playerOfFlow, stepFlow } from '../src/flow/physics';
import { inputsAtFlow, newFlowSession, parseTape, rewindFlow } from '../src/flow/tape';

const [file, tapeArg, everyArg] = process.argv.slice(2);
if (!file) throw new Error('Usage: npm run flow -- <level.txt> "<tape>" [every]');
const parsed = parseLevel(readFileSync(file, 'utf8'));
if (!parsed.ok) throw new Error(formatLevelErrors(file, parsed.error));
const level = parsed.value;
const tape = parseTape(tapeArg || level.tape || '');
if (!tape.ok) throw new Error(tape.error);
const every = Number(everyArg ?? 10);

/** The slice the hero is in, as text: terrain (ice is i), then crates (o), clones (1, 2…) and the hero (@). */
function picture(world: FlowWorld): string {
  const hero = playerOfFlow(world);
  const z = Math.floor(hero.z);
  const rows: string[][] = [];
  for (let y = level.size.h - 1; y >= 0; y--) {
    const row: string[] = [];
    for (let x = 0; x < level.size.w; x++) {
      const cell = cellAt(level, vec(x, y, z));
      const index = x + level.size.w * (y + level.size.h * z);
      row.push(
        !cell
          ? ' '
          : cell.solid
            ? cell.fragile
              ? world.broken.includes(index)
                ? ' '
                : '~'
              : cell.ice
                ? 'i'
                : '#'
            : cell.exit
              ? cell.reality ? 'O' : 'X'
              : cell.door !== null
                ? cell.inverted
                  ? '%'
                  : cell.door.toUpperCase()
                : cell.plate !== null
                  ? cell.plate
                  : cell.lever !== null
                    ? cell.lever
                    : cell.anchor
                      ? '*'
                      : cell.wire !== null
                        ? '='
                        : cell.threshold
                          ? '^'
                          : cell.checkpoint ? '+' : '.',
      );
    }
    rows.push(row);
  }
  const put = (x: number, y: number, at: number, glyph: string): void => {
    if (Math.floor(at) !== z) return;
    const row = rows[level.size.h - 1 - Math.floor(y + 0.01)];
    if (row && Math.floor(x) >= 0 && Math.floor(x) < level.size.w) row[Math.floor(x)] = glyph;
  };
  for (const c of world.crates) put(c.x, c.y, c.z, 'o');
  world.bodies.forEach((b, i) => {
    if (b.status === 'active') put(b.x, b.dim === 1 ? b.y + 0.5 : b.y, b.z, b.role === 'player' ? '@' : String(i + 1));
  });
  return rows.map((r) => r.join('')).join('\n');
}

let session = newFlowSession(level);
let world = initialFlow(level, 0);
tape.value.forEach((frames, index) => {
  if (index > 0) {
    session = rewindFlow(session);
    world = initialFlow(level, session.loops.length);
  }
  const last = index === tape.value.length - 1;
  for (const input of frames) {
    if (outcomeOfFlow(world) !== 'playing') break;
    world = stepFlow(world, inputsAtFlow(session, world.tick, input));
    session = { ...session, current: [...session.current, input] };
    if (last && every > 0 && world.tick % every === 0) {
      const p = playerOfFlow(world);
      const others = world.bodies
        .slice(0, -1)
        .map((b) => `c${b.id + 1}(${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)} ${b.dim}D${b.status === 'active' ? '' : ' ' + b.status})`)
        .join(' ');
      const crates = world.crates.map((c) => `o(${c.x.toFixed(2)},${c.y.toFixed(1)},${c.z.toFixed(1)})`).join(' ');
      console.log(
        `f${String(world.tick).padStart(4)}  hero x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(2)} ${p.dim}D ${p.grounded ? 'ground' : p.dim === 1 ? 'wire' : 'air'}${p.slick ? ' slick' : ''}  ${others} ${crates} levers[${world.toggled.join('')}] broken ${world.broken.length}`,
      );
    }
  }
  const p = playerOfFlow(world);
  console.log(`loop ${index + 1}: ${world.tick} frames, ${outcomeOfFlow(world)}, hero at x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(2)} ${p.dim}D`);
});
console.log(picture(world));
