import { cellAt, cellIndex, vec } from '../../core/grid';
import type { Cell, Channel, Dim, Level, Vec3 } from '../../core/types';
import type { TileSet } from '../assets';
import { COLORS, type Theme, channelColor } from '../themes';
import { type Camera, DEPTH_X, DEPTH_Y, type Point, layerAlpha, project } from './camera';
import { type CharacterLook, drawCharacter } from './character';
import type { ActorPose, CratePose } from './motion';

/** Static shapes derived once per level. */
export interface LevelGeometry {
  readonly level: Level;
  /** Rows of blocks with nothing beneath them: the hanging rock under each island. */
  readonly bellies: readonly Belly[];
  /** Wire segments, each drawn with the deeper of its two layers. */
  readonly segments: readonly Segment[];
}

interface Belly {
  readonly z: number;
  readonly y: number;
  readonly x0: number;
  readonly length: number;
  /** How far the rock may hang, in cells. */
  readonly reach: number;
}

interface Segment {
  readonly wire: number;
  readonly index: number;
  readonly a: Vec3;
  readonly b: Vec3;
  readonly layer: number;
}

/** The moment being drawn, reduced to what the scene reads: who is where, and what is switched. */
export interface SceneView {
  readonly level: Level;
  readonly hero: { readonly dim: Dim; readonly cell: Vec3 };
  /** Cells of the bodies still standing, by id: a shadow can fall on them. */
  readonly bodies: readonly { readonly id: number; readonly cell: Vec3 }[];
  readonly crates: readonly Vec3[];
  readonly toggled: readonly Channel[];
  /** Channels live right now: a held plate lights up. */
  readonly live: ReadonlySet<Channel>;
  /** Cell indices of the slabs that have crumbled. */
  readonly broken: ReadonlySet<number>;
}

/** Terrain that is still there: a fragile slab stops being solid once it has crumbled. */
function isSolid(view: SceneView, p: Vec3): boolean {
  const cell = cellAt(view.level, p);
  return cell !== null && cell.solid && !(cell.fragile && view.broken.has(cellIndex(view.level.size, p)));
}

export interface SceneFrame {
  readonly ctx: CanvasRenderingContext2D;
  readonly cam: Camera;
  readonly world: SceneView;
  readonly geometry: LevelGeometry;
  readonly tiles: TileSet;
  readonly theme: Theme;
  /** Seconds. */
  readonly time: number;
  readonly actors: readonly ActorPose[];
  readonly crates: readonly CratePose[];
  /** Facing and landing squash are remembered across steps by the stage. */
  readonly lookOf: (pose: ActorPose) => Pick<CharacterLook, 'facing' | 'squash' | 'joy'>;
  /** 0 closed … 1 open, eased by the stage. */
  readonly doorOpen: (cell: number) => number;
}

const hash = (x: number, y: number, z: number): number => {
  let n = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};

export function buildGeometry(level: Level): LevelGeometry {
  const { w, h, d } = level.size;
  // Fragile slabs are thin: they carry no hanging rock, and nothing hangs from what they hold.
  const solid = (x: number, y: number, z: number): boolean => {
    const cell = cellAt(level, vec(x, y, z));
    return cell !== null && cell.solid && !cell.fragile;
  };

  const bellies: Belly[] = [];
  for (let z = 0; z < d; z++) {
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (!(solid(x, y, z) && !solid(x, y - 1, z))) {
          x++;
          continue;
        }
        const x0 = x;
        let room = Infinity;
        while (x < w && solid(x, y, z) && !solid(x, y - 1, z)) {
          // A ledge over a walkable space keeps its rock short; over the void it can hang.
          let free = 0;
          while (y - 1 - free >= 0 && !solid(x, y - 1 - free, z)) free++;
          room = Math.min(room, y - 1 - free < 0 ? Infinity : free);
          x++;
        }
        bellies.push({ z, y, x0, length: x - x0, reach: room === Infinity ? 1.6 : Math.min(0.3, room * 0.3) });
      }
    }
  }

  const segments: Segment[] = level.wires.flatMap((wire) =>
    wire.cells.slice(0, -1).flatMap((a, index) => {
      const b = wire.cells[index + 1];
      return b ? [{ wire: wire.id, index, a, b, layer: Math.max(a.z, b.z) }] : [];
    }),
  );
  return { level, bellies, segments };
}

// ------------------------------------------------------------------------------ scene

