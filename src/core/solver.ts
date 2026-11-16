import { type Session, advance, newSession, replay } from './session';
import { step } from './step';
import type { Input, InputLog, Level, World } from './types';
import { initialWorld, outcomeOf } from './world';

/**
 * Level-design tools. Nothing here runs in the game: these searches prove that a level
 * can be solved, find the shortest way, and catch shortcuts (a solution shorter or
 * simpler than the intended one means the puzzle leaks).
 */
const MOVES: readonly { readonly key: string; readonly input: Input }[] = [
  { key: 'L', input: { kind: 'move', dir: 'left' } },
  { key: 'R', input: { kind: 'move', dir: 'right' } },
  { key: 'U', input: { kind: 'move', dir: 'up' } },
  { key: 'D', input: { kind: 'move', dir: 'down' } },
  { key: 'E', input: { kind: 'shift' } },
];
const WAIT: Input = { kind: 'wait' };

const inputOf = (key: string): Input => MOVES.find((m) => m.key === key)?.input ?? WAIT;
export const logOf = (script: string): InputLog => [...script].map(inputOf);

/** Everything that can differ between two worlds of the same level, except the clock. */
const fingerprint = (world: World): string => {
  const actors = world.actors.map((a) => `${a.status[0]}${a.dim}${a.air}:${a.pos.x},${a.pos.y},${a.pos.z}`).join('/');
  const crates = world.crates.map((c) => `${c.id}:${c.pos.x},${c.pos.y},${c.pos.z}`).join(';');
  return `${actors}|${crates}|${world.toggled.join('')}|${world.broken.join(',')}`;
};

/** Shortest script that wins the level alone, or null if none exists within `maxSteps`. */
export function solveSolo(level: Level, maxSteps = 60): string | null {
  const start = initialWorld(level, 0);
  const seen = new Set([fingerprint(start)]);
  let frontier: { world: World; script: string }[] = [{ world: start, script: '' }];

  for (let depth = 0; depth < maxSteps && frontier.length > 0; depth++) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const move of MOVES) {
        const world = step(node.world, [move.input]);
        const outcome = outcomeOf(world);
        if (outcome === 'won') return node.script + move.key;
        if (outcome === 'fallen') continue;
        const key = fingerprint(world);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ world, script: node.script + move.key });
      }
    }
    frontier = next;
  }
  return null;
}

/** One shortest script to every situation reachable alone: the plain errands a clone can run. */
function errands(level: Level, maxSteps: number): string[] {
  const start = initialWorld(level, 0);
  const seen = new Set([fingerprint(start)]);
  const scripts: string[] = [];
  let frontier: { world: World; script: string }[] = [{ world: start, script: '' }];
  for (let depth = 0; depth < maxSteps && frontier.length > 0; depth++) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const move of MOVES) {
        const world = step(node.world, [move.input]);
        const key = fingerprint(world);
        if (seen.has(key)) continue;
        seen.add(key);
        const script = node.script + move.key;
        scripts.push(script);
        if (outcomeOf(world) === 'playing') next.push({ world, script });
      }
    }
    frontier = next;
  }
  return scripts;
}

/** Shortest last loop that wins given the clones already recorded, or null. */
export function solveLastLoop(level: Level, loops: readonly InputLog[], maxSteps = 40): string | null {
  const session: Session = { ...newSession(level), loops };
  const horizon = Math.max(0, ...loops.map((log) => log.length));
  const start = replay(session);
  // Once every clone has run out of inputs the clock no longer matters.
  const keyOf = (world: World): string => `${Math.min(world.tick, horizon)}#${fingerprint(world)}`;
  const seen = new Set([keyOf(start)]);
  let frontier: { session: Session; world: World; script: string }[] = [{ session, world: start, script: '' }];

  for (let depth = 0; depth < maxSteps && frontier.length > 0; depth++) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      // Waiting comes first so that, between equally short scripts, the one that waits is reported.
      for (const move of [{ key: '.', input: WAIT }, ...MOVES]) {
        // Going through the session keeps this in lock-step with the game, mirror levels included.
        const advanced = advance(node.session, node.world, move.input);
        if (advanced === null) continue;
        const { session: grown, world } = advanced;
        const outcome = outcomeOf(world);
        if (outcome === 'won') return node.script + move.key;
        if (outcome === 'fallen') continue;
        const key = keyOf(world);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ session: grown, world, script: node.script + move.key });
      }
    }
    frontier = next;
  }
  return null;
}

export interface CloneSolution {
  readonly script: string;
  readonly steps: number;
}

/**
 * Looks for a two-loop solution in which the clone runs a plain errand: the shortest way
 * to some situation, optionally after a few waits. It does not explore clones that mime
 * or pause mid-way, so finding nothing here is what a "mime" level should produce.
 */
