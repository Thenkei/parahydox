/**
 * The static side of the domain: a level is one immutable 3D grid, and the three
 * "dimensions" are three ways of moving through that same data (see src/flow/physics.ts).
 *
 * Axes: x runs left → right, y runs bottom → top (gravity pulls toward y = 0, except on
 * the clones of an antipode level), z runs from the front plane toward the back.
 */

export type Dim = 1 | 2 | 3;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

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
  /** A solid block with no grip: whoever has stood on it neither starts nor stops quickly. */
  readonly ice: boolean;
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
  /** How many past loops can coexist with the player. */
  readonly maxClones: number;
  /** Clones are reflections: they replay left as right and right as left. */
  readonly mirror: boolean;
  /** Clones are antipodes: they fall upward and walk the ceilings. */
  readonly antipode: boolean;
  /** Axes along which the grid has no edge: what leaves by one side arrives by the other. Depth never wraps. */
  readonly wrap: { readonly x: boolean; readonly y: boolean };
  /** The intended run in tape notation (see src/flow/tape.ts): proof that the level can be finished, and the time to beat. */
  readonly tape: string | null;
  readonly size: Size;
  /** Flat array, see `cellIndex`. */
  readonly cells: readonly Cell[];
  readonly start: Vec3;
  readonly crates: readonly Vec3[];
  readonly wires: readonly Wire[];
  readonly plates: ReadonlyMap<Channel, readonly Vec3[]>;
}
