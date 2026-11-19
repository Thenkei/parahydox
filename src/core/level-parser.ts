import { cellIndex, inBounds, sameCell, vec } from './grid';
import { type Result, err, ok } from './result';
import type { Cell, Channel, Level, Size, Vec3, Wire } from './types';

/**
 * Level text format: a header of `key: value` lines, then one ASCII layer per z value.
 * Rows are written top to bottom, so the last row of a layer is y = 0.
 *
 *   ; a comment
 *   name: Le croisement
 *   world: 4
 *   clones: 1
 *   glyph: ! = wire + door a
 *
 *   z=0
 *   ...........
 *   @^*==!==*.X
 *   ###.....###
 *
 * Built-in glyphs:
 *   .  empty        #  block         @  player start    X  exit
 *   *  wire anchor  =  wire          ^  3D threshold    o  crate
 *   a–d  plate      A–D  door held open by the plate of the same letter
 *   e–h  lever      E–H  door switched by the lever of the same letter
 *   ~  fragile block (crumbles once a character has walked off it)
 *
 * `glyph:` declares an extra character for a cell that carries several features at once
 * (block, start, exit, anchor, wire, threshold, crate, fragile, plate x, door x, lever x,
 * and gate x: a door that is open by default and shuts while its channel is live).
 *
 * Other headers: world, tip, hint, clones, mirror (clones replay left as right), and tape
 * (the intended run, in the notation of src/flow/tape.ts).
 */

export interface LevelError {
  /** 1-based line in the source text, when the problem can be pinned to one. */
  readonly line: number | null;
  readonly message: string;
}

type Feature =
  | { readonly kind: 'block' | 'start' | 'exit' | 'anchor' | 'wire' | 'threshold' | 'crate' | 'fragile' }
  | { readonly kind: 'plate' | 'door' | 'gate' | 'lever'; readonly channel: Channel };

const MAX_CLONES = 3;
const CHANNELS = ['a', 'b', 'c', 'd'] as const;
const LEVER_CHANNELS = ['e', 'f', 'g', 'h'] as const;

const BUILTIN_GLYPHS: ReadonlyMap<string, readonly Feature[]> = new Map<string, readonly Feature[]>([
  ['.', []],
  ['#', [{ kind: 'block' }]],
  ['@', [{ kind: 'start' }]],
  ['X', [{ kind: 'exit' }]],
  ['*', [{ kind: 'anchor' }]],
  ['=', [{ kind: 'wire' }]],
  ['^', [{ kind: 'threshold' }]],
  ['o', [{ kind: 'crate' }]],
  ['~', [{ kind: 'fragile' }]],
  ...LEVER_CHANNELS.map((c): [string, readonly Feature[]] => [c, [{ kind: 'lever', channel: c }]]),
  ...LEVER_CHANNELS.map((c): [string, readonly Feature[]] => [c.toUpperCase(), [{ kind: 'door', channel: c }]]),
  ...CHANNELS.map((c): [string, readonly Feature[]] => [c, [{ kind: 'plate', channel: c }]]),
  ...CHANNELS.map((c): [string, readonly Feature[]] => [c.toUpperCase(), [{ kind: 'door', channel: c }]]),
]);

interface Layer {
  readonly z: number;
  readonly line: number;
  readonly rows: { readonly text: string; readonly line: number }[];
}

interface Draft {
  solid: boolean;
  exit: boolean;
  threshold: boolean;
  anchor: boolean;
  wire: boolean;
  plate: Channel | null;
  door: Channel | null;
  inverted: boolean;
  lever: Channel | null;
  fragile: boolean;
}

const emptyDraft = (): Draft => ({
  solid: false,
  exit: false,
  threshold: false,
  anchor: false,
  wire: false,
  plate: null,
  door: null,
  inverted: false,
  lever: null,
  fragile: false,
});

