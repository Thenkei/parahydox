import type { Command } from './game';
import { type Result, err, ok } from './result';

/**
 * Compact notation for a play-through, used by tests and by the `?script=` URL parameter
 * to reproduce a situation:
 *
 *   L R U D   move        .   wait        E   change dimension        |  or  /   rewind
 *   T         hold the clones back one step
 *
 * Example, level 3: `RR|RRRRRRRRRR`. Whitespace is ignored.
 */
const COMMANDS: Readonly<Record<string, Command>> = {
  L: { type: 'input', input: { kind: 'move', dir: 'left' } },
  R: { type: 'input', input: { kind: 'move', dir: 'right' } },
  U: { type: 'input', input: { kind: 'move', dir: 'up' } },
  D: { type: 'input', input: { kind: 'move', dir: 'down' } },
  '.': { type: 'input', input: { kind: 'wait' } },
  E: { type: 'input', input: { kind: 'shift' } },
  T: { type: 'hold' },
  '|': { type: 'rewind' },
  '/': { type: 'rewind' },
};

export function parseScript(text: string): Result<Command[], string> {
  const commands: Command[] = [];
  for (const char of text.replace(/\s+/g, '')) {
    const command = COMMANDS[char.toUpperCase()];
    if (command === undefined) return err(`Unknown script character "${char}"`);
    commands.push(command);
  }
  return ok(commands);
}
