import { type Result, err, ok } from '../core/result';
import type { Level } from '../core/types';
import { type FlowWorld, type FrameInput, IDLE, initialFlow, outcomeOfFlow, stepFlow } from './physics';

/** Ten minutes of play: far beyond any run, small enough to hold in memory. */
const MAX_TAPE_FRAMES = 60 * 600;

/**
 * A run written down: what is held, and for how many frames.
 *
 *   R30      hold right for 30 frames          RJ12   right and jump together
 *   _20      nothing for 20 frames             E1     change dimension
 *   L R      left, right      U D   the up and down arrows      J   the jump key      B   toggle boots (one tap per token)      |   rewind
 *
 * A tape holds keys, not meanings: U jumps in 2D, goes deeper in 3D and follows a wire in 1D.
 *
 * Example: `R40 RJ14 R30 | _20 R90`. Used by the tests to prove a level can be finished,
 * and by the tools to try a level without a keyboard.
 */
export function parseTape(text: string): Result<FrameInput[][], string> {
  const loops: FrameInput[][] = [[]];
  let total = 0;
  for (const token of text.split(/\s+/).filter((t) => t !== '')) {
    if (token === '|') {
      loops.push([]);
      continue;
    }
    const match = /^([LRUDJEB]*|_)(\d+)$/.exec(token);
    if (!match) return err(`Unknown tape token "${token}"`);
    const keys = match[1] ?? '';
    const input: FrameInput = {
      x: keys.includes('R') ? 1 : keys.includes('L') ? -1 : 0,
      z: keys.includes('U') ? 1 : keys.includes('D') ? -1 : 0,
      jump: keys.includes('J'),
      shift: keys.includes('E'),
    };
    // A tape can come from a URL: refuse one long enough to hang the page instead of building it.
    total += Number(match[2]);
    if (total > MAX_TAPE_FRAMES) return err(`Tape longer than ${MAX_TAPE_FRAMES} frames`);
    const current = loops[loops.length - 1];
    for (let i = 0; i < Number(match[2]); i++) current?.push(i === 0 && keys.includes('B') ? { ...input, boots: true } : input);
  }
  return ok(loops);
}

export interface FlowSession {
  readonly level: Level;
  /** Clone tapes, oldest first. */
  readonly loops: readonly (readonly FrameInput[])[];
  readonly current: readonly FrameInput[];
}

export const newFlowSession = (level: Level): FlowSession => ({ level, loops: [], current: [] });

/** What every body presses at this tick; in a mirror level a clone's left is right. */
export function inputsAtFlow(session: FlowSession, tick: number, player: FrameInput): (FrameInput | null)[] {
  const mirrored = (input: FrameInput | undefined): FrameInput | null =>
    input === undefined ? null : session.level.mirror ? { ...input, x: (0 - input.x) as -1 | 0 | 1 } : input;
  return [...session.loops.map((log) => mirrored(log[tick])), player];
}

/** The loop just played becomes a clone; past the level's limit the oldest is dropped. */
export function rewindFlow(session: FlowSession): FlowSession {
  if (session.current.length === 0) return session;
  const max = session.level.maxClones;
  const loops = max === 0 ? [] : [...session.loops, session.current].slice(-max);
  return { ...session, loops, current: [] };
}

/** Plays a whole tape from the start of the level and returns where it ends. */
export function runTape(level: Level, loops: readonly (readonly FrameInput[])[], settle = 0): { world: FlowWorld; session: FlowSession } {
  let session = newFlowSession(level);
  let world = initialFlow(level, 0);
  loops.forEach((frames, index) => {
    if (index > 0) {
      session = rewindFlow(session);
      world = initialFlow(level, session.loops.length);
    }
    const padded = index === loops.length - 1 ? [...frames, ...Array.from({ length: settle }, () => IDLE)] : frames;
    for (const input of padded) {
      if (outcomeOfFlow(world) !== 'playing') break;
      world = stepFlow(world, inputsAtFlow(session, world.tick, input));
      session = { ...session, current: [...session.current, input] };
    }
  });
  return { world, session };
}
