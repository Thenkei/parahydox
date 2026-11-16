import { cellAt, vec } from '../../core/grid';
import { wireHeading } from '../../core/step';
import type { Dir, Vec3, World } from '../../core/types';
import { isDoorClosed, outcomeOf, playerOf } from '../../core/world';
import type { Assets } from '../assets';
import { COLORS, themeFor } from '../themes';
import { type Camera, type Viewport, approach, cameraTarget, project } from './camera';
import { Effects, drawBackdrop } from './fx';
import { type ActorPose, fanOut, poseActors, poseCrates, stepDuration } from './motion';
import { type LevelGeometry, buildGeometry, drawScene } from './scene';

interface Rewind {
  /** The loop just played, latest world first. */
  readonly frames: readonly World[];
  readonly startedAt: number;
  readonly duration: number;
  readonly then: World;
}

const CAMERA_MS = 110;
const DOOR_MS = 70;
const SQUASH_MS = 220;
const NUDGE_MS = 150;
/** Share of a step's normal length when the player is typing ahead. */
const HURRY = 0.6;

const NUDGE: Readonly<Record<Dir, { x: number; z: number }>> = {
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
  up: { x: 0, z: 1 },
  down: { x: 0, z: -1 },
};

/**
 * Owns the canvas and everything that moves on it. The stage is handed immutable worlds
 * and decides how to get from the one on screen to the next: a played step glides, a
 * change of dimension moves the camera, a rewind plays the loop backwards.
 */
export class Stage {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly effects = new Effects();
  private view: Viewport = { width: 0, height: 0 };
  private cam: Camera;
  private world: World;
  private previous: World | null = null;
  private geometry: LevelGeometry;
  private stepStartedAt = 0;
  private stepMs = 1;
  private rewinding: Rewind | null = null;
  private flash = 0;
  private shake = 0;
  private nudge: { dir: Dir; at: number } | null = null;
  /** Clones whose key press was just lost, with the time it happened. */
  private readonly misses = new Map<number, number>();
  /** Below 1 while more keys are waiting: the current step plays faster. */
  private pace = 1;
  private lastFrame = 0;
  /**
   * The time of the frame being produced. Animations start on this clock, not on
   * `performance.now()`: when the main thread runs late the two drift apart, and an
   * animation dated in the future would be drawn with a negative progress.
   */
  private clock = performance.now();
  private readonly facing = new Map<number, 1 | -1>();
  private readonly landedAt = new Map<number, number>();
  private readonly doors = new Map<number, number>();
  /** Clones being held back with T: each wears a pause mark until it is let go. */
  held: readonly number[] = [];
  /** Key shown above the hero when an action is available where it stands. */
  prompt: string | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: Assets,
    world: World,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser');
    this.ctx = ctx;
    this.world = world;
    this.geometry = buildGeometry(world.level);
    this.cam = cameraTarget(world, this.view);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** Sets the clock for whatever is started before this frame is drawn. */
  sync(now: number): void {
    this.clock = now;
  }

  /** True while an animation should hold back the next input. */
  get busy(): boolean {
    if (this.rewinding !== null) return true;
    if (this.previous !== null) return true;
    const target = cameraTarget(this.world, this.view);
    return Math.abs(target.depth - this.cam.depth) > 0.25 || Math.abs(target.world - this.cam.world) > 0.25;
  }

  /** Shows a world with no transition: new level, undo, restart. */
  cut(world: World): void {
    const levelChanged = world.level !== this.world.level;
    this.world = world;
    this.previous = null;
    this.rewinding = null;
    this.flash = 1;
    if (levelChanged) {
      this.geometry = buildGeometry(world.level);
      this.effects.clear();
      this.facing.clear();
      this.landedAt.clear();
      this.misses.clear();
    }
    this.doors.clear();
    this.cam = cameraTarget(world, this.view);
  }