export function solveWithOneClone(
  level: Level,
  options: { errandSteps?: number; waits?: number; lastLoopSteps?: number } = {},
): CloneSolution | null {
  const { errandSteps = 12, waits = 2, lastLoopSteps = 30 } = options;
  let best: CloneSolution | null = null;
  for (const errand of errands(level, errandSteps)) {
    for (let w = 0; w <= waits; w++) {
      const first = '.'.repeat(w) + errand;
      if (best !== null && first.length >= best.steps) continue;
      const budget = best === null ? lastLoopSteps : Math.min(lastLoopSteps, best.steps - first.length - 1);
      if (budget <= 0) continue;
      const last = solveLastLoop(level, [logOf(first)], budget);
      if (last !== null) best = { script: `${first}|${last}`, steps: first.length + last.length };
    }
  }
  return best;
}

export interface ExactCloneSolution {
  /** The tape to record, then the loop to play beside it. */
  readonly first: string;
  readonly last: string;
  /** Steps of the second loop: the search minimises these. */
  readonly ticks: number;
  /** Joint states visited: a rough measure of how much room the level leaves. */
  readonly explored: number;
}

/**
 * Exhaustive two-loop search. A tape is any sequence of keys the recorder survives, lost
 * keys and waits included, so the search walks both loops at once: at each step it picks
 * the clone's next key and the player's, and keeps the recorder's own world alongside to
 * know when the tape must end (the recorder fell). Unlike `solveWithOneClone`, it finds
 * solutions in which the clone mimes or pauses mid-way; what it returns is the solution
 * with the shortest second loop. Returns null when there is none within `maxTicks`, and
 * 'too large' when the level leaves more room than `maxStates`.
 */
