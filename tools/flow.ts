/**
 * Tries a flow level without a keyboard:
 *
 *   npm run flow -- <level.txt> "<tape>" [every]
 *
 * Prints where the hero is every `every` frames of the last loop (default 10), and how the
 * run ends. The level's own `tape:` header is used when no tape is given.
 */
import { readFileSync } from 'node:fs';
import { formatLevelErrors, parseLevel } from '../src/core/level-parser';
import { initialFlow, outcomeOfFlow, playerOfFlow, stepFlow } from '../src/flow/physics';
import { inputsAtFlow, newFlowSession, parseTape, rewindFlow } from '../src/flow/tape';

const [file, tapeArg, everyArg] = process.argv.slice(2);
if (!file) throw new Error('Usage: npm run flow -- <level.txt> "<tape>" [every]');
const parsed = parseLevel(readFileSync(file, 'utf8'));
if (!parsed.ok) throw new Error(formatLevelErrors(file, parsed.error));
const level = parsed.value;
const tape = parseTape(tapeArg || level.tape || '');
if (!tape.ok) throw new Error(tape.error);
const every = Number(everyArg ?? 10);

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
    if (last && world.tick % every === 0) {
      const p = playerOfFlow(world);
      const others = world.bodies.slice(0, -1).map((b) => `c${b.id + 1}(${b.x.toFixed(1)},${b.y.toFixed(1)}${b.status === 'active' ? '' : ' ' + b.status})`).join(' ');
      console.log(`f${String(world.tick).padStart(4)}  hero x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(2)} ${p.dim}D ${p.grounded ? 'ground' : 'air'}  ${others}  levers[${world.toggled.join('')}] broken ${world.broken.length}`);
    }
  }
  const p = playerOfFlow(world);
  console.log(`loop ${index + 1}: ${world.tick} frames, ${outcomeOfFlow(world)}, hero at x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(2)} ${p.dim}D`);
});