export function drawScene(frame: SceneFrame): void {
  const { ctx, cam, world, geometry } = frame;
  const { level } = world;
  const { w, h, d } = level.size;
  const player = { dim: world.hero.dim, pos: world.hero.cell };
  const focusWire = player.dim === 1 ? (cellAt(level, player.pos)?.wire?.wire ?? null) : null;
  const onFocusWire = (p: Vec3): boolean => focusWire !== null && cellAt(level, p)?.wire?.wire === focusWire;

  for (let z = d - 1; z >= 0; z--) {
    const visible = layerAlpha(cam, z);
    if (visible < 0.01) continue;
    // In 1D the world does not vanish: it stays as a ghost, so the wire is still somewhere.
    const alpha = visible * (WORLD_GHOST + (1 - WORLD_GHOST) * cam.world);

    if (alpha > 0.01) {
      ctx.globalAlpha = alpha;
      for (const belly of geometry.bellies) if (belly.z === z) drawBelly(frame, belly);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cell = cellAt(level, vec(x, y, z));
          if (!cell) continue;
          if (cell.solid) {
            // A crumbled slab is simply gone.
            if (!isSolid(world, vec(x, y, z))) continue;
            // Walls standing between the camera and the player turn to glass in 3D.
            const veils = cam.depth > 0.5 && z < player.pos.z && y >= player.pos.y;
            ctx.globalAlpha = veils ? alpha * 0.3 : alpha;
            if (cell.fragile) drawSlab(frame, x, y, z);
            else drawBlock(frame, x, y, z);
          } else {
            // Doors standing in front of the player are veiled like walls, so they never hide it.
            const veils = cell.door !== null && cam.depth > 0.5 && z < player.pos.z;
            ctx.globalAlpha = veils ? alpha * 0.35 : alpha;
            drawFeatures(frame, cell, x, y, z, false);
          }
        }
      }
      ctx.globalAlpha = alpha;
      for (const segment of geometry.segments) if (segment.layer === z) drawWire(frame, segment, false);
    }

    // What sits on the player's wire stays fully there in 1D; the rest fades with the world.
    const bodyAlpha = (cell: Vec3): number => (onFocusWire(cell) ? visible : alpha);
    for (const crate of frame.crates) {
      if (crate.cell.z !== z) continue;
      ctx.globalAlpha = bodyAlpha(crate.cell);
      if (ctx.globalAlpha > 0.01) drawCrate(frame, crate);
    }
    const actors = frame.actors.filter((a) => a.cell.z === z).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const pose of actors) {
      // Clones stay readable from a wire: where they are is the whole point of a timeline.
      ctx.globalAlpha = onFocusWire(pose.cell) ? visible : visible * (ACTOR_GHOST + (1 - ACTOR_GHOST) * cam.world);
      if (ctx.globalAlpha > 0.01) drawActor(frame, pose);
    }
  }

  // 1D: only the wire exists. Redraw it, and what it carries, over the faded world.
  if (focusWire !== null && cam.world < 0.99) {
    ctx.globalAlpha = 1 - cam.world;
    for (const segment of geometry.segments) if (segment.wire === focusWire) drawWire(frame, segment, true);
    for (const p of level.wires[focusWire]?.cells ?? []) {
      const cell = cellAt(level, p);
      if (cell) drawFeatures(frame, cell, p.x, p.y, p.z, true);
    }
  }

  // 3D: the hero is drawn once more over everything, faintly, so that a crate or a wall
  // standing in front never hides where it is.
  const hero = frame.actors.find((a) => a.role === 'player');
  if (hero && cam.depth > 0.5 && hero.alpha > 0.5) {
    ctx.globalAlpha = 0.3 * cam.depth;
    drawActor(frame, hero);
  }
  ctx.globalAlpha = 1;
}

/** How much of the world is left on screen from inside a wire. */
const WORLD_GHOST = 0.2;
const ACTOR_GHOST = 0.6;

// ----------------------------------------------------------------------------- blocks