export function solveWithOneCloneExact(level: Level, maxTicks = 40, maxStates = 1_500_000): ExactCloneSolution | 'too large' | null {
  interface Node {
    readonly recorder: World;
    /** The tape is over: the recorder fell, or the search chose to stop recording. */
    readonly ended: boolean;
    readonly session: Session;
    readonly world: World;
    readonly parent: Node | null;
    readonly cloneKey: string;
    readonly playerKey: string;
  }
  const keys = [{ key: '.', input: WAIT }, ...MOVES];
  const base: Session = { ...newSession(level), loops: [[]] };
  const start: Node = { recorder: initialWorld(level, 0), ended: false, session: base, world: replay(base), parent: null, cloneKey: '', playerKey: '' };
  const keyOf = (n: Pick<Node, 'recorder' | 'ended' | 'world'>): string => `${n.ended ? 'x' : fingerprint(n.recorder)}#${fingerprint(n.world)}`;
  const seen = new Set([keyOf(start)]);
  let frontier: Node[] = [start];

  const unwind = (node: Node): ExactCloneSolution => {
    let first = '';
    let last = '';
    for (let at: Node | null = node; at !== null && at.parent !== null; at = at.parent) {
      first = at.cloneKey + first;
      last = at.playerKey + last;
    }
    return { first, last, ticks: last.length, explored: seen.size };
  };

  for (let depth = 0; depth < maxTicks && frontier.length > 0; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      // The clone's options: any key while the tape runs, or nothing more from now on.
      const cloneOptions: { key: string; input: Input | null }[] = node.ended ? [{ key: '', input: null }] : [...keys, { key: '', input: null }];
      for (const clone of cloneOptions) {
        const recorder = clone.input === null ? node.recorder : step(node.recorder, [clone.input]);
        // A recorder that falls (or leaves) ends its tape with that key.
        const ended = clone.input === null || outcomeOf(recorder) !== 'playing';
        const session: Session = clone.input === null ? node.session : { ...node.session, loops: [[...(node.session.loops[0] ?? []), clone.input]] };
        for (const player of keys) {
          const advanced = advance(session, node.world, player.input);
          if (advanced === null) continue;
          const child: Node = { recorder, ended, session: advanced.session, world: advanced.world, parent: node, cloneKey: clone.key, playerKey: player.key };
          const outcome = outcomeOf(advanced.world);
          if (outcome === 'won') return unwind(child);
          if (outcome === 'fallen') continue;
          const key = keyOf(child);
          if (seen.has(key)) continue;
          if (seen.size >= maxStates) return 'too large';
          seen.add(key);
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return null;
}


export interface CheapestCloneSolution {
  readonly first: string;
  readonly last: string;
  /** Keys that ask for something, both loops together: the game's score. Waits are free. */
  readonly actions: number;
  readonly explored: number;
}

/**
 * The same exhaustive two-loop search, minimising the score instead of the clock: waits
 * cost nothing, every other key costs one (a 0-1 breadth-first search). What it returns is
 * the best score a level can be finished with using one clone, which is what three stars
 * should stand for.
 */
export function cheapestWithOneClone(level: Level, maxActions = 60, maxStates = 1_500_000): CheapestCloneSolution | 'too large' | null {
  interface Node {
    readonly recorder: World;
    readonly ended: boolean;
    readonly session: Session;
    readonly world: World;
    readonly parent: Node | null;
    readonly cloneKey: string;
    readonly playerKey: string;
    readonly cost: number;
    readonly won: boolean;
  }
  const keys = [{ key: '.', input: WAIT, cost: 0 }, ...MOVES.map((m) => ({ ...m, cost: 1 }))];
  const base: Session = { ...newSession(level), loops: [[]] };
  const start: Node = { recorder: initialWorld(level, 0), ended: false, session: base, world: replay(base), parent: null, cloneKey: '', playerKey: '', cost: 0, won: false };
  const keyOf = (n: Pick<Node, 'recorder' | 'ended' | 'world'>): string => `${n.ended ? 'x' : fingerprint(n.recorder)}#${fingerprint(n.world)}`;
  const best = new Map<string, number>([[keyOf(start), 0]]);
  // One bucket per cost: nodes are expanded in order of score, cheapest first.
  const buckets: Node[][] = [[start]];

  for (let cost = 0; cost < buckets.length && cost <= maxActions; cost++) {
    const bucket = buckets[cost] ?? [];
    for (let i = 0; i < bucket.length; i++) {
      const node = bucket[i];
      if (!node) continue;
      if (node.won) {
        let first = '';
        let last = '';
        for (let at: Node | null = node; at !== null && at.parent !== null; at = at.parent) {
          first = at.cloneKey + first;
          last = at.playerKey + last;
        }
        return { first: first.replace(/\.+$/, ''), last, actions: node.cost, explored: best.size };
      }
      if ((best.get(keyOf(node)) ?? Infinity) < node.cost) continue;
      const cloneOptions: { key: string; input: Input | null; cost: number }[] = node.ended ? [{ key: '', input: null, cost: 0 }] : [...keys, { key: '', input: null, cost: 0 }];
      for (const clone of cloneOptions) {
        const recorder = clone.input === null ? node.recorder : step(node.recorder, [clone.input]);
        const ended = clone.input === null || outcomeOf(recorder) !== 'playing';
        const session: Session = clone.input === null ? node.session : { ...node.session, loops: [[...(node.session.loops[0] ?? []), clone.input]] };
        for (const player of keys) {
          const advanced = advance(session, node.world, player.input);
          if (advanced === null) continue;
          const outcome = outcomeOf(advanced.world);
          if (outcome === 'fallen') continue;
          const total = node.cost + clone.cost + player.cost;
          const child: Node = { recorder, ended, session: advanced.session, world: advanced.world, parent: node, cloneKey: clone.key, playerKey: player.key, cost: total, won: outcome === 'won' };
          const key = child.won ? `won#${total}#${best.size}` : keyOf(child);
          if (!child.won) {
            if ((best.get(key) ?? Infinity) <= total) continue;
            if (best.size >= maxStates) return 'too large';
            best.set(key, total);
          }
          (buckets[total] ??= []).push(child);
        }
      }
    }
  }
  return null;
}

const actionsOf = (script: string): number => script.replace(/[.|]/g, '').length;

/**
 * Three-loop audit for levels with two clones: both clones run plain errands (the
 * shortest way to some situation, after zero to `waits` waits; the second errand is
 * searched beside the first clone). Not exhaustive, but it is the family of solutions a
 * player tries first, so the best score it finds must not beat the level's par, and a
 * level meant to need planning should not fall to it cheaply.
 */
export function cheapestWithTwoPlainClones(
  level: Level,
  options: { errandSteps?: number; waits?: number; lastLoopSteps?: number } = {},
): { script: string; actions: number } | null {
  const { errandSteps = 12, waits = 2, lastLoopSteps = 30 } = options;
  let best: { script: string; actions: number } | null = null;

  const secondErrands = (first: InputLog): string[] => {
    const session: Session = { ...newSession(level), loops: [first] };
    const start = replay(session);
    const keyOf = (world: World): string => `${Math.min(world.tick, first.length)}#${fingerprint(world)}`;
    const seen = new Set([keyOf(start)]);
    const scripts: string[] = [];
    let frontier: { session: Session; world: World; script: string }[] = [{ session, world: start, script: '' }];
    for (let depth = 0; depth < errandSteps && frontier.length > 0; depth++) {
      const next: typeof frontier = [];
      for (const node of frontier) {
        for (const move of [{ key: '.', input: WAIT }, ...MOVES]) {
          const advanced = advance(node.session, node.world, move.input);
          if (advanced === null) continue;
          const key = keyOf(advanced.world);
          if (seen.has(key)) continue;
          seen.add(key);
          const script = node.script + move.key;
          if (move.key !== '.') scripts.push(script);
          if (outcomeOf(advanced.world) === 'playing') next.push({ session: advanced.session, world: advanced.world, script });
        }
      }
      frontier = next;
    }
    return scripts;
  };

  for (const errand of errands(level, errandSteps)) {
    for (let w = 0; w <= waits; w++) {
      const first = '.'.repeat(w) + errand;
      if (best !== null && actionsOf(first) >= best.actions) continue;
      for (const second of secondErrands(logOf(first))) {
        const spent = actionsOf(first) + actionsOf(second);
        if (best !== null && spent >= best.actions) continue;
        const last = solveLastLoop(level, [logOf(first), logOf(second)], lastLoopSteps);
        if (last === null) continue;
        const actions = spent + actionsOf(last);
        if (best === null || actions < best.actions) best = { script: `${first}|${second}|${last}`, actions };
      }
    }
  }
  return best;
}