export function parseLevel(source: string): Result<Level, readonly LevelError[]> {
  const errors: LevelError[] = [];
  const fail = (line: number | null, message: string) => errors.push({ line, message });

  let name: string | null = null;
  let maxClones = 0;
  let world = 1;
  let tip: string | null = null;
  let hint: string | null = null;
  let mirror = false;
  let tape: string | null = null;
  const glyphs = new Map(BUILTIN_GLYPHS);
  const layers: Layer[] = [];
  let current: Layer | null = null;

  for (const [i, raw] of source.split(/\r?\n/).entries()) {
    const line = i + 1;
    const text = raw.trim();
    if (text === '' || text.startsWith(';')) continue;

    const layerHeader = /^z\s*=\s*(\d+)$/.exec(text);
    if (layerHeader) {
      current = { z: Number(layerHeader[1]), line, rows: [] };
      layers.push(current);
      continue;
    }
    if (current !== null) {
      current.rows.push({ text, line });
      continue;
    }

    const header = /^(\w+)\s*:\s*(.*)$/.exec(text);
    if (!header) {
      fail(line, `Expected "key: value" or a "z=<n>" layer, got "${text}"`);
      continue;
    }
    const [, key, value = ''] = header;
    switch (key) {
      case 'name':
        name = value.trim();
        break;
      case 'clones': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > MAX_CLONES) {
          fail(line, `clones must be an integer between 0 and ${MAX_CLONES}`);
        } else {
          maxClones = n;
        }
        break;
      }
      case 'tape':
        tape = value.trim() || null;
        break;
      case 'mirror':
        if (value.trim() !== 'true' && value.trim() !== 'false') fail(line, 'mirror must be true or false');
        else mirror = value.trim() === 'true';
        break;
      case 'hint':
        hint = value.trim() || null;
        break;
      case 'tip':
        tip = value.trim() || null;
        break;
      case 'world': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) fail(line, 'world must be a positive integer');
        else world = n;
        break;
      }
      case 'glyph': {
        const parsed = parseGlyph(value);
        if (!parsed.ok) fail(line, parsed.error);
        else if (glyphs.has(parsed.value.char)) fail(line, `Glyph "${parsed.value.char}" is already defined`);
        else glyphs.set(parsed.value.char, parsed.value.features);
        break;
      }
      default:
        fail(line, `Unknown header "${key}"`);
    }
  }

  if (name === null || name === '') fail(null, 'Missing "name:" header');
  if (layers.length === 0) {
    fail(null, 'A level needs at least one "z=<n>" layer');
    return err(errors);
  }

  // Layers must be z = 0..d-1 exactly once each, and all the same shape.
  const byZ = [...layers].sort((a, b) => a.z - b.z);
  byZ.forEach((layer, i) => {
    if (layer.z !== i) fail(layer.line, `Layers must be numbered z=0..${layers.length - 1} without gaps or repeats`);
  });
  const first = byZ[0];
  const size: Size = { w: first?.rows[0]?.text.length ?? 0, h: first?.rows.length ?? 0, d: byZ.length };
  if (size.w === 0 || size.h === 0) fail(first?.line ?? null, 'A layer cannot be empty');
  for (const layer of byZ) {
    if (layer.rows.length !== size.h) fail(layer.line, `Layer z=${layer.z} has ${layer.rows.length} rows, expected ${size.h}`);
    for (const row of layer.rows) {
      if (row.text.length !== size.w) fail(row.line, `Row is ${row.text.length} wide, expected ${size.w}`);
    }
  }
  if (errors.length > 0) return err(errors);

  const drafts: Draft[] = Array.from({ length: size.w * size.h * size.d }, emptyDraft);
  const starts: Vec3[] = [];
  const crates: Vec3[] = [];
  const plates = new Map<Channel, Vec3[]>();
  const levers = new Set<Channel>();
  let exits = 0;

  for (const layer of byZ) {
    layer.rows.forEach((row, rowIndex) => {
      [...row.text].forEach((char, x) => {
        const features = glyphs.get(char);
        if (features === undefined) return void fail(row.line, `Unknown glyph "${char}" at column ${x + 1}`);
        const pos = vec(x, size.h - 1 - rowIndex, layer.z);
        const draft = drafts[cellIndex(size, pos)];
        if (!draft) return;
        for (const feature of features) {
          switch (feature.kind) {
            case 'block':
              draft.solid = true;
              break;
            case 'start':
              starts.push(pos);
              break;
            case 'exit':
              draft.exit = true;
              exits++;
              break;
            case 'anchor':
              draft.anchor = true;
              draft.wire = true;
              break;
            case 'wire':
              draft.wire = true;
              break;
            case 'threshold':
              draft.threshold = true;
              break;
            case 'crate':
              crates.push(pos);
              break;
            case 'plate':
              draft.plate = feature.channel;
              plates.set(feature.channel, [...(plates.get(feature.channel) ?? []), pos]);
              break;
            case 'door':
              draft.door = feature.channel;
              break;
            case 'gate':
              draft.door = feature.channel;
              draft.inverted = true;
              break;
            case 'lever':
              draft.lever = feature.channel;
              levers.add(feature.channel);
              break;
            case 'fragile':
              draft.solid = true;
              draft.fragile = true;
              break;
          }
        }
        if (draft.solid && features.length > 1) fail(row.line, `Glyph "${char}": a block cannot carry other features`);
        if (draft.anchor && draft.threshold) fail(row.line, `Glyph "${char}": a cell cannot be both an anchor and a threshold`);
      });
    });
  }

  if (starts.length !== 1) fail(null, `Expected exactly one player start, found ${starts.length}`);
  if (exits === 0) fail(null, 'A level needs at least one exit');
  drafts.forEach((draft) => {
    if (draft.door !== null && !plates.has(draft.door) && !levers.has(draft.door)) {
      fail(null, `Door "${draft.door.toUpperCase()}" has no plate or lever "${draft.door}"`);
    }
  });

  const traced = traceWires(size, drafts);
  if (!traced.ok) errors.push(...traced.error);

  const start = starts[0];
  if (errors.length > 0 || !traced.ok || !start || name === null) return err(errors);

  const wireRefs = new Map<number, { wire: number; index: number }>();
  for (const wire of traced.value) {
    wire.cells.forEach((p, index) => wireRefs.set(cellIndex(size, p), { wire: wire.id, index }));
  }
  const cells: Cell[] = drafts.map((draft, i) => ({
    solid: draft.solid,
    exit: draft.exit,
    threshold: draft.threshold,
    anchor: draft.anchor,
    plate: draft.plate,
    door: draft.door,
    inverted: draft.inverted,
    lever: draft.lever,
    fragile: draft.fragile,
    wire: wireRefs.get(i) ?? null,
  }));

  return ok({ name, world, tip, hint, maxClones, mirror, tape, size, cells, start, crates, wires: traced.value, plates });
}