function texturedQuad(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, o: Point, ux: number, uy: number, vx: number, vy: number): void {
  const s = image.width;
  ctx.save();
  ctx.transform(ux / s, uy / s, vx / s, vy / s, o.x, o.y);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function drawBlock(frame: SceneFrame, x: number, y: number, z: number): void {
  const { ctx, cam, tiles, theme, world } = frame;
  const { level } = world;
  const c = cam.cell;
  const solid = (dx: number, dy: number, dz: number): boolean => {
    const at = vec(x + dx, y + dy, z + dz);
    // Slabs do not hide their neighbours' faces: they are thinner than a block.
    return isSolid(world, at) && !cellAt(level, at)?.fragile;
  };
  const variant = Math.floor(hash(x, y, z) * tiles.stone.length);
  const open = cam.depth > 0.02;
  const dxp = cam.depth * DEPTH_X * c;
  const dyp = cam.depth * DEPTH_Y * c;
  const top = project(cam, x, y + 1, z);
  const topExposed = !solid(0, 1, 0);

  if (open && topExposed) {
    const back = project(cam, x, y + 1, z + 1);
    texturedQuad(ctx, tiles.grass, back, c + 0.6, 0, top.x - back.x, top.y - back.y);
    // A faint edge per tile: in 3D the ground must be countable.
    ctx.strokeStyle = 'rgba(20, 16, 30, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    segmentPath(ctx, back.x, back.y, top.x, top.y);
    segmentPath(ctx, back.x, back.y, back.x + c, back.y);
    ctx.stroke();
  }
  if (open && !solid(1, 0, 0)) {
    const side = tiles.stoneSide[variant] ?? tiles.grass;
    texturedQuad(ctx, side, { x: top.x + c, y: top.y }, dxp, -dyp, 0, c + 0.6);
  }

  const face = tiles.stone[variant] ?? tiles.grass;
  ctx.drawImage(face, top.x, top.y, c + 0.6, c + 0.6);

  // Distance haze: layers further back sink into the colour of the air.
  const haze = Math.min(0.4, 0.1 * (z - cam.zRef) * cam.depth);
  if (haze > 0.01) {
    const saved = ctx.globalAlpha;
    ctx.globalAlpha = saved * haze;
    ctx.fillStyle = theme.haze;
    ctx.fillRect(top.x, top.y, c + 0.6, c + 0.6);
    ctx.globalAlpha = saved;
  }

  // Outline the silhouette so terrain reads against a painted sky.
  ctx.strokeStyle = 'rgba(20, 16, 30, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (!solid(-1, 0, 0)) segmentPath(ctx, top.x, top.y, top.x, top.y + c);
  if (!solid(1, 0, 0) && !open) segmentPath(ctx, top.x + c, top.y, top.x + c, top.y + c);
  if (!solid(0, -1, 0)) segmentPath(ctx, top.x, top.y + c, top.x + c, top.y + c);
  ctx.stroke();

  if (topExposed) {
    drawGrassFringe(frame, x, y, z, top);
    // Small life on the grass, only where nothing that matters stands, and only along
    // the edge facing the camera so the ground stays readable in 3D.
    const above = cellAt(level, vec(x, y + 1, z));
    const bare = above !== null && !above.exit && !above.anchor && !above.threshold && above.plate === null && above.lever === null && above.door === null;
    if (bare && !(open && solid(0, 0, -1))) drawSprig(frame, x, y, z, top);
  }
}

const PETALS = ['#fff8ea', '#ffd95a', '#ff9fc0'] as const;

/** A flower, a mushroom or a pebble on some blocks: decoration, picked by position. */
function drawSprig(frame: SceneFrame, x: number, y: number, z: number, top: Point): void {
  const { ctx, cam, theme, time } = frame;
  const c = cam.cell;
  const pick = hash(x * 13 + 5, y * 7 + 1, z * 3 + 2);
  if (pick < 0.62) return;
  const at = top.x + c * (0.2 + hash(x, y + 21, z) * 0.6);
  const base = top.y - c * 0.03;

  if (pick < 0.8) {
    const sway = Math.sin(time * 1.4 + x * 1.7) * c * 0.02;
    const height = c * (0.16 + hash(x + 3, y, z) * 0.08);
    ctx.strokeStyle = theme.grassDark;
    ctx.lineWidth = Math.max(1.25, c * 0.022);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(at, base);
    ctx.quadraticCurveTo(at + sway * 0.4, base - height * 0.6, at + sway, base - height);
    ctx.stroke();
    ctx.fillStyle = PETALS[Math.floor(hash(x, y, z + 40) * PETALS.length)] ?? PETALS[0];
    ctx.beginPath();
    ctx.arc(at + sway, base - height, c * 0.045, 0, Math.PI * 2);
    ctx.fill();
  } else if (pick < 0.9) {
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(at - c * 0.018, base - c * 0.09, c * 0.036, c * 0.09);
    ctx.fillStyle = '#ff7a6b';
    ctx.beginPath();
    ctx.arc(at, base - c * 0.09, c * 0.065, Math.PI, 0);
    ctx.fill();
  } else {
    ctx.fillStyle = theme.rockDark;
    ctx.beginPath();
    ctx.ellipse(at, base - c * 0.025, c * 0.07, c * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A fragile slab: a thin, pale, cracked plank where a block would be, so that it reads at
 * a glance as something that will not last.
 */
function drawSlab(frame: SceneFrame, x: number, y: number, z: number): void {
  const { ctx, cam, theme, time } = frame;
  const c = cam.cell;
  const thick = 0.3;
  const top = project(cam, x, y + 1, z);
  const tremble = Math.sin(time * 9 + x * 2.3 + z) * c * 0.006;

  ctx.fillStyle = '#efe3c8';
  if (cam.depth > 0.02) {
    quadPath(ctx, cam, y + 1, x + 0.03, x + 0.97, z, z + 1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 16, 30, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = '#d9c9a6';
  ctx.fillRect(top.x + c * 0.03, top.y + tremble, c * 0.94, c * thick);
  ctx.fillStyle = withAlpha(theme.rockDark, 0.35);
  ctx.fillRect(top.x + c * 0.03, top.y + tremble + c * thick * 0.62, c * 0.94, c * thick * 0.38);
  ctx.strokeStyle = 'rgba(20, 16, 30, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(top.x + c * 0.03, top.y + tremble, c * 0.94, c * thick);

  // Cracks, different on every slab.
  ctx.strokeStyle = 'rgba(20, 16, 30, 0.55)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  const r = hash(x, y + 9, z);
  const cx = top.x + c * (0.3 + r * 0.4);
  ctx.moveTo(cx, top.y + tremble);
  ctx.lineTo(cx + c * 0.06, top.y + tremble + c * thick * 0.45);
  ctx.lineTo(cx - c * 0.05, top.y + tremble + c * thick);
  ctx.moveTo(cx + c * 0.06, top.y + tremble + c * thick * 0.45);
  ctx.lineTo(cx + c * 0.2, top.y + tremble + c * thick * 0.7);
  ctx.stroke();
}

/** Grass spilling over the top edge of a block. */
function drawGrassFringe(frame: SceneFrame, x: number, y: number, z: number, top: Point): void {
  const { ctx, cam, theme } = frame;
  const c = cam.cell;
  const blades = 6;
  ctx.fillStyle = theme.grassDark;
  ctx.beginPath();
  ctx.moveTo(top.x - 1, top.y - c * 0.03);
  ctx.lineTo(top.x + c + 1, top.y - c * 0.03);
  for (let i = blades; i >= 0; i--) {
    const drop = 0.1 + hash(x * 7 + i, y, z) * 0.12;
    ctx.lineTo(top.x + (c * (i + 0.5)) / blades, top.y + c * drop);
    ctx.lineTo(top.x + (c * i) / blades, top.y + c * 0.06);
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = theme.grassLight;
  ctx.fillRect(top.x - 1, top.y - c * 0.05, c + 2, c * 0.09);
  // A few blades standing up, swaying.
  for (let i = 0; i < 3; i++) {
    const r = hash(x, y * 5 + i, z + 3);
    if (r < 0.35) continue;
    const bx = top.x + c * (0.15 + 0.35 * i + r * 0.1);
    const sway = Math.sin(frame.time * 1.6 + r * 9 + x) * c * 0.025;
    ctx.beginPath();
    ctx.moveTo(bx - c * 0.03, top.y - c * 0.03);
    ctx.quadraticCurveTo(bx + sway * 0.5, top.y - c * 0.12, bx + sway, top.y - c * (0.14 + r * 0.08));
    ctx.quadraticCurveTo(bx + sway * 0.5, top.y - c * 0.1, bx + c * 0.03, top.y - c * 0.03);
    ctx.fill();
  }
}

/** The rock tapering under an island: deeper in the middle of the run, ragged along the edge. */
function drawBelly(frame: SceneFrame, belly: Belly): void {
  const { ctx, cam, theme } = frame;
  const c = cam.cell;
  const left = project(cam, belly.x0, belly.y, belly.z);
  const width = belly.length * c;
  const samples = belly.length * 2;
  const depthAt = (i: number): number => {
    const u = (i + 0.0001) / samples;
    const cone = Math.sin(Math.PI * u) ** 0.7;
    const scale = Math.min(1, 0.45 + belly.length / 10);
    const ragged = 0.55 + hash(belly.x0 * 3 + i, belly.y, belly.z + 11) * 0.6;
    return c * belly.reach * scale * cone * ragged + (i === 0 || i === samples ? 0 : c * 0.06);
  };

  const fill = ctx.createLinearGradient(0, left.y, 0, left.y + c * belly.reach);
  fill.addColorStop(0, theme.rockDark);
  fill.addColorStop(1, 'rgba(20, 16, 30, 0.92)');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(left.x, left.y - 1);
  ctx.lineTo(left.x + width, left.y - 1);
  for (let i = samples; i >= 0; i--) ctx.lineTo(left.x + (width * i) / samples, left.y + depthAt(i));
  ctx.closePath();
  ctx.fill();
}

// --------------------------------------------------------------------------- features

function quadPath(ctx: CanvasRenderingContext2D, cam: Camera, y: number, x0: number, x1: number, z0: number, z1: number): void {
  const a = project(cam, x0, y, z0);
  const b = project(cam, x1, y, z0);
  const c = project(cam, x1, y, z1);
  const d = project(cam, x0, y, z1);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
}

function segmentPath(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, strength: number): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, withAlpha(color, strength));
  gradient.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** `wireOnly` redraws just what belongs to a wire, for the 1D view. */
function drawFeatures(frame: SceneFrame, cell: Cell, x: number, y: number, z: number, wireOnly: boolean): void {
  const { ctx, cam, world, time, theme } = frame;
  const c = cam.cell;
  const feet = project(cam, x + 0.5, y, z + 0.5);
  const centre = project(cam, x + 0.5, y + 0.5, z + 0.5);

  if (cell.plate !== null && !wireOnly) {
    const color = channelColor(cell.plate);
    const pressed = world.live.has(cell.plate);
    const thick = pressed ? 0.035 : 0.11;
    const front = project(cam, x + 0.12, y + thick, z + 0.14);
    if (pressed) glow(ctx, feet.x, feet.y, c * 0.75, color, 0.5);
    ctx.fillStyle = withAlpha(color, 0.9);
    quadPath(ctx, cam, y + thick, x + 0.12, x + 0.88, z + 0.14, z + 0.86);
    ctx.fill();
    ctx.fillStyle = pressed ? COLORS.paper : color;
    ctx.fillRect(front.x, front.y, c * 0.76, c * thick + 1);
    ctx.strokeStyle = 'rgba(20, 16, 30, 0.6)';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(front.x, front.y, c * 0.76, c * thick + 1);
  }

  if (cell.threshold && !wireOnly) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + x);
    const front = project(cam, x + 0.1, y + 0.06, z + 0.1);
    ctx.fillStyle = '#9a63f5';
    quadPath(ctx, cam, y + 0.06, x + 0.1, x + 0.9, z + 0.1, z + 0.9);
    ctx.fill();
    ctx.fillStyle = withAlpha(COLORS.paper, 0.25 + 0.35 * pulse);
    quadPath(ctx, cam, y + 0.06, x + 0.26, x + 0.74, z + 0.26, z + 0.74);
    ctx.fill();
    ctx.fillStyle = COLORS.threshold;
    ctx.fillRect(front.x, front.y, c * 0.8, c * 0.06 + 1);
    drawCubeSigil(ctx, centre.x, centre.y - c * (0.1 + 0.05 * Math.sin(time * 1.8)), c * 0.2, 0.6 + 0.4 * pulse);
  }

  if (cell.exit) drawExit(frame, feet, c);

  // A door cell stacked on a wire barrier of the same channel only makes the barrier two
  // cells tall for the rules; the ring on the wire is all there is to see.
  const under = cellAt(world.level, vec(x, y - 1, z));
  const partOfBarrier = cell.door !== null && cell.wire === null && under !== null && under.wire !== null && under.door === cell.door;

  if (cell.door !== null && !partOfBarrier) {
    const open = frame.doorOpen(cellIndex(world.level.size, vec(x, y, z)));
    if (cell.wire !== null) drawBarrier(ctx, centre, c, channelColor(cell.door), open, time);
    else if (!wireOnly) drawGate(ctx, project(cam, x, y + 1, z + 0.5), c, channelColor(cell.door), open, theme, time, cell.inverted);
  }

  if (cell.lever !== null && !wireOnly) drawLever(ctx, feet, c, channelColor(cell.lever), world.toggled.includes(cell.lever), theme);

  if (cell.anchor) {
    if (!wireOnly) {
      ctx.fillStyle = theme.rockDark;
      ctx.beginPath();
      ctx.moveTo(feet.x - c * 0.2, feet.y);
      ctx.lineTo(feet.x - c * 0.12, feet.y - c * 0.14);
      ctx.lineTo(feet.x + c * 0.12, feet.y - c * 0.14);
      ctx.lineTo(feet.x + c * 0.2, feet.y);
      ctx.closePath();
      ctx.fill();
    }
    const bob = Math.sin(time * 2 + x * 1.3) * c * 0.03;
    const r = c * 0.17;
    glow(ctx, centre.x, centre.y + bob, c * 0.5, COLORS.wire, 0.45);
    ctx.fillStyle = COLORS.wire;
    ctx.beginPath();
    ctx.moveTo(centre.x, centre.y + bob - r * 1.3);
    ctx.lineTo(centre.x + r, centre.y + bob);
    ctx.lineTo(centre.x, centre.y + bob + r * 1.3);
    ctx.lineTo(centre.x - r, centre.y + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = withAlpha(COLORS.paper, 0.8);
    ctx.beginPath();
    ctx.moveTo(centre.x, centre.y + bob - r * 1.3);
    ctx.lineTo(centre.x + r * 0.35, centre.y + bob);
    ctx.lineTo(centre.x, centre.y + bob + r * 0.5);
    ctx.lineTo(centre.x - r * 0.35, centre.y + bob);
    ctx.closePath();
    ctx.fill();
  }
}

/** The 3D threshold wears its meaning: a small solid cube floating above the tile. */
function drawCubeSigil(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha: number): void {
  // Six corners of a cube seen from its corner, plus the centre where three faces meet.
  const corner = (i: number): Point => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  };
  const face = (a: number, b: number, c: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (const i of [a, b, c]) {
      const p = corner(i);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  glow(ctx, cx, cy, r * 2.8, COLORS.threshold, 0.5 * alpha);
  ctx.strokeStyle = COLORS.paper;
  ctx.lineWidth = Math.max(1.25, r * 0.1);
  ctx.lineJoin = 'round';
  face(5, 0, 1, '#e6d2ff');
  face(1, 2, 3, '#8f5cf0');
  face(3, 4, 5, '#b98cff');
}

function drawExit(frame: SceneFrame, feet: Point, c: number): void {
  const { ctx, time, theme } = frame;
  const w = c * 0.56;
  const h = c * 0.88;
  const arch = (inset: number): void => {
    const half = w / 2 - inset;
    ctx.beginPath();
    ctx.moveTo(feet.x - half, feet.y);
    ctx.lineTo(feet.x - half, feet.y - h + w / 2);
    ctx.arc(feet.x, feet.y - h + w / 2, half, Math.PI, 0);
    ctx.lineTo(feet.x + half, feet.y);
    ctx.closePath();
  };

  glow(ctx, feet.x, feet.y - h * 0.5, c * 1.1, COLORS.exit, 0.4 + 0.1 * Math.sin(time * 2));

  // A beam of light above the door: the goal stays findable even with something in front of it.
  const beam = ctx.createLinearGradient(0, feet.y - h - c * 2.2, 0, feet.y - h);
  beam.addColorStop(0, withAlpha(COLORS.exit, 0));
  beam.addColorStop(1, withAlpha(COLORS.exit, 0.3 + 0.08 * Math.sin(time * 2)));
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(feet.x - w * 0.34, feet.y - h + w * 0.2);
  ctx.lineTo(feet.x - w * 0.12, feet.y - h - c * 2.2);
  ctx.lineTo(feet.x + w * 0.12, feet.y - h - c * 2.2);
  ctx.lineTo(feet.x + w * 0.34, feet.y - h + w * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = theme.rockDark;
  arch(-c * 0.07);
  ctx.fill();

  const light = ctx.createLinearGradient(0, feet.y - h, 0, feet.y);
  light.addColorStop(0, '#ffffff');
  light.addColorStop(1, COLORS.exit);
  ctx.fillStyle = light;
  arch(0);
  ctx.fill();

  // Motes rising inside the doorway.
  ctx.save();
  arch(0);
  ctx.clip();
  ctx.fillStyle = withAlpha('#ffb84d', 0.7);
  for (let i = 0; i < 5; i++) {
    const phase = (time * 0.35 + i * 0.21) % 1;
    const mx = feet.x + Math.sin(i * 2.4 + time) * w * 0.3;
    ctx.beginPath();
    ctx.arc(mx, feet.y - phase * h, c * 0.025 * (1 - phase) + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A lever: a stick on a base, leaning left when off and right, lit, when on. */
function drawLever(ctx: CanvasRenderingContext2D, feet: Point, c: number, color: string, on: boolean, theme: Theme): void {
  const lean = on ? 0.6 : -0.6;
  const tipX = feet.x + Math.sin(lean) * c * 0.42;
  const tipY = feet.y - c * 0.1 - Math.cos(lean) * c * 0.42;
  if (on) glow(ctx, tipX, tipY, c * 0.6, color, 0.55);
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = Math.max(3, c * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  segmentPath(ctx, feet.x, feet.y - c * 0.1, tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = on ? color : withAlpha(color, 0.55);
  ctx.beginPath();
  ctx.arc(tipX, tipY, c * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = theme.rockDark;
  ctx.beginPath();
  ctx.moveTo(feet.x - c * 0.26, feet.y);
  ctx.lineTo(feet.x - c * 0.16, feet.y - c * 0.14);
  ctx.lineTo(feet.x + c * 0.16, feet.y - c * 0.14);
  ctx.lineTo(feet.x + c * 0.26, feet.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(feet.x - c * 0.16, feet.y - c * 0.07, c * 0.32, c * 0.035);
}

/**
 * A door between two posts; its bars retract upward as it opens. A gate (open until its
 * channel goes live) wears horizontal bars so the two are never confused.
 */
function drawGate(
  ctx: CanvasRenderingContext2D,
  topLeft: Point,
  c: number,
  color: string,
  open: number,
  theme: Theme,
  time: number,
  inverted: boolean,
): void {
  const closed = 1 - open;
  if (closed > 0.02) {
    // A closed door must never look half open: the shimmer stays near full strength.
    const shimmer = 0.9 + 0.1 * Math.sin(time * 5);
    ctx.fillStyle = withAlpha(color, 0.22 * closed);
    ctx.fillRect(topLeft.x + c * 0.2, topLeft.y, c * 0.6, c * closed);
    ctx.strokeStyle = withAlpha(color, closed * shimmer);
    ctx.lineWidth = Math.max(2, c * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (inverted) {
      for (const v of [0.22, 0.5, 0.78]) {
        if (v <= closed) segmentPath(ctx, topLeft.x + c * 0.24, topLeft.y + c * v, topLeft.x + c * 0.76, topLeft.y + c * v);
      }
    } else {
      for (const u of [0.32, 0.5, 0.68]) segmentPath(ctx, topLeft.x + c * u, topLeft.y, topLeft.x + c * u, topLeft.y + c * closed);
    }
    ctx.stroke();
  }
  ctx.fillStyle = theme.rockDark;
  ctx.fillRect(topLeft.x + c * 0.1, topLeft.y, c * 0.12, c + 0.5);
  ctx.fillRect(topLeft.x + c * 0.78, topLeft.y, c * 0.12, c + 0.5);
  ctx.fillStyle = color;
  ctx.fillRect(topLeft.x + c * 0.1, topLeft.y + c * 0.42, c * 0.12, c * 0.1);
  ctx.fillRect(topLeft.x + c * 0.78, topLeft.y + c * 0.42, c * 0.12, c * 0.1);
}

/** A barrier on a wire: a shield across the thread, splitting in two as it opens. */
function drawBarrier(ctx: CanvasRenderingContext2D, centre: Point, c: number, color: string, open: number, time: number): void {
  const r = c * 0.3;
  const gap = open * c * 0.26;
  glow(ctx, centre.x, centre.y, c * 0.7, color, 0.35 * (1 - open * 0.6));
  ctx.lineWidth = Math.max(3, c * 0.08);
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(centre.x, centre.y + side * gap, r, side < 0 ? Math.PI * 1.08 : Math.PI * 0.08, side < 0 ? Math.PI * 1.92 : Math.PI * 0.92);
    ctx.stroke();
  }
  if (open < 0.98) {
    ctx.strokeStyle = withAlpha(COLORS.paper, (1 - open) * (0.7 + 0.3 * Math.sin(time * 6)));
    ctx.lineWidth = Math.max(3, c * 0.09);
    ctx.beginPath();
    segmentPath(ctx, centre.x, centre.y - r * (1 - open), centre.x, centre.y + r * (1 - open));
    ctx.stroke();
  }
}

function drawWire(frame: SceneFrame, segment: Segment, focused: boolean): void {
  const { ctx, cam, time } = frame;
  const c = cam.cell;
  const a = project(cam, segment.a.x + 0.5, segment.a.y + 0.5, segment.a.z + 0.5);
  const b = project(cam, segment.b.x + 0.5, segment.b.y + 0.5, segment.b.z + 0.5);
  ctx.lineCap = 'round';
  ctx.strokeStyle = withAlpha(COLORS.wire, focused ? 0.4 : 0.25);
  ctx.lineWidth = c * (focused ? 0.2 : 0.14);
  ctx.beginPath();
  segmentPath(ctx, a.x, a.y, b.x, b.y);
  ctx.stroke();
  ctx.strokeStyle = COLORS.wire;
  ctx.lineWidth = Math.max(2, c * 0.04);
  ctx.stroke();

  // Light running along the thread.
  ctx.strokeStyle = COLORS.paper;
  ctx.setLineDash([c * 0.1, c * 0.9]);
  ctx.lineDashOffset = segment.index * c - time * c * 1.4;
  ctx.stroke();
  ctx.setLineDash([]);
}

// ----------------------------------------------------------------------------- bodies

function drawCrate(frame: SceneFrame, crate: CratePose): void {
  const { ctx, cam, tiles } = frame;
  const c = cam.cell;
  const size = 0.88;
  const x0 = crate.x + (1 - size) / 2;
  const z0 = crate.z + (1 - size) / 2;
  const top = project(cam, x0, crate.y + size, z0);
  const s = size * c;
  if (cam.depth > 0.02) {
    const back = project(cam, x0, crate.y + size, z0 + size);
    texturedQuad(ctx, tiles.crateTop, back, s, 0, top.x - back.x, top.y - back.y);
    const far = project(cam, x0 + size, crate.y + size, z0 + size);
    texturedQuad(ctx, tiles.crateSide, { x: top.x + s, y: top.y }, far.x - (top.x + s), far.y - top.y, 0, s);
  }
  ctx.drawImage(tiles.crate, top.x, top.y, s, s);
  ctx.strokeStyle = 'rgba(20, 16, 30, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(top.x, top.y, s, s);
}

/**
 * In the air, the shadow stays on whatever is below: it shows where the body would come
 * down, and the gap between the two is what says "this one is not standing".
 */
function drawDropShadow(frame: SceneFrame, pose: ActorPose, feet: Point): void {
  const { ctx, cam, world } = frame;
  const c = cam.cell;
  const { x, z } = pose.cell;
  let ground: number | null = null;
  for (let y = Math.floor(pose.y + 0.5) - 1; y >= 0; y--) {
    const below = vec(x, y, z);
    const body = world.bodies.some((a) => a.id !== pose.id && a.cell.x === x && a.cell.y === y && a.cell.z === z);
    const door = cellAt(world.level, below)?.door != null && frame.doorOpen(cellIndex(world.level.size, below)) < 0.5;
    if (isSolid(world, below) || door || body || world.crates.some((k) => k.x === x && k.y === y && k.z === z)) {
      ground = y + 1;
      break;
    }
  }
  const saved = ctx.globalAlpha;
  if (ground !== null) {
    const height = Math.max(0, pose.y - ground);
    const at = project(cam, pose.x + 0.5, ground, pose.z + 0.5);
    const shrink = 1 / (1 + height * 0.9);
    ctx.globalAlpha = saved * 0.3 * shrink * pose.alpha;
    ctx.fillStyle = '#0b0a14';
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, c * 0.26 * shrink, c * (0.05 + 0.05 * cam.depth) * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Two short strokes under the feet: air, not ground.
  ctx.globalAlpha = saved * 0.55 * pose.alpha;
  ctx.strokeStyle = COLORS.paper;
  ctx.lineWidth = Math.max(1.5, c * 0.03);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(feet.x + side * c * 0.14, feet.y + c * 0.05);
    ctx.lineTo(feet.x + side * c * 0.14, feet.y + c * 0.15);
  }
  ctx.stroke();
  ctx.globalAlpha = saved;
}

function drawActor(frame: SceneFrame, pose: ActorPose): void {
  const { ctx, cam, time } = frame;
  const c = cam.cell;
  const feet = project(cam, pose.x + 0.5, pose.y, pose.z + 0.5);
  const onWire = pose.dim === 1;

  if (!onWire && !pose.airborne) {
    const saved = ctx.globalAlpha;
    ctx.globalAlpha = saved * 0.28 * pose.alpha;
    ctx.fillStyle = '#0b0a14';
    ctx.beginPath();
    ctx.ellipse(feet.x, feet.y, c * 0.26, c * (0.05 + 0.05 * cam.depth), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = saved;
  } else if (!onWire) {
    drawDropShadow(frame, pose, feet);
  }

  const look = frame.lookOf(pose);
  drawCharacter(ctx, feet.x, feet.y, c, {
    role: pose.role,
    reflection: frame.world.level.mirror && pose.role === 'clone',
    onWire,
    facing: look.facing,
    squash: look.squash,
    joy: look.joy,
    stride: pose.stride,
    airborne: pose.airborne,
    alpha: pose.alpha,
    time,
    seed: pose.id,
  });

  // With several clones on stage, each wears its number: the tapes in the HUD use the same.
  if (pose.role === 'clone' && frame.world.bodies.length > 2 && pose.alpha > 0.5) {
    const head = project(cam, pose.x + 0.5, pose.y + (onWire ? 0.95 : 1.02), pose.z + 0.5);
    ctx.font = `800 ${Math.round(Math.max(11, c * 0.22))}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.ink;
    ctx.strokeText(String(pose.id + 1), head.x, head.y);
    ctx.fillStyle = COLORS.paper;
    ctx.fillText(String(pose.id + 1), head.x, head.y);
  }
}
