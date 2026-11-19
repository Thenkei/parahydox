import { cellAt, cellIndex, vec } from '../../core/grid';
import type { Cell, Channel, Dim, Level, Vec3 } from '../../core/types';
import type { TileSet } from '../assets';
import { COLORS, type Theme, channelColor } from '../themes';
import { type Camera, DEPTH_X, DEPTH_Y, type Point, layerAlpha, project } from './camera';
import { type CharacterLook, drawCharacter } from './character';
import type { ActorPose, CratePose, Slide } from './motion';
import { type Copy, GHOST_CELLS, copiesOf, ghostAlpha, seamCell, shifted } from './seam';

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
  readonly checkpoint: number | null;
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

/** The cell at these coordinates; past a joined edge, the one on the other side. */
const cellOf = (level: Level, x: number, y: number, z: number): Cell | null => cellAt(level, seamCell(level, x, y, z));

/** Terrain that is still there: a fragile slab stops being solid once it has crumbled. */
function isSolid(view: SceneView, p: Vec3): boolean {
  const at = seamCell(view.level, p.x, p.y, p.z);
  const cell = cellAt(view.level, at);
  return cell !== null && cell.solid && !(cell.fragile && view.broken.has(cellIndex(view.level.size, at)));
}

/** A body is nine tenths of a cell tall, as in the rules. */
const TALL = 0.9;

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
  readonly lookOf: (pose: ActorPose) => Pick<CharacterLook, 'facing' | 'squash' | 'joy' | 'boots'>;
  /** 0 closed … 1 open, eased by the stage. */
  readonly doorOpen: (cell: number) => number;
}

const hash = (x: number, y: number, z: number): number => {
  let n = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};

/**
 * `ceilings` is for a world whose undersides are walked on: they are dressed like ground,
 * and rock only hangs under the very bottom of the level, where nobody goes.
 */