function parseGlyph(value: string): Result<{ char: string; features: readonly Feature[] }, string> {
  const match = /^(\S)\s*=\s*(.+)$/.exec(value.trim());
  if (!match) return err('Expected "glyph: <char> = <feature> + <feature>"');
  const [, char = '', list = ''] = match;
  const features: Feature[] = [];
  for (const token of list.split('+').map((t) => t.trim())) {
    const [kind, channel] = token.split(/\s+/);
    switch (kind) {
      case 'block':
      case 'start':
      case 'exit':
      case 'anchor':
      case 'wire':
      case 'threshold':
      case 'crate':
        if (channel !== undefined) return err(`Feature "${kind}" takes no argument`);
        features.push({ kind });
        break;
      case 'fragile':
        if (channel !== undefined) return err('Feature "fragile" takes no argument');
        features.push({ kind });
        break;
      case 'plate':
      case 'door':
      case 'gate':
      case 'lever':
        if (channel === undefined || !/^[a-z]$/.test(channel)) return err(`Feature "${kind}" needs a channel letter, e.g. "${kind} a"`);
        features.push({ kind, channel });
        break;
      default:
        return err(`Unknown feature "${token}"`);
    }
  }
  return ok({ char, features });
}

const NEIGHBOURS: readonly Vec3[] = [vec(1, 0, 0), vec(-1, 0, 0), vec(0, 1, 0), vec(0, -1, 0), vec(0, 0, 1), vec(0, 0, -1)];

