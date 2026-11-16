import { vec } from '../core/grid';
import type { Actor, Level, World } from '../core/types';
import { type Body, FPS, type FlowWorld, type FrameInput, doorClosed, initialFlow, liveChannels, outcomeOfFlow, playerOfFlow, stepFlow } from '../flow/physics';
import { type FlowSession, inputsAtFlow, newFlowSession, parseTape, rewindFlow } from '../flow/tape';
import type { Assets } from './assets';
import type { Audio } from './audio';
import type { Hud, LevelEntry } from './hud';
import { type Camera, type Viewport, approach, cameraTarget } from './render/camera';
import { Effects, drawBackdrop } from './render/fx';
import type { ActorPose } from './render/motion';
import { type LevelGeometry, buildGeometry, drawScene } from './render/scene';
import { COLORS, themeFor } from './themes';

const STEP_MS = 1000 / FPS;
/** Never try to catch up more than this many steps in one frame: a stalled tab must not fast-forward. */
const MAX_STEPS_PER_FRAME = 5;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);

/** The time to beat for the lightning mark: the intended run with room for a few hesitations. */
export function flowTarget(level: Level): number | null {
  const tape = level.tape === null ? null : parseTape(level.tape);
  if (tape === null || !tape.ok) return null;
  const frames = tape.value.reduce((sum, loop) => sum + loop.length, 0);
  return Math.ceil((frames / FPS) * 1.25 + tape.value.length);
}

/**
 * Plays a flow level: reads held keys into one input per frame, steps the physics at a
 * fixed rate, and draws the result with the scene of the step game. A loop starts on the
 * first key, so the clones always leave with the player.
 */
