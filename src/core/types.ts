/**
 * Domain model. Everything here is immutable data: the world is one 3D grid plus a list
 * of bodies, and the three "dimensions" are three ways of reading that same data.
 *
 * Axes: x runs left → right, y runs bottom → top (gravity pulls toward y = 0),
 * z runs from the front plane toward the back.
 */

export type Dim = 1 | 2 | 3;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Screen-relative directions. What they mean in the world depends on the actor's dimension. */
export type Dir = 'left' | 'right' | 'up' | 'down';

export type Input =
  | { readonly kind: 'move'; readonly dir: Dir }
  /** `held` marks a wait slipped into a clone's tape afterwards, when the player held the clones back. */
  | { readonly kind: 'wait'; readonly held?: boolean }
  /** Change dimension on an anchor (2D ↔ 1D) or a threshold (2D ↔ 3D). */
  | { readonly kind: 'shift' };

/** One loop: the inputs of a single run, indexed by step. */
export type InputLog = readonly Input[];

/** Links plates to doors: plate `a` drives door `a`. */
export type Channel = string;

export interface WireRef {
  readonly wire: number;
  /** Position along the wire, 0 being its first anchor. */
  readonly index: number;
}

export interface Cell {
  readonly solid: boolean;
  readonly exit: boolean;
  /** 2D ↔ 3D transition tile. */
  readonly threshold: boolean;
  /** 2D ↔ 1D transition tile; always the end of a wire. */
  readonly anchor: boolean;
  readonly plate: Channel | null;
  readonly door: Channel | null;
  /** An inverted door (a "gate"): open by default, shut while its channel is live. */
  readonly inverted: boolean;
  /** Toggles its channel each time a character steps onto it; the state then stays. */
  readonly lever: Channel | null;
  /** A solid block that crumbles once a character who stood on it has walked away. */
  readonly fragile: boolean;
  readonly wire: WireRef | null;
}

export interface Size {
  readonly w: number;
  readonly h: number;
  readonly d: number;
}

export interface Wire {
  readonly id: number;
  /** Ordered path through the grid, an anchor at each end. */
  readonly cells: readonly Vec3[];
}

export interface Level {
  readonly name: string;
  /** 1-based chapter the level belongs to; drives scenery and grouping, never the rules. */
  readonly world: number;
  /** One line shown when the level opens; null for none. */
  readonly tip: string | null;
  /** A stronger nudge, shown only when the player asks for it; null for none. */
  readonly hint: string | null;
  /** Actions of the intended solution, all loops included, waits excluded: the bar for a perfect score. */
  readonly par: number | null;
  /** The intended solution in script notation, kept with the level so tests can replay it. */
  readonly solution: string | null;
  /** How many past loops can coexist with the player. */
  readonly maxClones: number;
  /** Clones are reflections: they replay left as right and right as left. */
  readonly mirror: boolean;
  /** Played with continuous movement (src/flow) instead of one cell per key. */
  readonly flow: boolean;
  /** For a flow level, the intended run in tape notation (see src/flow/tape.ts). */
  readonly tape: string | null;
  readonly size: Size;
  /** Flat array, see `cellIndex`. */
  readonly cells: readonly Cell[];
  readonly start: Vec3;
  readonly crates: readonly Vec3[];
  readonly wires: readonly Wire[];
  readonly plates: ReadonlyMap<Channel, readonly Vec3[]>;
}

export type ActorStatus = 'active' | 'fallen' | 'exited';

export interface Actor {
  readonly id: number;
  readonly role: 'player' | 'clone';
  readonly pos: Vec3;
  readonly dim: Dim;
  readonly status: ActorStatus;
  /** Moves left in the air after a jump; 0 when on the ground. Gravity waits while it lasts. */
  readonly air: number;
}

export interface Crate {
  readonly id: number;
  readonly pos: Vec3;
}

export interface World {
  readonly level: Level;
  /** Step counter of the current loop. */
  readonly tick: number;
  /** Clones from oldest to newest, then the player. This is also the acting order. */
  readonly actors: readonly Actor[];
  readonly crates: readonly Crate[];
  /** Channels switched on by levers, sorted. */
  readonly toggled: readonly Channel[];
  /** Cell indices of fragile blocks that have crumbled, sorted. */
  readonly broken: readonly number[];
}

export type Outcome = 'playing' | 'won' | 'fallen';