/**
 * Follows each wire from anchor to anchor. A wire is a simple path: it cannot branch,
 * loop, or dangle, and it may leave its plane (neighbours are searched along z too).
 */
function traceWires(size: Size, drafts: readonly Draft[]): Result<Wire[], LevelError[]> {
  const errors: LevelError[] = [];
  const at = (p: Vec3): Draft | null => (inBounds(size, p) ? (drafts[cellIndex(size, p)] ?? null) : null);
  const describe = (p: Vec3) => `(x=${p.x}, y=${p.y}, z=${p.z})`;
  const wireNeighbours = (p: Vec3): Vec3[] =>
    NEIGHBOURS.map((d) => vec(p.x + d.x, p.y + d.y, p.z + d.z)).filter((n) => at(n)?.wire === true);

  const anchors: Vec3[] = [];
  const wireCells: Vec3[] = [];
  for (let z = 0; z < size.d; z++) {
    for (let y = 0; y < size.h; y++) {
      for (let x = 0; x < size.w; x++) {
        const p = vec(x, y, z);
        const draft = at(p);
        if (draft?.wire) wireCells.push(p);
        if (draft?.anchor) anchors.push(p);
      }
    }
  }

  const claimed = new Set<number>();
  const wires: Wire[] = [];
  for (const anchor of anchors) {
    if (claimed.has(cellIndex(size, anchor))) continue;
    const path: Vec3[] = [anchor];
    let previous: Vec3 | null = null;
    let cursor = anchor;
    let complete = false;
    while (!complete) {
      const onward = wireNeighbours(cursor).filter((n) => previous === null || !sameCell(n, previous));
      const next = onward[0];
      if (onward.length !== 1 || next === undefined) {
        errors.push({
          line: null,
          message:
            onward.length === 0
              ? `Wire from anchor ${describe(anchor)} stops at ${describe(cursor)} without reaching a second anchor`
              : `Wire branches at ${describe(cursor)}; keep separate wires at least one cell apart`,
        });
        break;
      }
      if (path.some((p) => sameCell(p, next))) {
        errors.push({ line: null, message: `Wire from anchor ${describe(anchor)} loops back on itself` });
        break;
      }
      path.push(next);
      previous = cursor;
      cursor = next;
      complete = at(next)?.anchor === true;
    }
    path.forEach((p) => claimed.add(cellIndex(size, p)));
    if (complete) {
      if (wireNeighbours(cursor).length !== 1) {
        errors.push({ line: null, message: `Wire continues past its anchor at ${describe(cursor)}` });
      }
      // Index 0 is the anchor with the smallest (x, z, y), so "right" follows the wire forward.
      const head = path[0];
      const tail = path[path.length - 1];
      const reversed = head !== undefined && tail !== undefined && compareAnchors(tail, head) < 0;
      wires.push({ id: wires.length, cells: reversed ? [...path].reverse() : path });
    }
  }

  for (const p of wireCells) {
    if (!claimed.has(cellIndex(size, p))) errors.push({ line: null, message: `Wire cell ${describe(p)} is not connected to an anchor` });
  }
  return errors.length > 0 ? err(errors) : ok(wires);
}

const compareAnchors = (a: Vec3, b: Vec3): number => a.x - b.x || a.z - b.z || a.y - b.y;

export function formatLevelErrors(label: string, errors: readonly LevelError[]): string {
  const lines = errors.map((e) => `  ${e.line === null ? '' : `line ${e.line}: `}${e.message}`);
  return `Invalid level "${label}":\n${lines.join('\n')}`;
}
