import { step } from './step';
import type { Input, InputLog, Level, World } from './types';
import { initialWorld, outcomeOf } from './world';

/**
 * A session is nothing but input logs: one per past loop still alive as a clone, plus the
 * loop being played. The world is always derived by replaying them from the initial state,
 * which is why rewind and undo need no dedicated machinery.
 */
export interface Session {
  readonly level: Level;
  /** Clone logs, oldest first. */
  readonly loops: readonly InputLog[];
  readonly current: InputLog;
}

export const newSession = (level: Level): Session => ({ level, loops: [], current: [] });

const MIRRORED: Readonly<Record<string, 'left' | 'right'>> = { left: 'right', right: 'left' };

/** In a mirror level a clone is a reflection: what was pressed left is replayed right. */
export function replayed(session: Session, input: Input | undefined): Input | null {
  if (input === undefined) return null;
  if (!session.level.mirror || input.kind !== 'move') return input;
  return { kind: 'move', dir: MIRRORED[input.dir] ?? input.dir };
}

const inputsAt = (session: Session, tick: number, playerInput: Input): (Input | null)[] => [
  ...session.loops.map((log) => replayed(session, log[tick])),
  playerInput,
];

/** Steps spent in the timeline on screen: every loop still alive, plus the current one. */
export const totalSteps = (session: Session): number =>
  session.loops.reduce((sum, log) => sum + log.length, 0) + session.current.length;

const actions = (log: InputLog): number => log.filter((input) => input.kind !== 'wait' || input.held === true).length;

/**
 * The score of a timeline: every key that asked for something. Waiting is free, so a
 * careful player who pads a loop with waits is not marked down for it. A wait slipped in
 * afterwards with a hold costs one: fixing the timing on the spot is always possible, and
 * three stars go to the loop that was planned right.
 */
export const totalActions = (session: Session): number =>
  session.loops.reduce((sum, log) => sum + actions(log), 0) + actions(session.current);

/** One recorded key as it plays out: what is asked, and whether the world let it happen. */
export interface TapeKey {
  readonly input: Input;
  /** Played already, and it changed nothing: the key was lost. */
  readonly lost: boolean;
}

export interface Tape {
  readonly role: 'clone' | 'player';
  /** For a clone, the keys as it replays them (mirrored in a mirror level). */
  readonly keys: readonly TapeKey[];
  /** How many keys have been played so far in this loop. */
  readonly played: number;
}

/**
 * The input tapes of the current loop: one per clone, then the player's own recording.
 * A key is lost when pressing it made no difference: the step would have left its actor
 * in the same state had it waited instead. Comparing positions is not enough, since a
 * body can be moved by others during the step and still have acted (or not).
 */
export function tapesOf(session: Session): Tape[] {
  const frames = replayFrames(session);
  const now = session.current.length;
  const lostAt = (actor: number, tick: number): boolean => {
    const before = frames[tick];
    const is = frames[tick + 1]?.actors[actor];
    const played = session.current[tick];
    if (!before || !is || !played || before.actors[actor]?.status !== 'active') return false;
    const idle = step(
      before,
      inputsAt(session, tick, played).map((input, index) => (index === actor ? WAIT : input)),
    ).actors[actor];
    if (!idle) return false;
    return idle.status === is.status && idle.dim === is.dim && idle.air === is.air && idle.pos.x === is.pos.x && idle.pos.y === is.pos.y && idle.pos.z === is.pos.z;
  };
  const tape = (role: Tape['role'], actor: number, inputs: readonly Input[]): Tape => ({
    role,
    played: Math.min(now, inputs.length),
    keys: inputs.map((input, tick) => ({ input, lost: tick < now && input.kind !== 'wait' && lostAt(actor, tick) })),
  });
  return [
    ...session.loops.map((log, i) => tape('clone', i, log.map((input) => replayed(session, input) ?? input))),
    tape('player', session.loops.length, session.current),
  ];
}

/** Rebuilds the world from scratch by replaying every log. */
export function replay(session: Session): World {
  return session.current.reduce<World>(
    (world, input, tick) => step(world, inputsAt(session, tick, input)),
    initialWorld(session.level, session.loops.length),
  );
}

/** Every world of the current loop, from step 0 to now: what a rewind plays backwards. */
export function replayFrames(session: Session): World[] {
  const frames = [initialWorld(session.level, session.loops.length)];
  session.current.forEach((input, tick) => {
    const last = frames[frames.length - 1];
    if (last) frames.push(step(last, inputsAt(session, tick, input)));
  });
  return frames;
}

/**
 * Plays one input. Every input costs a step, even one that turns out to be impossible:
 * the player obeys the same rule as the clones. Returns null once the loop is over.
 */
export function advance(session: Session, world: World, input: Input): { session: Session; world: World } | null {
  if (outcomeOf(world) !== 'playing') return null;
  return {
    session: { ...session, current: [...session.current, input] },
    world: step(world, inputsAt(session, world.tick, input)),
  };
}

const WAIT: Input = { kind: 'wait' };
const HELD: Input = { kind: 'wait', held: true };

/**
 * Holds the clones back for one step: a wait is slipped into every tape at the present,
 * and whatever each clone was about to press comes one step later. Nothing that already
 * happened changes, so the world stays as it is. This is what lets a loop be recorded
 * without guessing how long the next one will need: the delay is added when it is known.
 * Returns the same session when no clone has a key left to delay.
 */
export function hold(session: Session): Session {
  const now = session.current.length;
  if (!session.loops.some((log) => log.length > now)) return session;
  return {
    ...session,
    loops: session.loops.map((log) => (log.length > now ? [...log.slice(0, now), HELD, ...log.slice(now)] : log)),
  };
}

/**
 * Resets time to step 0 and turns the loop just played into a clone. Past the level's
 * limit the oldest clone is dropped. Returns the same session when there is nothing to rewind.
 */
export function rewind(session: Session): Session {
  if (session.current.length === 0) return session;
  const max = session.level.maxClones;
  const loops = max === 0 ? [] : [...session.loops, session.current].slice(-max);
  return { ...session, loops, current: [] };
}
