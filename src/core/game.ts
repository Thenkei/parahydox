import { type Session, advance, hold, newSession, replay, rewind } from './session';
import type { Input, Level, World } from './types';

/** Everything a player can ask of a level. */
export type Command =
  | { readonly type: 'input'; readonly input: Input }
  | { readonly type: 'rewind' }
  /** Make every clone wait one step, from now on. */
  | { readonly type: 'hold' }
  | { readonly type: 'undo' }
  | { readonly type: 'restart' };

export interface GameState {
  readonly session: Session;
  readonly world: World;
  /** Earlier sessions, most recent last. Undo crosses rewinds and restarts. */
  readonly history: readonly Session[];
}

const HISTORY_LIMIT = 2000;

export function newGame(level: Level): GameState {
  const session = newSession(level);
  return { session, world: replay(session), history: [] };
}

const commit = (state: GameState, session: Session, world: World): GameState => ({
  session,
  world,
  history: [...state.history, state.session].slice(-HISTORY_LIMIT),
});

/** Pure reducer. Returns the same state object when the command has no effect. */
export function reduce(state: GameState, command: Command): GameState {
  switch (command.type) {
    case 'input': {
      const next = advance(state.session, state.world, command.input);
      return next === null ? state : commit(state, next.session, next.world);
    }
    case 'rewind': {
      const session = rewind(state.session);
      return session === state.session ? state : commit(state, session, replay(session));
    }
    case 'hold': {
      const session = hold(state.session);
      // Only the future of the tapes moved: the world on screen is still the right one.
      return session === state.session ? state : commit(state, session, state.world);
    }
    case 'restart': {
      const { loops, current, level } = state.session;
      if (loops.length === 0 && current.length === 0) return state;
      const session = newSession(level);
      return commit(state, session, replay(session));
    }
    case 'undo': {
      const session = state.history[state.history.length - 1];
      if (session === undefined) return state;
      return { session, world: replay(session), history: state.history.slice(0, -1) };
    }
  }
}