export class FlowGame {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly effects = new Effects();
  private readonly held = new Set<string>();
  private readonly doors = new Map<number, number>();
  private readonly landedAt = new Map<number, number>();
  private entry: LevelEntry | null = null;
  private session: FlowSession | null = null;
  private world: FlowWorld | null = null;
  private geometry: LevelGeometry | null = null;
  private cam: Camera | null = null;
  private view: Viewport = { width: 0, height: 0 };
  private last = 0;
  private debt = 0;
  private running = false;
  private elapsedMs = 0;
  private flash = 0;
  private stepAt = 0;
  private pendingWin: number | null = null;
  private pendingShift = false;
  private fallTimer: number | null = null;
  /** Where the hero was when it last made progress, to notice a dead end. */
  private progressX = 0;
  private progressAt = 0;
  private stalled = false;
  /** After a fall, a direction still held starts the new loop by itself from this time on. */
  private resumeAt: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: Assets,
    private readonly hud: Hud,
    private readonly audio: Audio,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser');
    this.ctx = ctx;
  }

  start(entry: LevelEntry): void {
    this.entry = entry;
    this.session = newFlowSession(entry.level);
    this.geometry = buildGeometry(entry.level);
    this.elapsedMs = 0;
    this.pendingWin = null;
    this.effects.clear();
    this.reset();
  }

  /** Back to the start of the loop, with the clones already recorded. */
  private reset(): void {
    if (!this.session) return;
    this.world = initialFlow(this.session.level, this.session.loops.length);
    this.session = { ...this.session, current: [] };
    this.running = false;
    this.debt = 0;
    this.doors.clear();
    this.landedAt.clear();
    this.cam = null;
    this.flash = 1;
    this.stalled = false;
    this.progressAt = 0;
    if (this.fallTimer !== null) window.clearTimeout(this.fallTimer);
    this.fallTimer = null;
    this.refreshHud();
  }

  get outcome(): 'playing' | 'won' | 'fallen' {
    return this.world ? outcomeOfFlow(this.world) : 'playing';
  }

  /** Seconds of the winning run, once, when the exit has just been reached. */
  takeWin(): number | null {
    const seconds = this.pendingWin;
    this.pendingWin = null;
    return seconds;
  }

  /** State for automated checks. */
  debug(): { outcome: string; x: number; y: number; loops: number; seconds: number } {
    const p = this.world ? playerOfFlow(this.world) : null;
    return { outcome: this.outcome, x: p?.x ?? 0, y: p?.y ?? 0, loops: this.session?.loops.length ?? 0, seconds: Math.round(this.elapsedMs / 100) / 10 };
  }

  keyDown(code: string, shift: boolean): void {
    if (!this.session || !this.world) return;
    switch (code) {
      case 'KeyR':
        if (shift) {
          // Start the level over, without any clone.
          this.session = newFlowSession(this.session.level);
          this.elapsedMs = 0;
          this.audio.play('undo');
          this.reset();
        } else if (this.session.current.length > 0) {
          this.session = rewindFlow(this.session);
          this.audio.play('rewind');
          this.reset();
        }
        return;
      case 'KeyU':
      case 'Backspace':
        // Try the loop again: the clones stay, this attempt is forgotten.
        if (this.session.current.length > 0) {
          this.audio.play('undo');
          this.reset();
        }
        return;
      case 'KeyE':
        this.pendingShift = true;
        break;
      default:
        break;
    }
    this.held.add(code);
    this.resumeAt = null;
    if (this.outcome === 'playing' && !this.running) {
      this.running = true;
      // The opening line has been read: clear it once the run starts.
      window.setTimeout(() => this.refreshHud(), 1200);
    }
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  releaseAll(): void {
    this.held.clear();
  }

  private readInput(dim: 2 | 3): FrameInput {
    const any = (codes: ReadonlySet<string>): boolean => [...codes].some((code) => this.held.has(code));
    const x = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0);
    const z = dim === 3 ? (any(UP) ? 1 : 0) - (any(DOWN) ? 1 : 0) : 0;
    const jump = this.held.has('Space') || (dim === 2 && any(UP));
    const shift = this.pendingShift;
    this.pendingShift = false;
    return { x: x as -1 | 0 | 1, z: z as -1 | 0 | 1, jump, shift };
  }

  private simulate(now: number): void {
    if (!this.world || !this.session) return;
    const before = this.world;
    const input = this.readInput(playerOfFlow(before).dim);
    const next = stepFlow(before, inputsAtFlow(this.session, before.tick, input));
    this.session = { ...this.session, current: [...this.session.current, input] };
    this.world = next;
    this.elapsedMs += STEP_MS;
    this.cues(before, next, now);
  }

  /** Sounds and dust, read off the difference between two frames. */
  private cues(before: FlowWorld, next: FlowWorld, now: number): void {
    const theme = themeFor(next.level.world);
    for (const body of next.bodies) {
      const was = before.bodies[body.id];
      if (!was || was.status !== 'active') continue;
      const mine = body.role === 'player';
      if (body.status === 'fallen') {
        if (mine) this.audio.play('fall', 0.02);
        continue;
      }
      if (was.grounded && !body.grounded && body.vy > 4 && mine) this.audio.play('hop');
      if (!was.grounded && body.grounded) {
        this.landedAt.set(body.id, now);
        this.effects.dust(body.x, body.y, body.z, theme.haze);
        if (mine) this.audio.play('land');
      }
      if (mine && body.grounded && Math.abs(body.vx) + Math.abs(body.vz) > 2 && now - this.stepAt > 230) {
        this.stepAt = now;
        this.audio.play('step');
      }
      if (was.dim !== body.dim) {
        this.effects.ring(body.x, body.y + 0.5, body.z, COLORS.threshold, 0.7);
        if (mine) {
          this.audio.play(body.dim === 3 ? 'to3d' : 'to2d');
          this.refreshHud();
        }
      }
    }
    if (next.toggled.join() !== before.toggled.join()) this.audio.play('lever');
    if (next.broken.length > before.broken.length) this.audio.play('crumble');
    const live = liveChannels(next).size - liveChannels(before).size;
    if (live !== 0) this.audio.play(live > 0 ? 'plateOn' : 'plateOff');

    const outcome = outcomeOfFlow(next);
    // Standing still against something while a clone exists is probably a missed door.
    const hero = playerOfFlow(next);
    if (Math.abs(hero.x - this.progressX) > 0.2 || this.progressAt === 0) {
      this.progressX = hero.x;
      this.progressAt = next.tick;
      if (this.stalled) {
        this.stalled = false;
        this.refreshHud();
      }
    } else if (!this.stalled && next.tick - this.progressAt > FPS * 3 && this.session !== null && this.session.loops.length > 0) {
      this.stalled = true;
      this.refreshHud();
    }
    if (outcome !== 'playing' && outcomeOfFlow(before) === 'playing') {
      this.running = false;
      // A fall is not a menu: the loop starts over by itself, clones kept.
      if (outcome === 'fallen') {
        this.fallTimer = window.setTimeout(() => {
          if (this.outcome !== 'fallen') return;
          this.reset();
          // Whoever is still holding a key expects to be running again, not waiting.
          this.resumeAt = performance.now() + 350;
        }, 900);
      }
      if (outcome === 'won') {
        const p = playerOfFlow(next);
        for (const color of [COLORS.exit, COLORS.player, COLORS.paper]) this.effects.burst(p.x, p.y + 0.6, p.z, color, 18, 4.5);
        this.audio.play('win', 0.1);
        this.pendingWin = Math.round(this.elapsedMs / 100) / 10;
      }
      this.refreshHud();
    }
  }

  private refreshHud(): void {
    if (!this.entry || !this.session || !this.world) return;
    const { level } = this.session;
    const other = level.mirror ? 'reflet' : 'clone';
    const outcome = this.outcome;
    const message =
      outcome === 'fallen'
        ? 'Tombé dans le vide. La boucle recommence.'
        : outcome === 'won'
          ? ''
          : this.stalled
            ? `Bloqué ? U retente cette boucle. R recommence aussi l'enregistrement de ton ${other}.`
          : this.session.current.length === 0 && this.session.loops.length > 0
            ? `Ton ${other} part à ta première touche.`
            : this.session.current.length < 60
              ? (level.tip ?? '')
              : '';
    this.hud.updateFlow(this.entry, {
      dim: playerOfFlow(this.world).dim,
      loops: this.session.loops.length,
      message,
      tone: outcome === 'fallen' ? 'fallen' : '',
    });
  }

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.view = { width, height };
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.cam = null;
  }

  /** The step game's scene wants a world on the grid: every body in the cell its feet are in. */
  private shadow(world: FlowWorld): World {
    const actors: Actor[] = world.bodies.map((b) => ({
      id: b.id,
      role: b.role,
      pos: vec(Math.floor(b.x), Math.max(0, Math.floor(b.y + 0.01)), Math.floor(b.z)),
      dim: b.dim,
      status: b.status,
      air: b.grounded ? 0 : 1,
    }));
    return { level: world.level, tick: world.tick, actors, crates: [], toggled: world.toggled, broken: world.broken };
  }

  frame(now: number): void {
    const { world, session, geometry } = this;
    if (!world || !session || !geometry) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.canvas.clientWidth !== this.view.width || this.canvas.clientHeight !== this.view.height) this.resize();
    const { ctx, view } = this;
    if (view.width === 0 || view.height === 0) return;

    if (!this.running && this.resumeAt !== null && now >= this.resumeAt) {
      this.resumeAt = null;
      if (this.held.size > 0 && this.outcome === 'playing') this.running = true;
    }
    if (this.running) {
      this.debt += dt * 1000;
      for (let i = 0; i < MAX_STEPS_PER_FRAME && this.debt >= STEP_MS && this.running; i++) {
        this.debt -= STEP_MS;
        this.simulate(now);
      }
      if (this.debt > STEP_MS * MAX_STEPS_PER_FRAME) this.debt = 0;
    }
    const current = this.world ?? world;
    const shadow = this.shadow(current);
    this.hud.setFlowClock(this.elapsedMs / 1000, flowTarget(current.level), this.elapsedMs > 0);

    const target = cameraTarget(shadow, view);
    if (this.cam === null) this.cam = target;
    else approach(this.cam, target, 1 - Math.exp((-dt * 1000) / 110));
    const cam = this.cam;

    // Doors ease open and shut.
    const live = liveChannels(current);
    const { size } = current.level;
    current.level.cells.forEach((cell, index) => {
      if (cell.door === null) return;
      const x = index % size.w;
      const y = Math.floor(index / size.w) % size.h;
      const z = Math.floor(index / (size.w * size.h));
      const goal = doorClosed(current, live, x, y, z) ? 0 : 1;
      const at = this.doors.get(index) ?? goal;
      this.doors.set(index, Math.abs(goal - at) < 0.01 ? goal : at + (goal - at) * (1 - Math.exp((-dt * 1000) / 70)));
    });
    this.effects.update(dt);

    const time = now / 1000;
    const poses: ActorPose[] = current.bodies
      .filter((b) => b.status !== 'fallen' || b.y > -3)
      .map((b: Body) => ({
        id: b.id,
        role: b.role,
        dim: b.dim,
        // Before the first key everyone stands on the start: fan the clones out behind the hero.
        x: b.x - 0.5 - (current.tick === 0 ? (current.bodies.length - 1 - b.id) * 0.22 : 0),
        y: b.y,
        z: b.z - 0.5,
        cell: vec(Math.floor(b.x), Math.max(0, Math.floor(b.y + 0.01)), Math.floor(b.z)),
        alpha: b.status === 'fallen' ? 0.5 : 1,
        stride: b.grounded && Math.abs(b.vx) + Math.abs(b.vz) > 0.6 ? (((b.x + b.z) * 1.1) % 1 + 1) % 1 : null,
        airborne: !b.grounded,
        heading: (Math.sign(b.vx) || 0) as -1 | 0 | 1,
      }));

    const theme = themeFor(current.level.world);
    const tiles = this.assets.tiles[(current.level.world - 1) % this.assets.tiles.length];
    if (!tiles) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = 1;
    drawBackdrop(ctx, this.assets.backgrounds[(current.level.world - 1) % this.assets.backgrounds.length], theme, cam, view, time);
    drawScene({
      ctx,
      cam,
      world: shadow,
      geometry,
      tiles,
      theme,
      time,
      actors: poses,
      crates: [],
      lookOf: (pose) => ({
        joy: pose.role === 'player' && this.outcome === 'won',
        facing: current.bodies[pose.id]?.facing ?? 1,
        squash: Math.min(1, Math.max(0, 1 - (now - (this.landedAt.get(pose.id) ?? -1e9)) / 200)),
      }),
      doorOpen: (cell) => this.doors.get(cell) ?? (current.level.cells[cell]?.door ? 0 : 1),
    });
    this.effects.draw(ctx, cam);
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(255, 220, 160, ${this.flash * 0.25})`;
      ctx.fillRect(0, 0, view.width, view.height);
      this.flash *= Math.exp(-dt * 8);
    }
  }
}