export function buildGeometry(level: Level, ceilings = false): LevelGeometry {
  const { w, h, d } = level.size;
  // Fragile slabs are thin: they carry no hanging rock, and nothing hangs from what they hold.
  const solid = (x: number, y: number, z: number): boolean => {
    const cell = cellOf(level, x, y, z);
    return cell !== null && cell.solid && !cell.fragile;
  };

  const bellies: Belly[] = [];
  for (let z = 0; z < d; z++) {
    for (let y = 0; y < h; y++) {
      if (ceilings && (y > 0 || level.wrap.y)) continue;
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
          // Along a joined bottom and top there is no void below: the space under a block ends somewhere.
          let free = 0;
          while (free < h && (level.wrap.y || y - 1 - free >= 0) && !solid(x, y - 1 - free, z)) free++;
          room = Math.min(room, !level.wrap.y && y - 1 - free < 0 ? Infinity : free);
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

  // Past a joined edge the far side of the level is drawn again, fading: the same cells, the
  // same bodies, seen through a camera slid by one width or one height.
  const gx = level.wrap.x ? GHOST_CELLS : 0;
  const gy = level.wrap.y ? GHOST_CELLS : 0;
  const slid = new Map<number, SceneFrame>();
  const frameAt = (copy: Pick<Copy, 'dx' | 'dy'>): SceneFrame => {
    if (copy.dx === 0 && copy.dy === 0) return frame;
    const key = Math.sign(copy.dx) * 3 + Math.sign(copy.dy);
    let found = slid.get(key);
    if (!found) {
      found = { ...frame, cam: shifted(cam, copy) };
      slid.set(key, found);
    }
    return found;
  };
  const ghosts: Pick<Copy, 'dx' | 'dy'>[] = [];
  for (const j of gy > 0 ? [-1, 0, 1] : [0]) for (const i of gx > 0 ? [-1, 0, 1] : [0]) if (i !== 0 || j !== 0) ghosts.push({ dx: i * w, dy: j * h });

  /** A body at every place it is seen, its shadow first. */
  const drawBody = (pose: ActorPose, alpha: number, shadow: boolean): void => {
    if (alpha <= 0.01) return;
    if (shadow && pose.dim !== 1) {
      const landing = pose.airborne ? landingOf(frame, pose) : pose.y;
      if (landing !== null) {
        const drop = Math.max(0, (pose.y - landing) * pose.up);
        // Found through a joined bottom and top, the place lies past the edge: the shadow is on this side of the seam.
        const ground = seamCell(level, 0, landing, 0).y;
        for (const copy of copiesOf(level, pose.x + 0.24, pose.x + 0.76, ground, ground)) {
          ctx.globalAlpha = alpha * copy.alpha;
          drawShadow(frameAt(copy), pose, ground, drop);
        }
      }
    }
    const head = pose.dim === 1 ? pose.y + TALL : pose.y + pose.up * TALL;
    for (const copy of copiesOf(level, pose.x + 0.2, pose.x + 0.8, Math.min(pose.y, head), Math.max(pose.y, head))) {
      ctx.globalAlpha = alpha * copy.alpha;
      drawActor(frameAt(copy), pose);
    }
  };

  for (let z = d - 1; z >= 0; z--) {
    const visible = layerAlpha(cam, z);
    if (visible < 0.01) continue;
    // In 1D the world does not vanish: it stays as a ghost, so the wire is still somewhere.
    const alpha = visible * (WORLD_GHOST + (1 - WORLD_GHOST) * cam.world);

    if (alpha > 0.01) {
      ctx.globalAlpha = alpha;
      for (const belly of geometry.bellies) if (belly.z === z) drawBelly(frame, belly);
      for (const ghost of ghosts) {
        // The rock under the far side, kept to the strip where that side is shown.
        const x0 = ghost.dx < 0 ? -gx : ghost.dx > 0 ? w : 0;
        const x1 = ghost.dx < 0 ? 0 : ghost.dx > 0 ? w + gx : w;
        const y0 = ghost.dy < 0 ? -gy : ghost.dy > 0 ? h : -3;
        const y1 = ghost.dy < 0 ? 0 : ghost.dy > 0 ? h + gy : h;
        const from = project(cam, x0, y1, z);
        const to = project(cam, x1, y0, z);
        ctx.save();
        ctx.beginPath();
        ctx.rect(from.x, from.y, to.x - from.x, to.y - from.y);
        ctx.clip();
        ctx.globalAlpha = alpha * ghostAlpha(1);
        for (const belly of geometry.bellies) if (belly.z === z) drawBelly(frameAt(ghost), belly);
        ctx.restore();
      }
      for (let uy = -gy; uy < h + gy; uy++) {
        const j = Math.floor(uy / h);
        const y = uy - j * h;
        const outY = uy < 0 ? -uy - 0.5 : uy >= h ? uy - h + 0.5 : 0;
        for (let ux = -gx; ux < w + gx; ux++) {
          const i = Math.floor(ux / w);
          const x = ux - i * w;
          const outX = ux < 0 ? -ux - 0.5 : ux >= w ? ux - w + 0.5 : 0;
          const here = i === 0 && j === 0;
          const shown = here ? alpha : alpha * ghostAlpha(Math.hypot(outX, outY));
          if (shown <= 0.01) continue;
          const cell = cellAt(level, vec(x, y, z));
          if (!cell) continue;
          const at = here ? frame : frameAt({ dx: i * w, dy: j * h });
          if (cell.solid) {
            // A crumbled slab is simply gone.
            if (!isSolid(world, vec(x, y, z))) continue;
            // Walls standing between the camera and the player turn to glass in 3D.
            const veils = cam.depth > 0.5 && z < player.pos.z && y >= player.pos.y;
            ctx.globalAlpha = veils ? shown * 0.3 : shown;
            if (cell.fragile) drawSlab(at, x, y, z);
            else drawBlock(at, x, y, z);
          } else {
            // Doors standing in front of the player are veiled like walls, so they never hide it.
            const veils = cell.door !== null && cam.depth > 0.5 && z < player.pos.z;
            ctx.globalAlpha = veils ? shown * 0.35 : shown;
            drawFeatures(at, cell, x, y, z, false);
          }
        }
      }
      for (const segment of geometry.segments) {
        if (segment.layer !== z) continue;
        const mx = (segment.a.x + segment.b.x) / 2 + 0.5;
        const my = (segment.a.y + segment.b.y) / 2 + 0.5;
        for (const copy of copiesOf(level, mx, mx, my, my)) {
          ctx.globalAlpha = alpha * copy.alpha;
          drawWire(frameAt(copy), segment, false);
        }
      }
    }

    // What sits on the player's wire stays fully there in 1D; the rest fades with the world.
    const bodyAlpha = (cell: Vec3): number => (onFocusWire(cell) ? visible : alpha);
    for (const crate of frame.crates) {
      if (crate.cell.z !== z) continue;
      const solidity = bodyAlpha(crate.cell);
      if (solidity <= 0.01) continue;
      for (const copy of copiesOf(level, crate.x + 0.06, crate.x + 0.94, crate.y, crate.y + CRATE_SIZE)) {
        ctx.globalAlpha = solidity * copy.alpha;
        drawCrate(frameAt(copy), crate);
      }
    }
    const actors = frame.actors.filter((a) => a.cell.z === z).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const pose of actors) {
      // Clones stay readable from a wire: where they are is the whole point of a timeline.
      drawBody(pose, onFocusWire(pose.cell) ? visible : visible * (ACTOR_GHOST + (1 - ACTOR_GHOST) * cam.world), true);
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
  if (hero && cam.depth > 0.5 && hero.alpha > 0.5) drawBody(hero, 0.3 * cam.depth, true);

  ctx.globalAlpha = 1;
  drawSeams(frame);
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
    return isSolid(world, at) && !cellOf(level, at.x, at.y, at.z)?.fragile;
  };
  const ice = cellAt(level, vec(x, y, z))?.ice === true;
  const variant = Math.floor(hash(x, y, z) * tiles.stone.length);
  const open = cam.depth > 0.02;
  const dxp = cam.depth * DEPTH_X * c;
  const dyp = cam.depth * DEPTH_Y * c;
  const top = project(cam, x, y + 1, z);
  const topExposed = !solid(0, 1, 0);

  if (open && topExposed) {
    const back = project(cam, x, y + 1, z + 1);
    texturedQuad(ctx, ice ? tiles.iceTop : tiles.grass, back, c + 0.6, 0, top.x - back.x, top.y - back.y);
    // A faint edge per tile: in 3D the ground must be countable.
    ctx.strokeStyle = 'rgba(20, 16, 30, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    segmentPath(ctx, back.x, back.y, top.x, top.y);
    segmentPath(ctx, back.x, back.y, back.x + c, back.y);
    ctx.stroke();
  }
  if (open && !solid(1, 0, 0)) {
    const side = ice ? tiles.iceSide : (tiles.stoneSide[variant] ?? tiles.grass);
    texturedQuad(ctx, side, { x: top.x + c, y: top.y }, dxp, -dyp, 0, c + 0.6);
  }

  const face = ice ? tiles.ice : (tiles.stone[variant] ?? tiles.grass);
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
  ctx.strokeStyle = theme.outline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (!solid(-1, 0, 0)) segmentPath(ctx, top.x, top.y, top.x, top.y + c);
  if (!solid(1, 0, 0) && !open) segmentPath(ctx, top.x + c, top.y, top.x + c, top.y + c);
  if (!solid(0, -1, 0)) segmentPath(ctx, top.x, top.y + c, top.x + c, top.y + c);
  ctx.stroke();

  // Ice wears nothing, in any chapter: neither grass nor snow, only its own light, on top
  // and, where its underside is walked on, underneath.
  if (ice) return drawIceShine(frame, x, y, z, top, topExposed, theme.ceiling !== null && !solid(0, -1, 0));

  // In 3D a block with another in front of it has no edge facing the camera.
  const inner = open && solid(0, 0, -1);

  // A ceiling that is walked on is ground too, and grows its own grass, downward.
  if (theme.ceiling !== null && !inner && !solid(0, -1, 0) && (y > 0 || level.wrap.y)) {
    drawHangingGrass(frame, x, y, z, top, theme.ceiling);
    if (bareCell(cellOf(level, x, y - 1, z))) drawHangingSprig(frame, x, y, z, top, theme.ceiling);
  }

  if (topExposed) {
    // Grass and embers run back over the whole top; snow and a frieze are what the edge wears.
    if (!(inner && EDGE_ONLY.has(theme.biome))) TOPS[theme.biome](frame, x, y, z, top);
    // Small life on the ground, only where nothing that matters stands, and only along
    // the edge facing the camera so the ground stays readable in 3D.
    if (bareCell(cellOf(level, x, y + 1, z)) && !inner) SPRIGS[theme.biome](frame, x, y, z, top);
  }
}

/** A cell with nothing in it that the player must read: scenery may stand there. */
const bareCell = (cell: Cell | null): boolean =>
  cell !== null && !cell.exit && !cell.checkpoint && !cell.anchor && !cell.threshold && cell.plate === null && cell.lever === null && cell.door === null;

type Dressing = (frame: SceneFrame, x: number, y: number, z: number, top: Point) => void;

/**
 * Ice has no grip, and must be known for ice before anyone steps on it: a wet line of light
 * along its top, a star that winks, and a glint that travels along the whole run of blocks.
 */
function drawIceShine(frame: SceneFrame, x: number, y: number, z: number, top: Point, topExposed: boolean, walkedUnder: boolean): void {
  const { ctx, cam, time } = frame;
  const c = cam.cell;
  // One band of light crosses the level from left to right, each row a little after the one above.
  const u = ((((time * 3.1 - x + y * 0.7 - z * 1.3 + GLINT_LEAD) % GLINT_EVERY) + GLINT_EVERY) % GLINT_EVERY) - GLINT_LEAD;

  if (u < 1.5) {
    const cx = top.x + u * c;
    const cy = top.y + c / 2;
    // The band leans like a reflection on glass; the gradient runs across it.
    const nx = 0.9;
    const ny = 0.44;
    const half = c * 0.24;
    const band = ctx.createLinearGradient(cx - nx * half, cy - ny * half, cx + nx * half, cy + ny * half);
    band.addColorStop(0, 'rgba(255, 255, 255, 0)');
    band.addColorStop(0.5, 'rgba(255, 255, 255, 0.78)');
    band.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(top.x, top.y, c, c);
    if (cam.depth > 0.02 && topExposed) {
      const near = Math.max(0, 1 - Math.abs(u - 0.5) / 0.9);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.34 * near})`;
      quadPath(ctx, cam, y + 1, x, x + 1, z, z + 1);
      ctx.fill();
    }
  }

  const wink = Math.max(0, Math.sin(time * 2.1 + hash(x, y, z + 7) * Math.PI * 2)) ** 8;
  if (wink > 0.05) {
    const sx = top.x + c * (0.2 + hash(x + 5, y, z) * 0.6);
    const sy = top.y + c * (0.22 + hash(x, y + 5, z) * 0.56);
    const r = c * 0.13 * wink;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * wink})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.quadraticCurveTo(sx, sy, sx + r, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy + r);
    ctx.quadraticCurveTo(sx, sy, sx - r, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy - r);
    ctx.fill();
  }

  if (topExposed) {
    ctx.fillStyle = withAlpha(COLORS.ice, 0.55);
    ctx.fillRect(top.x, top.y, c + 0.6, c * 0.07);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(top.x, top.y - 1, c + 0.6, Math.max(2, c * 0.035));
  }
  if (walkedUnder) {
    ctx.fillStyle = withAlpha(COLORS.ice, 0.55);
    ctx.fillRect(top.x, top.y + c * 0.93, c + 0.6, c * 0.07);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(top.x, top.y + c + 1 - Math.max(2, c * 0.035), c + 0.6, Math.max(2, c * 0.035));
  }
}

/** How many cells apart two passes of the glint are, and how far before a block it starts to show. */
const GLINT_EVERY = 9;
const GLINT_LEAD = 0.6;

/**
 * Burnt ground: where grass would spill over the edge, a crust of cooled rock, and under
 * it a seam that still glows. Each block breathes on its own phase.
 */
function drawEmberSeam(frame: SceneFrame, x: number, y: number, z: number, top: Point): void {
  const { ctx, cam, theme, time } = frame;
  const c = cam.cell;
  const pulse = 0.7 + 0.3 * Math.sin(time * 1.7 + hash(x, y, z) * Math.PI * 2);

  // Heat rising off the seam.
  ctx.fillStyle = withAlpha(theme.grassLight, 0.08 * pulse);
  ctx.fillRect(top.x, top.y - c * 0.22, c, c * 0.22);
  ctx.fillStyle = withAlpha(theme.grassLight, 0.12 * pulse);
  ctx.fillRect(top.x, top.y - c * 0.1, c, c * 0.1);

  // The crust: angular where grass was soft.
  const teeth = 4;
  ctx.fillStyle = theme.grassDark;
  ctx.beginPath();
  ctx.moveTo(top.x - 1, top.y - c * 0.03);
  ctx.lineTo(top.x + c + 1, top.y - c * 0.03);
  for (let i = teeth; i >= 0; i--) {
    const drop = 0.07 + hash(x * 7 + i, y, z) * 0.1;
    ctx.lineTo(top.x + (c * (i + 0.35)) / teeth, top.y + c * drop);
    ctx.lineTo(top.x + (c * i) / teeth, top.y + c * 0.05);
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = withAlpha(theme.grassLight, pulse);
  ctx.fillRect(top.x - 1, top.y - c * 0.045, c + 2, c * 0.07);
  ctx.fillStyle = withAlpha(COLORS.paper, 0.55 * pulse);
  ctx.fillRect(top.x - 1, top.y - c * 0.03, c + 2, c * 0.022);

  // A flame or two licking up from the seam.
  ctx.fillStyle = theme.grassLight;
  for (let i = 0; i < 2; i++) {
    const r = hash(x, y * 5 + i, z + 3);
    if (r < 0.55) continue;
    const bx = top.x + c * (0.22 + 0.5 * i + r * 0.1);
    const flicker = 0.55 + 0.45 * Math.sin(time * (7 + r * 5) + r * 40 + x);
    const height = c * (0.07 + r * 0.09) * flicker;
    const lean = Math.sin(time * 3.1 + r * 9) * c * 0.025;
    ctx.beginPath();
    ctx.moveTo(bx - c * 0.035, top.y - c * 0.03);
    ctx.quadraticCurveTo(bx + lean, top.y - c * 0.03 - height * 1.7, bx + c * 0.035, top.y - c * 0.03);
    ctx.fill();
  }
}

/** What is left on burnt ground: a shard of glass, a coal still red, a pebble. Decoration, picked by position. */
function drawCinder(frame: SceneFrame, x: number, y: number, z: number, top: Point): void {
  const { ctx, cam, theme, time } = frame;
  const c = cam.cell;
  const pick = hash(x * 13 + 5, y * 7 + 1, z * 3 + 2);
  if (pick < 0.66) return;
  const at = top.x + c * (0.2 + hash(x, y + 21, z) * 0.6);
  const base = top.y - c * 0.03;

  if (pick < 0.82) {
    // A shard standing in the ash, one face catching the light.
    const height = c * (0.14 + hash(x + 3, y, z) * 0.1);
    const lean = (hash(x, y, z + 40) - 0.5) * c * 0.08;
    ctx.fillStyle = theme.rockDark;
    ctx.beginPath();
    ctx.moveTo(at - c * 0.05, base);
    ctx.lineTo(at + lean, base - height);
    ctx.lineTo(at + c * 0.05, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = withAlpha(theme.grassLight, 0.75);
    ctx.beginPath();
    ctx.moveTo(at + c * 0.005, base);
    ctx.lineTo(at + lean, base - height);
    ctx.lineTo(at + c * 0.05, base);
    ctx.closePath();
    ctx.fill();
  } else if (pick < 0.92) {
    const heat = 0.6 + 0.4 * Math.sin(time * 2.3 + x * 1.7 + z);
    glow(ctx, at, base - c * 0.03, c * 0.2, theme.grassLight, 0.4 * heat);
    ctx.fillStyle = theme.grassDark;
    ctx.beginPath();
    ctx.ellipse(at, base - c * 0.03, c * 0.065, c * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(theme.grassLight, heat);
    ctx.beginPath();
    ctx.ellipse(at, base - c * 0.035, c * 0.035, c * 0.022, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = theme.rockDark;
    ctx.beginPath();
    ctx.ellipse(at, base - c * 0.025, c * 0.07, c * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
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

/**
 * Frozen ground: a cap of snow sagging over the edge where grass would spill, and icicles
 * under its lobes. The cap is as high at both ends of every block, so a run of them is one drift.
 */
function drawSnowCap(frame: SceneFrame, x: number, y: number, z: number, top: Point): void {
  const { ctx, cam, theme, time } = frame;
  const c = cam.cell;
  const lobes = 3;
  const rim = top.y - c * 0.075;
  const lip = top.y + c * 0.05;

  // Icicles first: their roots are under the snow.
  for (let i = 0; i < lobes; i++) {
    const r = hash(x * 5 + i, y + 2, z + 9);
    if (r < 0.52) continue;
    const bx = top.x + c * ((i + 0.5) / lobes + (r - 0.75) * 0.2);
    const length = c * (0.12 + (r - 0.52) * 0.42);
    ctx.fillStyle = withAlpha(COLORS.ice, 0.92);
    ctx.beginPath();
    ctx.moveTo(bx - c * 0.04, lip);
    ctx.lineTo(bx + c * 0.04, lip);
    ctx.lineTo(bx + c * 0.006, lip + length);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = withAlpha(theme.grassDark, 0.7);
    ctx.beginPath();
    ctx.moveTo(bx + c * 0.008, lip);
    ctx.lineTo(bx + c * 0.04, lip);
    ctx.lineTo(bx + c * 0.006, lip + length);
    ctx.closePath();
    ctx.fill();
  }

  const cap = (sag: number): void => {
    ctx.beginPath();
    ctx.moveTo(top.x - 1, rim);
    // The top of the drift: one soft swell per block.
    const swell = c * (0.035 + hash(x, y + 13, z) * 0.05);
    ctx.quadraticCurveTo(top.x + c * (0.3 + hash(x + 1, y, z + 5) * 0.4), rim - swell * 2, top.x + c + 1, rim);
    ctx.lineTo(top.x + c + 1, lip + sag);
    for (let i = lobes - 1; i >= 0; i--) {
      const drop = c * (0.06 + hash(x * 7 + i, y, z) * 0.13);
      const x1 = top.x + (c * (i + 1)) / lobes;
      const x0 = top.x + (c * i) / lobes;
      ctx.bezierCurveTo(x1 - c * 0.02, lip + sag + drop * 1.3, x0 + c * 0.02, lip + sag + drop * 1.3, i === 0 ? x0 - 1 : x0, lip + sag);
    }
    ctx.closePath();
    ctx.fill();
  };
  // The shade under the lobes, then the snow itself.
  ctx.fillStyle = theme.grassDark;
  cap(c * 0.03);
  ctx.fillStyle = theme.grassLight;
  cap(0);

  // Frost catching the light, now and then.
  const wink = Math.max(0, Math.sin(time * 1.7 + hash(x, y + 3, z) * Math.PI * 2)) ** 10;
  if (wink > 0.05) {
    const sx = top.x + c * (0.15 + hash(x + 9, y, z) * 0.7);
    const sy = top.y - c * 0.02;
    const r = c * 0.07 * wink;
    ctx.fillStyle = withAlpha(COLORS.ice, wink);
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.lineTo(sx + r * 0.28, sy - r * 0.28);
    ctx.lineTo(sx + r, sy);
    ctx.lineTo(sx + r * 0.28, sy + r * 0.28);
    ctx.lineTo(sx, sy + r);
    ctx.lineTo(sx - r * 0.28, sy + r * 0.28);
    ctx.lineTo(sx - r, sy);
    ctx.lineTo(sx - r * 0.28, sy - r * 0.28);
    ctx.closePath();
    ctx.fill();
  }
}

/** What stands in the snow: a bare twig rimed white, a cluster of ice, a drift, and once in a while a very small snowman. */
function drawFrostSprig(frame: SceneFrame, x: number, y: number, z: number, top: Point): void {
  const { ctx, cam, theme } = frame;
  const c = cam.cell;
  const pick = hash(x * 13 + 5, y * 7 + 1, z * 3 + 2);
  if (pick < 0.62) return;
  const at = top.x + c * (0.2 + hash(x, y + 21, z) * 0.6);
  const base = top.y - c * 0.06;

  if (pick < 0.78) {
    const height = c * (0.2 + hash(x + 3, y, z) * 0.1);
    const lean = (hash(x, y, z + 40) - 0.5) * c * 0.08;
    ctx.strokeStyle = theme.rockDark;
    ctx.lineWidth = Math.max(1.25, c * 0.022);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(at, base);
    ctx.lineTo(at + lean, base - height);
    ctx.moveTo(at + lean * 0.45, base - height * 0.45);
    ctx.lineTo(at + lean * 0.45 + c * 0.07, base - height * 0.72);
    ctx.moveTo(at + lean * 0.65, base - height * 0.65);
    ctx.lineTo(at + lean * 0.65 - c * 0.06, base - height * 0.9);
    ctx.stroke();
    ctx.fillStyle = theme.grassLight;
    for (const [dx, dy] of [
      [lean, -height],
      [lean * 0.45 + c * 0.07, -height * 0.72],
      [lean * 0.65 - c * 0.06, -height * 0.9],
    ] as const) {
      ctx.beginPath();
      ctx.arc(at + dx, base + dy, c * 0.028, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pick < 0.9) {
    // Shards of ice, the tallest in the middle, one face in the light.
    for (const [dx, tall] of [
      [-0.06, 0.6],
      [0.06, 0.75],
      [0, 1],
    ] as const) {
      const height = c * (0.13 + hash(x + 3, y, z) * 0.08) * tall;
      const cx = at + dx * c;
      ctx.fillStyle = withAlpha(theme.grassDark, 0.95);
      ctx.beginPath();
      ctx.moveTo(cx - c * 0.04, base + c * 0.03);
      ctx.lineTo(cx + dx * c * 0.4, base - height);
      ctx.lineTo(cx + c * 0.04, base + c * 0.03);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = withAlpha(COLORS.ice, 0.95);
      ctx.beginPath();
      ctx.moveTo(cx - c * 0.04, base + c * 0.03);
      ctx.lineTo(cx + dx * c * 0.4, base - height);
      ctx.lineTo(cx - c * 0.004, base + c * 0.03);
      ctx.closePath();
      ctx.fill();
    }
  } else if (pick < 0.97) {
    ctx.fillStyle = theme.grassDark;
    ctx.beginPath();
    ctx.ellipse(at + c * 0.015, base + c * 0.02, c * 0.13, c * 0.075, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = theme.grassLight;
    ctx.beginPath();
    ctx.ellipse(at, base + c * 0.02, c * 0.12, c * 0.07, 0, Math.PI, 0);
    ctx.fill();
  } else {
    ctx.fillStyle = theme.grassDark;
    ctx.beginPath();
    ctx.arc(at + c * 0.012, base - c * 0.05, c * 0.085, 0, Math.PI * 2);
    ctx.arc(at + c * 0.012, base - c * 0.17, c * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.grassLight;
    ctx.beginPath();
    ctx.arc(at, base - c * 0.05, c * 0.085, 0, Math.PI * 2);
    ctx.arc(at, base - c * 0.17, c * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(at - c * 0.03, base - c * 0.185, c * 0.018, c * 0.018);
    ctx.fillRect(at + c * 0.012, base - c * 0.185, c * 0.018, c * 0.018);
    ctx.fillStyle = '#ff8a3c';
    ctx.beginPath();
    ctx.moveTo(at - c * 0.005, base - c * 0.165);
    ctx.lineTo(at + c * 0.06, base - c * 0.15);
    ctx.lineTo(at - c * 0.005, base - c * 0.14);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Marble needs no grass: its top is a floor. Along the edge, a frieze cut from the mosaic
 * that covers it, between two fillets of gold.
 */
function drawMosaicFrieze(frame: SceneFrame, x: number, y: number, z: number, top: Point): void {
  const { ctx, cam, theme, tiles } = frame;
  const c = cam.cell;
  const size = tiles.grass.width;
  const band = c * 0.13;
  // Each block takes its strip from another row of the mosaic, so the frieze does not repeat.
  const row = Math.floor(hash(x, y + 17, z) * 5) * size * 0.17;
  ctx.drawImage(tiles.grass, 0, row, size, size * 0.13, top.x - 0.5, top.y - c * 0.015, c + 1, band);
  ctx.fillStyle = theme.grassDark;
  ctx.fillRect(top.x - 1, top.y - c * 0.015 + band, c + 2, c * 0.022);
  ctx.fillStyle = theme.grassLight;
  ctx.fillRect(top.x - 1, top.y - c * 0.055, c + 2, c * 0.05);
  ctx.fillRect(top.x - 1, top.y - c * 0.015 + band - c * 0.018, c + 2, c * 0.026);
  ctx.fillStyle = withAlpha(COLORS.paper, 0.7);
  ctx.fillRect(top.x - 1, top.y - c * 0.055, c + 2, c * 0.016);
}

/** What stands on the marble: a golden hoop turning on its foot, a banded sphere, the stump of a column. */
function drawTrinket(frame: SceneFrame, x: number, y: number, z: number, top: Point): void {
  const { ctx, cam, theme, time } = frame;
  const c = cam.cell;
  const pick = hash(x * 13 + 5, y * 7 + 1, z * 3 + 2);
  if (pick < 0.64) return;
  const at = top.x + c * (0.22 + hash(x, y + 21, z) * 0.56);
  const base = top.y - c * 0.055;

  if (pick < 0.84) {
    // A ring seen turning about its upright: it thins to a line and opens again, for ever.
    const r = c * (0.1 + hash(x + 3, y, z) * 0.035);
    const turn = Math.cos(time * 0.9 + hash(x, y, z + 40) * Math.PI * 2);
    ctx.fillStyle = theme.rockDark;
    ctx.fillRect(at - c * 0.05, base - c * 0.03, c * 0.1, c * 0.03);
    ctx.strokeStyle = theme.grassLight;
    ctx.lineWidth = Math.max(1.5, c * 0.032);
    ctx.beginPath();
    ctx.ellipse(at, base - c * 0.04 - r, Math.max(c * 0.012, r * Math.abs(turn)), r, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = withAlpha(COLORS.paper, 0.9);
    ctx.beginPath();
    ctx.arc(at + r * turn * 0.7, base - c * 0.04 - r * 1.7, c * 0.016, 0, Math.PI * 2);
    ctx.fill();
  } else if (pick < 0.94) {
    const r = c * 0.075;
    ctx.fillStyle = theme.rockDark;
    ctx.beginPath();
    ctx.arc(at + c * 0.01, base - r + c * 0.005, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.paper;
    ctx.beginPath();
    ctx.arc(at, base - r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.grassLight;
    ctx.lineWidth = Math.max(1.25, c * 0.022);
    ctx.beginPath();
    ctx.ellipse(at, base - r, r, r * 0.32, -0.35, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const height = c * (0.1 + hash(x + 3, y, z) * 0.06);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(at - c * 0.06, base - height, c * 0.12, height);
    ctx.fillStyle = withAlpha(theme.rockDark, 0.3);
    for (const flute of [-0.03, 0.005, 0.04]) ctx.fillRect(at + flute * c, base - height, c * 0.012, height);
    ctx.fillStyle = theme.grassLight;
    ctx.fillRect(at - c * 0.075, base - height - c * 0.025, c * 0.15, c * 0.03);
  }
}

/**
 * The underside of a block that is walked on: the same fringe as on top, turned over and in
 * the ceiling's own colour, so that the two grounds are never taken for one another.
 */
function drawHangingGrass(frame: SceneFrame, x: number, y: number, z: number, top: Point, under: NonNullable<Theme['ceiling']>): void {
  const { ctx, cam } = frame;
  const c = cam.cell;
  const edge = top.y + c;
  const blades = 6;
  ctx.fillStyle = under.dark;
  ctx.beginPath();
  ctx.moveTo(top.x - 1, edge + c * 0.03);
  ctx.lineTo(top.x + c + 1, edge + c * 0.03);
  for (let i = blades; i >= 0; i--) {
    const climb = 0.1 + hash(x * 7 + i, y + 31, z) * 0.12;
    ctx.lineTo(top.x + (c * (i + 0.5)) / blades, edge - c * climb);
    ctx.lineTo(top.x + (c * i) / blades, edge - c * 0.06);
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = under.light;
  ctx.fillRect(top.x - 1, edge - c * 0.04, c + 2, c * 0.09);
  // A few blades hanging, swaying.
  for (let i = 0; i < 3; i++) {
    const r = hash(x, y * 5 + i + 50, z + 3);
    if (r < 0.3) continue;
    const bx = top.x + c * (0.15 + 0.35 * i + r * 0.1);
    const sway = Math.sin(frame.time * 1.6 + r * 9 + x + 2) * c * 0.025;
    ctx.beginPath();
    ctx.moveTo(bx - c * 0.03, edge + c * 0.03);
    ctx.quadraticCurveTo(bx + sway * 0.5, edge + c * 0.12, bx + sway, edge + c * (0.15 + r * 0.1));
    ctx.quadraticCurveTo(bx + sway * 0.5, edge + c * 0.1, bx + c * 0.03, edge + c * 0.03);
    ctx.fill();
  }
}

/** What hangs under a walked ceiling: a tendril with a bell at its end, or a pair of leaves. */
function drawHangingSprig(frame: SceneFrame, x: number, y: number, z: number, top: Point, under: NonNullable<Theme['ceiling']>): void {
  const { ctx, cam, time } = frame;
  const c = cam.cell;
  const pick = hash(x * 11 + 3, y * 5 + 2, z * 3 + 8);
  if (pick < 0.6) return;
  const at = top.x + c * (0.2 + hash(x, y + 27, z) * 0.6);
  const base = top.y + c * 1.03;
  const sway = Math.sin(time * 1.2 + x * 1.9 + pick * 7) * c * 0.03;
  const length = c * (0.2 + hash(x + 3, y + 4, z) * 0.14);

  ctx.strokeStyle = under.dark;
  ctx.lineWidth = Math.max(1.25, c * 0.022);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(at, base);
  ctx.quadraticCurveTo(at + sway * 0.3, base + length * 0.6, at + sway, base + length);
  ctx.stroke();
  if (pick < 0.84) {
    // A bell, mouth down.
    ctx.fillStyle = PETALS[Math.floor(hash(x, y, z + 44) * PETALS.length)] ?? PETALS[0];
    ctx.beginPath();
    ctx.moveTo(at + sway - c * 0.05, base + length + c * 0.07);
    ctx.quadraticCurveTo(at + sway - c * 0.05, base + length - c * 0.02, at + sway, base + length - c * 0.02);
    ctx.quadraticCurveTo(at + sway + c * 0.05, base + length - c * 0.02, at + sway + c * 0.05, base + length + c * 0.07);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = under.light;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(at + sway + side * c * 0.035, base + length - c * 0.01, c * 0.05, c * 0.026, side * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** What the top of a block wears, and what small thing may stand on it, chapter family by chapter family. */
const TOPS: Readonly<Record<Theme['biome'], Dressing>> = {
  meadow: drawGrassFringe,
  ember: drawEmberSeam,
  givre: drawSnowCap,
  tore: drawMosaicFrieze,
  envers: drawGrassFringe,
  hyperspace: drawMosaicFrieze,
};

/** Dressings that only belong on an edge seen from the front: drawn across a floor in 3D they would stripe it. */
const EDGE_ONLY: ReadonlySet<Theme['biome']> = new Set(['givre', 'tore', 'hyperspace']);

const SPRIGS: Readonly<Record<Theme['biome'], Dressing>> = {
  meadow: drawSprig,
  ember: drawCinder,
  givre: drawFrostSprig,
  tore: drawTrinket,
  envers: drawSprig,
  hyperspace: drawTrinket,
};

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
  // With a block over it and none under it, what is here is someone's ground all the same:
  // whoever falls upward stands on that ceiling, and what they tread hangs from it. Read off
  // the level as built: a slab crumbling under a plate does not send the plate to the ceiling.
  // Only where clones fall upward: elsewhere nobody can stand there, and nothing changes.
  const hung = (world.level.antipode || world.level.gravity !== 'normal') && cellOf(world.level, x, y + 1, z)?.solid === true && cellOf(world.level, x, y - 1, z)?.solid !== true;
  const roof = project(cam, x + 0.5, y + 1, z + 0.5);

  if (cell.plate !== null && !wireOnly && hung) {
    const color = channelColor(cell.plate);
    const pressed = world.live.has(cell.plate);
    const thick = pressed ? 0.035 : 0.11;
    const front = project(cam, x + 0.12, y + 1, z + 0.14);
    if (pressed) glow(ctx, roof.x, roof.y, c * 0.75, color, 0.5);
    ctx.fillStyle = pressed ? COLORS.paper : color;
    ctx.fillRect(front.x, front.y - 1, c * 0.76, c * thick + 1);
    ctx.strokeStyle = 'rgba(20, 16, 30, 0.6)';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(front.x, front.y - 1, c * 0.76, c * thick + 1);
  } else if (cell.plate !== null && !wireOnly) {
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

  if (cell.checkpoint && !wireOnly) {
    const active = world.checkpoint === cellIndex(world.level.size, vec(x, y, z));
    ctx.save();
    ctx.translate(centre.x, centre.y);
    ctx.strokeStyle = active ? '#ffffff' : '#89ffe3';
    ctx.lineWidth = Math.max(2, c * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, c * 0.12);
    ctx.lineTo(0, c * 0.48);
    ctx.stroke();
    ctx.rotate(Math.PI / 4);
    if (active) {
      ctx.fillStyle = '#79ffcf';
      ctx.fillRect(-c * 0.12, -c * 0.12, c * 0.24, c * 0.24);
    }
    ctx.strokeRect(-c * 0.14, -c * 0.14, c * 0.28, c * 0.28);
    ctx.restore();
  }
  if (cell.reality) drawRealityPortal(frame, centre, c);
  else if (cell.exit) drawExit(frame, feet, c);

  // A door cell stacked on a wire barrier of the same channel only makes the barrier two
  // cells tall for the rules; the ring on the wire is all there is to see.
  const under = cellOf(world.level, x, y - 1, z);
  const partOfBarrier = cell.door !== null && cell.wire === null && under !== null && under.wire !== null && under.door === cell.door;

  if (cell.door !== null && !partOfBarrier) {
    const open = frame.doorOpen(cellIndex(world.level.size, vec(x, y, z)));
    if (cell.wire !== null) drawBarrier(ctx, centre, c, channelColor(cell.door), open, time);
    else if (!wireOnly) drawGate(ctx, project(cam, x, y + 1, z + 0.5), c, channelColor(cell.door), open, theme, time, cell.inverted);
  }

  if (cell.lever !== null && !wireOnly) {
    const color = channelColor(cell.lever);
    const on = world.toggled.includes(cell.lever);
    if (hung) {
      // The same lever, turned over about the ceiling it is fixed to.
      ctx.save();
      ctx.translate(0, roof.y);
      ctx.scale(1, -1);
      ctx.translate(0, -roof.y);
      drawLever(ctx, roof, c, color, on, theme);
      ctx.restore();
    } else {
      drawLever(ctx, feet, c, color, on, theme);
    }
  }

  if (cell.anchor) {
    if (!wireOnly) {
      // The foot of the anchor: on the floor, or on the ceiling when that is all there is.
      const foot = hung ? roof : feet;
      const rise = hung ? c * 0.14 : -c * 0.14;
      ctx.fillStyle = theme.rockDark;
      ctx.beginPath();
      ctx.moveTo(foot.x - c * 0.2, foot.y);
      ctx.lineTo(foot.x - c * 0.12, foot.y + rise);
      ctx.lineTo(foot.x + c * 0.12, foot.y + rise);
      ctx.lineTo(foot.x + c * 0.2, foot.y);
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

/** A rift with daylight behind it, surrounded by the broken outlines of its frame. */
function drawRealityPortal({ ctx, time }: SceneFrame, centre: Point, c: number): void {
  glow(ctx, centre.x, centre.y, c * 1.25, '#aaffed', 0.65);
  ctx.save();
  ctx.translate(centre.x, centre.y);
  const daylight = ctx.createLinearGradient(0, -c * 0.48, 0, c * 0.48);
  daylight.addColorStop(0, '#92dcff');
  daylight.addColorStop(0.58, '#fff9d3');
  daylight.addColorStop(0.59, '#8fc48e');
  daylight.addColorStop(1, '#335867');
  ctx.fillStyle = daylight;
  ctx.beginPath();
  ctx.ellipse(0, 0, c * 0.29, c * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = ['#ffffff', '#a2ffe9', '#ccb7ff'][i]!;
    ctx.lineWidth = Math.max(1, c * 0.028);
    const angle = time * 0.8 + i * 2.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, c * (0.33 + i * 0.045), c * (0.50 + i * 0.035), Math.sin(angle) * 0.28, angle, angle + 4.7);
    ctx.stroke();
  }
  ctx.restore();
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
  ctx.strokeStyle = theme.metal;
  ctx.lineWidth = Math.max(3, c * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  segmentPath(ctx, feet.x, feet.y - c * 0.1, tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = on ? color : withAlpha(color, 0.55);
  ctx.beginPath();
  ctx.arc(tipX, tipY, c * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.ink;
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
  // Posts of dark rock vanish against a dark sky: edge them with the terrain's own line.
  if (theme.rim) {
    ctx.strokeStyle = theme.outline;
    ctx.lineWidth = 1.25;
    ctx.strokeRect(topLeft.x + c * 0.1, topLeft.y, c * 0.12, c);
    ctx.strokeRect(topLeft.x + c * 0.78, topLeft.y, c * 0.12, c);
  }
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

/** Side of a crate, in cells. */
const CRATE_SIZE = 0.88;

function drawCrate(frame: SceneFrame, crate: CratePose): void {
  const { ctx, cam, tiles } = frame;
  const c = cam.cell;
  const size = CRATE_SIZE;
  const x0 = crate.x + (1 - size) / 2;
  const z0 = crate.z + (1 - size) / 2;
  const top = project(cam, x0, crate.y + size, z0);
  const s = size * c;
  if (crate.slide !== null) drawStreaks(frame, project(cam, crate.x + 0.5, crate.y, crate.z + 0.5), crate.slide, size / 2, 1);
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
 * Lines of spray trailing whatever slides on ice: the way to see that it is carried and not
 * walking, and which way. `at` is the middle of the soles on screen, `half` half the width
 * of what slides, `up` which side of the soles the body is on.
 */
function drawStreaks(frame: SceneFrame, at: Point, slide: Slide, half: number, up: 1 | -1): void {
  const { ctx, cam, time } = frame;
  const c = cam.cell;
  const vx = slide.x + DEPTH_X * cam.depth * slide.z;
  const vy = -DEPTH_Y * cam.depth * slide.z;
  const speed = Math.hypot(vx, vy);
  if (speed < 0.4) return;
  const ux = vx / speed;
  const uy = vy / speed;
  const reach = Math.min(1, 0.35 + speed / 6);
  const saved = ctx.globalAlpha;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const flicker = 0.7 + 0.3 * Math.sin(time * 23 + i * 2.1);
    const lift = up * c * (0.035 + i * 0.06);
    const sx = at.x - ux * c * (half + 0.05 + i * 0.06);
    const sy = at.y - uy * c * (half + 0.05 + i * 0.06) - lift;
    const length = c * (0.62 - i * 0.14) * reach * flicker;
    // Ice blue under white: the trail must show on a pale morning sky as well as at night.
    for (const [color, extra] of [
      [COLORS.iceDeep, 2.5],
      ['#ffffff', 0],
    ] as const) {
      const trail = ctx.createLinearGradient(sx, sy, sx - ux * length, sy - uy * length);
      trail.addColorStop(0, withAlpha(color, extra > 0 ? 0.75 : 1));
      trail.addColorStop(1, withAlpha(color, 0));
      ctx.strokeStyle = trail;
      ctx.lineWidth = Math.max(1.5, c * (0.045 - i * 0.008)) + extra;
      ctx.beginPath();
      segmentPath(ctx, sx, sy, sx - ux * length, sy - uy * length);
      ctx.stroke();
    }
  }
  // A little bow wave where the soles cut the ice.
  ctx.globalAlpha = saved * reach;
  for (const [color, extra] of [
    [COLORS.iceDeep, 2],
    ['#ffffff', 0],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, c * 0.03) + extra;
    ctx.beginPath();
    ctx.moveTo(at.x + ux * c * (half - 0.02), at.y + uy * c * (half - 0.02) - up * c * 0.01);
    ctx.quadraticCurveTo(at.x + ux * c * (half + 0.12), at.y + uy * c * (half + 0.12) - up * c * 0.02, at.x + ux * c * (half + 0.15), at.y + uy * c * (half + 0.15) - up * c * 0.13);
    ctx.stroke();
  }
  ctx.globalAlpha = saved;
}

/**
 * Where a body in the air would come to rest: the height of the first thing in the way of its
 * fall, downward for most, upward for an antipode. Across a joined bottom and top the search
 * goes on through the seam, and the height returned then lies outside the grid. Null when
 * nothing is in the way.
 */
function landingOf(frame: SceneFrame, pose: ActorPose): number | null {
  const { world } = frame;
  const { level } = world;
  const { x, z } = pose.cell;
  const fall = -pose.up;
  // The first row the soles could meet, then on in the way of the fall.
  let row = fall < 0 ? Math.floor(pose.y + 0.5) - 1 : Math.ceil(pose.y - 0.5);
  for (let step = 0; ; step++, row += fall) {
    // Round a joined axis once; otherwise as far as the grid goes in the way of the fall.
    if (level.wrap.y ? step >= level.size.h : fall < 0 ? row < 0 : row >= level.size.h) return null;
    const at = seamCell(level, x, row, z);
    const body = world.bodies.some((a) => a.id !== pose.id && a.cell.x === at.x && a.cell.y === at.y && a.cell.z === at.z);
    const door = cellAt(level, at)?.door != null && frame.doorOpen(cellIndex(level.size, at)) < 0.5;
    if (isSolid(world, at) || door || body || world.crates.some((k) => k.x === at.x && k.y === at.y && k.z === at.z)) return fall < 0 ? row + 1 : row;
  }
}

/**
 * The shadow of a body, at the height `ground`, the body being `drop` cells from it. Standing,
 * it lies under the soles, on the floor or on the ceiling. In the air it stays on whatever is
 * in the way of the fall: it shows where the body would come down, and the gap between the
 * two is what says "this one is not standing".
 */
function drawShadow(frame: SceneFrame, pose: ActorPose, ground: number, drop: number): void {
  const { ctx, cam } = frame;
  const c = cam.cell;
  const at = project(cam, pose.x + 0.5, ground, pose.z + 0.5);
  const shrink = pose.airborne ? 1 / (1 + drop * 0.9) : 1;
  const saved = ctx.globalAlpha;
  ctx.globalAlpha = saved * (pose.airborne ? 0.3 * shrink : 0.28) * pose.alpha;
  ctx.fillStyle = '#0b0a14';
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, c * 0.26 * shrink, c * (0.05 + 0.05 * cam.depth) * shrink, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = saved;
}

function drawActor(frame: SceneFrame, pose: ActorPose): void {
  const { ctx, cam, time } = frame;
  const c = cam.cell;
  const feet = project(cam, pose.x + 0.5, pose.y, pose.z + 0.5);
  const onWire = pose.dim === 1;

  if (!onWire && pose.airborne) {
    // Two short strokes beyond the soles: air, not ground.
    const saved = ctx.globalAlpha;
    ctx.globalAlpha = saved * 0.55 * pose.alpha;
    ctx.strokeStyle = COLORS.paper;
    ctx.lineWidth = Math.max(1.5, c * 0.03);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(feet.x + side * c * 0.14, feet.y + pose.up * c * 0.05);
      ctx.lineTo(feet.x + side * c * 0.14, feet.y + pose.up * c * 0.15);
    }
    ctx.stroke();
    ctx.globalAlpha = saved;
  }
  if (!onWire && pose.slide !== null) drawStreaks(frame, feet, pose.slide, 0.2, pose.up);
  if (pose.plunge !== 0) {
    // Lines of air left behind by an endless fall: the eye follows them from one edge to the other.
    const saved = ctx.globalAlpha;
    const way = Math.sign(pose.plunge);
    const mid = project(cam, pose.x + 0.5, pose.y + pose.up * TALL * 0.5, pose.z + 0.5);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, c * 0.03);
    for (const [dx, from, length] of [
      [-0.2, 0.5, 0.75],
      [0, 0.62, 1.05],
      [0.2, 0.5, 0.6],
    ] as const) {
      const y0 = mid.y + way * c * from;
      const y1 = y0 + way * c * length * Math.min(1, Math.abs(pose.plunge) / 19);
      const air = ctx.createLinearGradient(0, y0, 0, y1);
      air.addColorStop(0, withAlpha(COLORS.paper, 0.6));
      air.addColorStop(1, withAlpha(COLORS.paper, 0));
      ctx.strokeStyle = air;
      ctx.globalAlpha = saved * pose.alpha;
      ctx.beginPath();
      segmentPath(ctx, mid.x + dx * c, y0, mid.x + dx * c, y1);
      ctx.stroke();
    }
    ctx.globalAlpha = saved;
  }

  const look = frame.lookOf(pose);
  const clone = pose.role === 'clone';
  drawCharacter(ctx, feet.x, feet.y, c, {
    role: pose.role,
    reflection: frame.world.level.mirror && clone,
    boots: look.boots,
    inverted: pose.up < 0,
    antipode: frame.world.level.antipode && clone,
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

  // With several clones on stage, each wears its number over its head, which for an
  // antipode is under it: the tapes in the HUD use the same.
  if (clone && frame.world.bodies.length > 2 && pose.alpha > 0.5) {
    const head = project(cam, pose.x + 0.5, pose.y + (onWire ? 0.95 : pose.up * 1.02), pose.z + 0.5);
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

// ------------------------------------------------------------------------------ seams

/**
 * The joined edges of a level that wraps, each pair in one thread so that the eye ties them
 * together: gold stitches up the left and right sides, a row of rose beads along the bottom
 * and top. Both threads move, at the same pace on the two edges of a pair, because they are
 * one line. In 3D an edge is a whole wall of the volume, and the thread runs round it.
 */
function drawSeams(frame: SceneFrame): void {
  const { ctx, cam, world, time } = frame;
  const { level } = world;
  if (!level.wrap.x && !level.wrap.y) return;
  const { w, h, d } = level.size;
  const c = cam.cell;
  // From inside a wire the seams fade with the world, without going out.
  const strength = 0.35 + 0.65 * cam.world;
  const deep = cam.depth;

  /** The wall of the volume through a → b at the front and a2 → b2 at the back. */
  const wall = (color: string, a: Point, b: Point, b2: Point, a2: Point): void => {
    if (deep < 0.02) return;
    ctx.globalAlpha = strength * deep;
    ctx.fillStyle = withAlpha(color, 0.07);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(a2.x, a2.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = withAlpha(color, 0.45);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    segmentPath(ctx, a.x, a.y, a2.x, a2.y);
    segmentPath(ctx, b.x, b.y, b2.x, b2.y);
    segmentPath(ctx, a2.x, a2.y, b2.x, b2.y);
    ctx.stroke();
  };

  /** A soft light lying along an edge: long one way, thin the other, fading out toward its ends. */
  const halo = (color: string, cx: number, cy: number, rx: number, ry: number): void => {
    const r = Math.max(rx, ry);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx / r, ry / r);
    const light = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    light.addColorStop(0, withAlpha(color, 0.34));
    light.addColorStop(0.6, withAlpha(color, 0.2));
    light.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  if (level.wrap.x) {
    for (const [edge, out] of [
      [0, -1],
      [w, 1],
    ] as const) {
      const a = project(cam, edge, 0, 0);
      const b = project(cam, edge, h, 0);
      wall(COLORS.seamX, a, b, project(cam, edge, h, d), project(cam, edge, 0, d));
      // A glow leaning outward, toward where the other side is shown.
      ctx.globalAlpha = strength;
      halo(COLORS.seamX, a.x + out * c * 0.12, (a.y + b.y) / 2, c * 0.8, ((a.y - b.y) / 2) * 1.06);
      // The thread, and its stitches climbing: the same on the left and on the right.
      ctx.lineCap = 'round';
      for (const [color, extra] of [
        ['rgba(20, 16, 30, 0.4)', 2],
        [COLORS.seamX, 0],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, c * 0.03) + extra;
        ctx.beginPath();
        segmentPath(ctx, a.x, a.y, b.x, b.y);
        ctx.stroke();
        ctx.lineWidth = Math.max(2, c * 0.045) + extra;
        ctx.beginPath();
        const climb = (time * 0.5) % STITCH;
        for (let y = climb; y < h; y += STITCH) {
          const at = a.y - y * c;
          segmentPath(ctx, a.x - c * 0.1, at + c * 0.05, a.x + c * 0.1, at - c * 0.05);
        }
        ctx.stroke();
      }
    }
  }

  if (level.wrap.y) {
    for (const [edge, out] of [
      [0, -1],
      [h, 1],
    ] as const) {
      const a = project(cam, 0, edge, 0);
      const b = project(cam, w, edge, 0);
      wall(COLORS.seamY, a, b, project(cam, w, edge, d), project(cam, 0, edge, d));
      ctx.globalAlpha = strength;
      // Screen y grows downward: outward from the bottom edge is further down.
      halo(COLORS.seamY, (a.x + b.x) / 2, a.y - out * c * 0.12, ((b.x - a.x) / 2) * 1.06, c * 0.8);
      // Beads running along the edge, the same along the bottom and along the top.
      const run = (time * 0.5) % BEAD;
      for (const [color, r] of [
        ['rgba(20, 16, 30, 0.4)', Math.max(2.5, c * 0.05) + 1],
        [COLORS.seamY, Math.max(2.5, c * 0.05)],
      ] as const) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let x = run; x < w; x += BEAD) {
          ctx.moveTo(a.x + x * c + r, a.y);
          ctx.arc(a.x + x * c, a.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
  }
}

/** Cells between two stitches of a side seam, and between two beads of a bottom and top one. */
const STITCH = 0.5;
const BEAD = 0.34;