  /**
   * Animates one played step and returns how long it takes, in milliseconds.
   * `pressed` is the direction asked for, so that a blocked move still shows the attempt.
   */
  step(prev: World, next: World, pressed: Dir | null = null, lostClones: readonly number[] = []): number {
    this.previous = prev;
    this.world = next;
    this.stepStartedAt = this.clock;
    for (const id of lostClones) {
      const clone = next.actors[id];
      this.misses.set(id, this.stepStartedAt);
      if (clone) this.effects.burst(clone.pos.x + 0.5, clone.pos.y + 0.6, clone.pos.z + 0.5, COLORS.clone, 6, 1.4);
    }
    this.stepMs = stepDuration(prev, next);

    const before = playerOf(prev);
    const after = playerOf(next);
    const stayed = before.pos.x === after.pos.x && before.pos.y === after.pos.y && before.pos.z === after.pos.z;
    if (stayed && before.dim === after.dim) {
      // Blocked: lean into the obstacle. Waiting: a small breath.
      if (pressed !== null) this.nudge = { dir: pressed, at: this.stepStartedAt };
      else this.landedAt.set(after.id, this.stepStartedAt - SQUASH_MS * 0.55);
    }
    if (before.dim !== after.dim) this.shake = Math.max(this.shake, 0.5);

    // A slab that gives way goes in a puff of pale dust; a lever that flips throws sparks.
    const { size } = next.level;
    for (const index of next.broken) {
      if (prev.broken.includes(index)) continue;
      const at = positionOf(size, index);
      this.effects.burst(at.x + 0.5, at.y + 0.85, at.z + 0.5, '#efe3c8', 12, 2.2);
      this.shake = Math.max(this.shake, 0.35);
    }
    next.level.cells.forEach((cell, index) => {
      if (cell.lever === null || prev.toggled.includes(cell.lever) === next.toggled.includes(cell.lever)) return;
      const at = positionOf(size, index);
      this.effects.burst(at.x + 0.5, at.y + 0.5, at.z + 0.5, COLORS.channels[cell.lever] ?? COLORS.paper, 8, 1.8);
    });
    if (before.dim !== after.dim) {
      const color = after.dim === 1 ? COLORS.wire : after.dim === 3 ? COLORS.threshold : COLORS.paper;
      this.effects.ring(after.pos.x + 0.5, after.pos.y + 0.5, after.pos.z + 0.5, color, 0.7);
      this.effects.burst(after.pos.x + 0.5, after.pos.y + 0.5, after.pos.z + 0.5, color, 14, 2.4);
    }
    if (outcomeOf(next) === 'won') {
      for (const color of [COLORS.exit, COLORS.player, COLORS.paper]) {
        this.effects.burst(after.pos.x + 0.5, after.pos.y + 0.6, after.pos.z + 0.5, color, 18, 4.5);
      }
      this.effects.ring(after.pos.x + 0.5, after.pos.y + 0.5, after.pos.z + 0.5, COLORS.exit, 0.9);
    }
    return this.stepMs;
  }

  /** More keys are waiting: finish the step on screen sooner. */
  hurry(pending: boolean): void {
    this.pace = pending ? HURRY : 1;
  }

  /** A key that could not do anything here: the level shudders, so the step is not silent. */
  refuse(): void {
    this.shake = Math.max(this.shake, 0.3);
  }

  /** The clones were told to wait: a ring closes on each of them. */
  hold(world: World): void {
    for (const actor of world.actors) {
      if (actor.role !== 'clone' || actor.status !== 'active') continue;
      this.effects.ring(actor.pos.x + 0.5, actor.pos.y + 0.5, actor.pos.z + 0.5, COLORS.clone, 0.45);
      this.landedAt.set(actor.id, this.clock - SQUASH_MS * 0.4);
    }
  }

