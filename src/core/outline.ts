import { type GameState, newGame, reduce } from './game';
import { parseScript } from './script';
import { tapesOf } from './session';
import type { Level } from './types';
import { playerOf } from './world';

/**
 * The shape of a level's intended solution, without its content: how many loops, how long,
 * which verbs. It is what a hint can give away before giving the answer.
 */
export interface Outline {
  /** Keys pressed in each loop, waits included, oldest loop first. */
  readonly loops: readonly number[];
  readonly jumps: number;
  readonly shifts: number;
  /** Keys a clone loses in the last loop: above zero, the level plays on divergence. */
  readonly lostKeys: number;
}

export function outlineOf(level: Level): Outline | null {
  if (level.solution === null) return null;
  const script = parseScript(level.solution);
  if (!script.ok) return null;

  const loops: number[] = [0];
  let jumps = 0;
  let shifts = 0;
  let state: GameState = newGame(level);
  for (const command of script.value) {
    const before = playerOf(state.world);
    state = reduce(state, command);
    if (command.type === 'rewind') loops.push(0);
    if (command.type !== 'input') continue;
    loops[loops.length - 1] = (loops[loops.length - 1] ?? 0) + 1;
    const after = playerOf(state.world);
    if (after.dim !== before.dim) shifts++;
    else if (command.input.kind === 'move' && command.input.dir === 'up' && before.dim === 2 && after.pos.y > before.pos.y) jumps++;
  }
  const lostKeys = tapesOf(state.session)
    .filter((tape) => tape.role === 'clone')
    .reduce((sum, tape) => sum + tape.keys.filter((key) => key.lost).length, 0);
  return { loops, jumps, shifts, lostKeys };
}
