import type { Level } from '../core/types';
import { type FlowWorld, type FrameInput, initialFlow, outcomeOfFlow, playerOfFlow, stepFlow, transitionAt } from './physics';
import { inputsAtFlow } from './tape';

/**
 * A design tool, not a rule: looks for a run that reaches a goal, by trying every way of
 * holding the keys a few frames at a time and forgetting the ways that end up in the same
 * place. It answers two questions about a level: "can it be finished like this?" (and
 * with which keys), and "can it be finished without what it is meant to require?".
 *
 * Positions and speeds are rounded to tell states apart, so "not found" means "not at this
 * resolution": good evidence that a shortcut does not exist, not a proof.
 */
export interface SearchOptions {
  /** Past loops replayed as clones, oldest first. */
  readonly clones?: readonly (readonly FrameInput[])[];
  /** The beginning of the run, already decided: the search continues from where it ends. */
  readonly prefix?: readonly FrameInput[];
  /** Frames each decision is held for. */
  readonly chunk?: number;
  /** Longest run considered, in frames. */
  readonly maxFrames?: number;
  /** Give up after visiting this many distinct states. */
  readonly maxStates?: number;
  /** Never unfold the depth: for a loop known to stay in its slice, in a level where the volume would drown the search. */
  readonly flat?: boolean;
  /** Tell states apart twice as finely: slower, for a jump that needs precision. */
  readonly fine?: boolean;
  /** What counts as arriving; the exit by default. */
  readonly goal?: (world: FlowWorld) => boolean;
}

export interface SearchResult {
  readonly found: boolean;
  /** The run found, in tape notation. */
  readonly tape: string | null;
  readonly frames: number;
  readonly states: number;
  /** True when every reachable state was visited: the goal is out of reach, not just far. */
  readonly exhausted: boolean;
}

interface Node {
  readonly world: FlowWorld;
  readonly parent: Node | null;
  readonly input: FrameInput | null;
}

const q = (value: number, step: number): number => Math.round(value / step);

function keyOf(world: FlowWorld, timed: boolean, grain: number): string {
  const parts: (string | number)[] = [timed ? world.tick : 0];
  for (const b of world.bodies) {
    if (b.status !== 'active') {
      parts.push(b.status);
      continue;
    }
    const mine = b.role === 'player';
    // The volume has two more axes to get lost in: tell its states apart more coarsely.
    const wide = b.dim === 3 ? 1.5 : 1;
    const fine = (mine ? 0.2 : 0.3) * grain * wide;
    parts.push(b.dim, q(b.x, fine), q(b.y, fine), q(b.z, b.dim === 3 ? fine : 0.5));
    if (b.wire !== null) parts.push(b.wire.id, q(b.wire.s, 0.25));
    if (mine) parts.push(q(b.vx, 2.6 * grain * wide), q(b.vy, 3.5 * grain * wide), q(b.vz, 2.6 * grain * wide), b.grounded ? 1 : 0, b.jumpHeld ? 1 : 0, !b.grounded && b.coyote > 0 ? 1 : 0);
  }
  for (const c of world.crates) parts.push(q(c.x, 0.3 * grain), q(c.y, 0.3 * grain), q(c.z, 0.3 * grain));
  parts.push(world.toggled.join(''), world.broken.join('.'));
  return parts.join(',');
}

const KEYS = (input: FrameInput): string =>
  `${input.x > 0 ? 'R' : input.x < 0 ? 'L' : ''}${input.z > 0 ? 'U' : input.z < 0 ? 'D' : ''}${input.jump ? 'J' : ''}${input.shift ? 'E' : ''}` || '_';

/** A list of inputs, one per frame, written as a tape. */
export function formatTape(frames: readonly FrameInput[]): string {
  const tokens: string[] = [];
  let run = 0;
  let last = '';
  for (const input of frames) {
    const keys = KEYS(input);
    if (keys === last) {
      run++;
      continue;
    }
    if (run > 0) tokens.push(`${last}${run}`);
    last = keys;
    run = 1;
  }
  if (run > 0) tokens.push(`${last}${run}`);
  return tokens.join(' ');
}