  /** Plays the finished loop backwards, then shows the world the new loop starts from. */
  rewind(frames: readonly World[], then: World): number {
    const duration = Math.min(1100, 320 + frames.length * 38);
    this.previous = null;
    this.rewinding = { frames, startedAt: this.clock, duration, then };
    return duration;
  }

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.view = { width, height };
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.cam = cameraTarget(this.world, this.view);
  }

  /** Advances animations and draws one frame. */
  frame(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.clock = now;
    const time = now / 1000;
    // Observers can lag behind a layout change; never draw with a stale size.
    if (this.canvas.clientWidth !== this.view.width || this.canvas.clientHeight !== this.view.height) this.resize();
    const { ctx, view } = this;
    if (view.width === 0 || view.height === 0) return;

    // Which two worlds are on screen, and how far between them.
    let from: World | null = this.previous;
    let to = this.world;
    let t = 1;
    let duration = this.stepMs;
    let rewindProgress = 0;

    if (this.rewinding !== null) {
      const { frames, startedAt, duration: total, then } = this.rewinding;
      rewindProgress = Math.max(0, (now - startedAt) / total);
      if (rewindProgress >= 1 || frames.length < 2) {
        this.rewinding = null;
        this.cut(then);
        const start = playerOf(then).pos;
        this.effects.ring(start.x + 0.5, start.y + 0.5, start.z + 0.5, COLORS.clone, 0.8);
        from = null;
        to = then;
      } else {
        // Ease in: the tape starts slow and spins up.
        const position = rewindProgress ** 1.6 * (frames.length - 1);
        const index = Math.min(frames.length - 2, Math.floor(position));
        from = frames[index] ?? null;
        to = frames[index + 1] ?? to;
        t = position - index;
        duration = 1e6;
      }
    } else if (from !== null) {
      t = Math.max(0, (now - this.stepStartedAt) / (this.stepMs * this.pace));
      if (t >= 1) {
        this.finishStep(from, to, now);
        from = null;
        t = 1;
      }
    }

    approach(this.cam, cameraTarget(to, view), 1 - Math.exp((-dt * 1000) / (this.rewinding ? 55 : CAMERA_MS)));
    this.easeDoors(to, dt);
    this.effects.update(dt);

    const actors = fanOut(poseActors(from, to, Math.min(1, t), duration)).map((pose) => this.leaning(pose, now));
    const crates = poseCrates(from, to, Math.min(1, t), duration);
    for (const pose of actors) if (pose.heading !== 0) this.facing.set(pose.id, pose.heading);

    const theme = themeFor(to.level.world);
    const tiles = this.assets.tiles[(to.level.world - 1) % this.assets.tiles.length];
    if (!tiles) return;

    // Screen shake moves the level, never the sky or the HUD.
    const jolt = this.shake * this.cam.cell * 0.09;
    const shaken = { ...this.cam, ox: this.cam.ox + Math.sin(now * 0.09) * jolt, oy: this.cam.oy + Math.cos(now * 0.13) * jolt };
    this.shake *= Math.exp(-dt * 11);

    ctx.globalAlpha = 1;
    drawBackdrop(ctx, this.assets.backgrounds[(to.level.world - 1) % this.assets.backgrounds.length], theme, this.cam, view, time);
    drawScene({
      ctx,
      cam: shaken,
      world: to,
      geometry: this.geometry,
      tiles,
      theme,
      time,
      actors,
      crates,
      lookOf: (pose) => ({
        joy: pose.role === 'player' && outcomeOf(to) === 'won',
        facing: this.facing.get(pose.id) ?? 1,
        squash: Math.min(1, Math.max(0, 1 - (now - (this.landedAt.get(pose.id) ?? -1e9)) / SQUASH_MS)),
      }),
      doorOpen: (cell) => this.doors.get(cell) ?? 1,
    });
    this.effects.draw(ctx, shaken);
    this.drawMisses(actors, now);
    if (this.rewinding === null && from === null) {
      this.drawWireArrows(actors);
      this.drawHeld(actors);
      this.drawPrompt(actors, time);
    }
    if (this.rewinding !== null) this.drawTape(rewindProgress, time);

    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(255, 248, 234, ${this.flash * 0.22})`;
      ctx.fillRect(0, 0, view.width, view.height);
      this.flash *= Math.exp(-dt * 9);
    }
    this.drawVignette();
  }

  /** A blocked move still reads as an attempt: the hero leans into the obstacle and comes back. */
  private leaning(pose: ActorPose, now: number): ActorPose {
    if (this.nudge === null || pose.role !== 'player') return pose;
    const u = (now - this.nudge.at) / NUDGE_MS;
    if (u >= 1) {
      this.nudge = null;
      return pose;
    }
    const lean = Math.sin(Math.PI * u) * 0.13;
    const delta = NUDGE[this.nudge.dir];
    return { ...pose, x: pose.x + delta.x * lean, z: pose.dim === 3 ? pose.z + delta.z * lean : pose.z };
  }

  /** A step just ended: whoever came down lands with a squash and a puff of dust. */
  private finishStep(from: World, to: World, now: number): void {
    this.previous = null;
    const theme = themeFor(to.level.world);
    for (const actor of to.actors) {
      const before = from.actors[actor.id];
      if (!before || actor.status !== 'active' || actor.dim === 1) continue;
      const drop = before.pos.y - actor.pos.y;
      if (drop > 0) {
        this.landedAt.set(actor.id, now);
        this.effects.dust(actor.pos.x + 0.5, actor.pos.y, actor.pos.z + 0.5, theme.haze);
        // A long fall is felt by the whole screen.
        if (drop >= 2) this.shake = Math.max(this.shake, Math.min(1, 0.3 + drop * 0.15));
      } else if (before.pos.x !== actor.pos.x || before.pos.z !== actor.pos.z) {
        const drift = -Math.sign(actor.pos.x - before.pos.x) * 0.9;
        this.effects.speck(actor.pos.x + 0.5, actor.pos.y, actor.pos.z + 0.5, theme.haze, drift);
      }
    }
    for (const actor of to.actors) {
      const before = from.actors[actor.id];
      if (before && actor.status === 'active' && actor.dim === 1 && (before.pos.x !== actor.pos.x || before.pos.y !== actor.pos.y || before.pos.z !== actor.pos.z)) {
        this.effects.speck(before.pos.x + 0.5, before.pos.y + 0.5, before.pos.z + 0.5, COLORS.wire, 0);
      }
    }
    for (const crate of to.crates) {
      const before = from.crates.find((c) => c.id === crate.id);
      if (before && before.pos.y > crate.pos.y) {
        this.effects.dust(crate.pos.x + 0.5, crate.pos.y, crate.pos.z + 0.5, theme.haze);
        this.shake = Math.max(this.shake, 0.6);
      }
    }
  }

  private easeDoors(world: World, dt: number): void {
    const { level } = world;
    const amount = 1 - Math.exp((-dt * 1000) / DOOR_MS);
    level.cells.forEach((cell, index) => {
      if (cell.door === null) return;
      const pos = positionOf(level.size, index);
      const target = isDoorClosed(world, pos) ? 0 : 1;
      const current = this.doors.get(index);
      if (current === undefined) return void this.doors.set(index, target);
      if (current === target) return;
      // A door that starts moving throws a few sparks of its colour.
      if (current === 1 - target) {
        this.effects.burst(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5, COLORS.channels[cell.door] ?? COLORS.paper, 6, 1.6);
      }
      this.doors.set(index, Math.abs(target - current) < 0.01 ? target : current + (target - current) * amount);
    });
  }

  /** A lost key press shows as a cross rising from the clone that lost it. */
  private drawMisses(actors: readonly ActorPose[], now: number): void {
    const { ctx, cam } = this;
    for (const [id, at] of this.misses) {
      const u = (now - at) / 700;
      const pose = actors.find((a) => a.id === id);
      if (u >= 1 || !pose) {
        this.misses.delete(id);
        continue;
      }
      const p = project(cam, pose.x + 0.5, pose.y + 1.05 + u * 0.35, pose.z + 0.5);
      const r = cam.cell * 0.11;
      ctx.globalAlpha = 1 - u;
      ctx.strokeStyle = COLORS.ink;
      ctx.lineCap = 'round';
      for (const [width, color] of [[cam.cell * 0.1, COLORS.ink], [cam.cell * 0.055, '#ff6b6b']] as const) {
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y - r);
        ctx.lineTo(p.x + r, p.y + r);
        ctx.moveTo(p.x + r, p.y - r);
        ctx.lineTo(p.x - r, p.y + r);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * On a wire the arrow keys follow the wire, whatever way it runs on screen. Each way
   * out of the hero's node shows the key that takes it.
   */
  private drawWireArrows(actors: readonly ActorPose[]): void {
    const hero = actors.find((a) => a.role === 'player');
    if (!hero || hero.dim !== 1 || outcomeOf(this.world) !== 'playing') return;
    const { level } = this.world;
    const here = playerOf(this.world).pos;
    const ref = cellAt(level, here)?.wire;
    const cells = ref ? level.wires[ref.wire]?.cells : undefined;
    if (!ref || !cells) return;
    const { ctx, cam } = this;
    const glyphs: Readonly<Record<Dir, string>> = { left: '←', right: '→', up: '↑', down: '↓' };
    const size = Math.max(16, cam.cell * 0.3);
    for (const next of [cells[ref.index + 1], cells[ref.index - 1]]) {
      if (!next) continue;
      const reach = 0.62;
      const at = project(
        cam,
        here.x + 0.5 + (next.x - here.x) * reach,
        here.y + 0.5 + (next.y - here.y) * reach,
        here.z + 0.5 + (next.z - here.z) * reach,
      );
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = COLORS.ink;
      ctx.strokeStyle = COLORS.wire;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(at.x - size / 2, at.y - size / 2, size, size, size * 0.26);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.wire;
      ctx.font = `700 ${Math.round(size * 0.66)}px ui-rounded, 'Nunito', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyphs[wireHeading(here, next)], at.x, at.y + 1);
      ctx.globalAlpha = 1;
    }
  }

  private drawHeld(actors: readonly ActorPose[]): void {
    const { ctx, cam } = this;
    for (const id of this.held) {
      const pose = actors.find((a) => a.id === id);
      if (!pose) continue;
      const at = project(cam, pose.x + 0.5, pose.y + (pose.dim === 1 ? 1.0 : 1.22), pose.z + 0.5);
      const r = Math.max(9, cam.cell * 0.17);
      ctx.fillStyle = COLORS.ink;
      ctx.strokeStyle = COLORS.clone;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.clone;
      ctx.fillRect(at.x - r * 0.42, at.y - r * 0.48, r * 0.28, r * 0.96);
      ctx.fillRect(at.x + r * 0.14, at.y - r * 0.48, r * 0.28, r * 0.96);
    }
  }

  private drawPrompt(actors: readonly ActorPose[], time: number): void {
    const hero = actors.find((a) => a.role === 'player');
    if (this.prompt === null || !hero || outcomeOf(this.world) !== 'playing') return;
    const { ctx, cam } = this;
    const c = cam.cell;
    const lift = hero.dim === 1 ? 1.05 : 1.2;
    const at = project(cam, hero.x + 0.5, hero.y + lift + Math.sin(time * 3.2) * 0.04, hero.z + 0.5);
    const size = Math.max(20, c * 0.4);
    ctx.fillStyle = COLORS.paper;
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(at.x - size / 2, at.y - size / 2, size, size, size * 0.24);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 ${Math.round(size * 0.58)}px ui-rounded, 'Nunito', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.prompt, at.x, at.y + 1);
  }

  /** Rewind: the picture loses its colour to amber and tears like a tape played backwards. */
  private drawTape(progress: number, time: number): void {
    const { ctx, view } = this;
    const strength = Math.sin(Math.min(1, progress) * Math.PI);
    ctx.fillStyle = `rgba(255, 179, 71, ${0.16 * strength})`;
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.fillStyle = `rgba(255, 248, 234, ${0.1 * strength})`;
    for (let i = 0; i < 7; i++) {
      const y = ((i * 0.151 + time * 1.7) % 1) * view.height;
      ctx.fillRect(0, view.height - y, view.width, 2 + (i % 3) * 3);
    }
  }

  private drawVignette(): void {
    const { ctx, view } = this;
    const r = Math.hypot(view.width, view.height) / 2;
    const shade = ctx.createRadialGradient(view.width / 2, view.height / 2, r * 0.55, view.width / 2, view.height / 2, r);
    shade.addColorStop(0, 'rgba(8, 6, 18, 0)');
    shade.addColorStop(1, 'rgba(8, 6, 18, 0.42)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, view.width, view.height);
  }
}

function positionOf(size: { w: number; h: number }, index: number): Vec3 {
  const x = index % size.w;
  const y = Math.floor(index / size.w) % size.h;
  const z = Math.floor(index / (size.w * size.h));
  return vec(x, y, z);
}
