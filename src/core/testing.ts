import { type GameState, newGame, reduce } from './game';
import { formatLevelErrors, parseLevel } from './level-parser';
import { parseScript } from './script';
import type { Actor, Level } from './types';

/** Test helpers: build a level from text and drive it with the script notation. */

export function levelFrom(source: string): Level {
  const parsed = parseLevel(source);
  if (!parsed.ok) throw new Error(formatLevelErrors('test', parsed.error));
  return parsed.value;
}

export function play(level: Level, script: string, from: GameState = newGame(level)): GameState {
  const commands = parseScript(script);
  if (!commands.ok) throw new Error(commands.error);
  return commands.value.reduce(reduce, from);
}

export function cloneOf(state: GameState, index = 0): Actor {
  const clone = state.world.actors[index];
  if (!clone || clone.role !== 'clone') throw new Error(`No clone at index ${index}`);
  return clone;
}