/** What can be held from here: the arrows that mean something in this dimension, jump, and E where it acts. */
function choices(world: FlowWorld, flat: boolean): FrameInput[] {
  const hero = playerOfFlow(world);
  const list: FrameInput[] = [];
  const axis = [0, 1, -1] as const;
  if (hero.dim === 2) {
    for (const x of axis) for (const jump of [false, true]) list.push({ x, z: 0, jump, shift: false });
  } else if (hero.dim === 3) {
    for (const x of axis) for (const z of axis) for (const jump of [false, true]) list.push({ x, z, jump, shift: false });
  } else {
    for (const x of axis) list.push({ x, z: 0, jump: false, shift: false });
    for (const z of [1, -1] as const) list.push({ x: 0, z, jump: false, shift: false });
  }
  const transition = transitionAt(world.level, hero);
  if (transition !== null && !(flat && transition === 'unfold') && !hero.shiftHeld) list.push({ x: 0, z: 0, jump: false, shift: true });
  return list;
}

export function searchRun(level: Level, options: SearchOptions = {}): SearchResult {
  const clones = options.clones ?? [];
  const chunk = options.chunk ?? 6;
  const maxFrames = options.maxFrames ?? 60 * 40;
  const maxStates = options.maxStates ?? 600_000;
  const goal = options.goal ?? ((world: FlowWorld): boolean => outcomeOfFlow(world) === 'won');
  const session = { level, loops: clones, current: [] };
  // With clones the world changes by itself: the same place at another time is another state.
  const timed = clones.length > 0;
  const grain = options.fine ? 0.5 : 1;

  const prefix = options.prefix ?? [];
  let opening = initialFlow(level, clones.length);
  for (const input of prefix) opening = stepFlow(opening, inputsAtFlow(session, opening.tick, input));
  const root: Node = { world: opening, parent: null, input: null };
  if (goal(opening)) return { found: true, tape: formatTape(prefix), frames: opening.tick, states: 1, exhausted: false };
  const seen = new Set<string>([keyOf(root.world, timed, grain)]);
  let frontier: Node[] = [root];
  let capped = false;

  const tapeOf = (node: Node, extra: number): string => {
    const inputs: FrameInput[] = [];
    for (let at: Node | null = node; at !== null && at.input !== null; at = at.parent) inputs.push(at.input);
    inputs.reverse();
    // Written as it was played: E is tapped on the first frame of its chunk, not held through it.
    const frames = inputs.flatMap((input, i) =>
      Array.from({ length: i === inputs.length - 1 ? extra : chunk }, (_, f) => (input.shift && f > 0 ? { ...input, shift: false } : input)),
    );
    return formatTape([...prefix, ...frames]);
  };

  while (frontier.length > 0) {
    const next: Node[] = [];
    for (const node of frontier) {
      if (node.world.tick >= maxFrames) {
        capped = true;
        continue;
      }
      for (const input of choices(node.world, options.flat ?? false)) {
        let world = node.world;
        let reached = -1;
        for (let f = 0; f < chunk; f++) {
          // E is a tap: one frame, then the hands are off.
          const frame = input.shift && f > 0 ? { ...input, shift: false } : input;
          world = stepFlow(world, inputsAtFlow(session, world.tick, frame));
          if (goal(world)) {
            reached = f + 1;
            break;
          }
          if (outcomeOfFlow(world) !== 'playing') break;
        }
        const child: Node = { world, parent: node, input };
        if (reached > 0) return { found: true, tape: tapeOf(child, reached), frames: world.tick, states: seen.size, exhausted: false };
        if (outcomeOfFlow(world) !== 'playing') continue;
        const key = keyOf(world, timed, grain);
        if (seen.has(key)) continue;
        if (seen.size >= maxStates) {
          capped = true;
          continue;
        }
        seen.add(key);
        next.push(child);
      }
    }
    frontier = next;
  }
  return { found: false, tape: null, frames: 0, states: seen.size, exhausted: !capped };
}
