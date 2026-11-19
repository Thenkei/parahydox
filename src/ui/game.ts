import { cellAt, vec } from '../core/grid';
import type { Level, Vec3 } from '../core/types';
import {
  type Body,
  FPS,
  type FlowWorld,
  type FrameInput,
  HEIGHT,
  IDLE,
  PULSE_TICKS,
  type Transition,
  cellOfBody,
  doorClosed,
  fallOf,
  initialFlow,
  liveChannels,
  outcomeOfFlow,
  playerOfFlow,
  stepFlow,
  transitionAt,
} from '../flow/physics';
import { type FlowSession, inputsAtFlow, newFlowSession, parseTape, rewindFlow } from '../flow/tape';
import type { Assets } from './assets';
import type { Audio } from './audio';
import { type Hud, type LevelEntry, cloneWord } from './hud';
import { type Camera, type Viewport, approach, cameraTarget } from './render/camera';
import { Effects, drawBackdrop } from './render/fx';
import type { ActorPose, CratePose, Slide } from './render/motion';
import { type LevelGeometry, type SceneView, buildGeometry, drawScene } from './render/scene';
import { COLORS, themeFor } from './themes';

const STEP_MS = 1000 / FPS;
/** Never try to catch up more than this many steps in one frame: a stalled tab must not fast-forward. */
const MAX_STEPS_PER_FRAME = 5;
/** Frames the level's opening line stays up once the run has started. */
const TIP_FRAMES = 90;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);

const ACTIONS: Readonly<Record<Transition, string>> = {
  'onto-wire': 'entrer dans le fil',
  'off-wire': 'sortir du fil',
  unfold: 'déplier la profondeur',
  fold: 'replier sur cette coupe',
};

/** The time to beat for the lightning mark: the intended run with room for a few hesitations. */
export function targetSeconds(level: Level): number | null {
  const tape = level.tape === null ? null : parseTape(level.tape);
  if (tape === null || !tape.ok) return null;
  const frames = tape.value.reduce((sum, loop) => sum + loop.length, 0);
  // The intended run is a clean one: leave 40 % for a human hand, and the time a rewind takes.
  return Math.ceil((frames / FPS) * 1.4 + 1 + (tape.value.length - 1) * 1.5);
}

/** How fast something is carried along the ice, as the scene reads it. */
const slideOf = (moving: { readonly vx: number; readonly vz: number }): Slide => ({ x: moving.vx, z: moving.vz });

/** The grid cell a body is drawn in: whoever has left by the bottom, or by the top, stays in the last row. */
const cellOf = (level: Level, body: Body): Vec3 => {
  const cell = cellOfBody(level, body);
  return vec(cell.x, Math.min(level.size.h - 1, Math.max(0, cell.y)), cell.z);
};

/** A fall this fast is longer than any drop inside a level: it has been through the seam. */
const PLUNGE_PACE = 15;

/** Below this pace nothing is said to slide: it has all but stopped. */
const SLIDE_PACE = 0.5;

/**
 * Plays a level: reads held keys into one input per frame, steps the physics at a fixed
 * rate, and draws the result. A loop starts on the first key, so the clones always leave
 * with the player.
 */
export class Game {
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
  private pushAt = 0;
  private slideAt = 0;
  private pendingWin: number | null = null;
  private pendingShift = false;
  private pendingBoots = false;
  private checkpoint: { world: FlowWorld; session: FlowSession; cell: number } | null = null;
  private fallTimer: number | null = null;
  /** Help asked for with H: 0 none, 1 the level's opening line, 2 its hint. */
  private help: 0 | 1 | 2 = 0;
  /** Where the hero was when it last made progress, to notice a dead end. */
  private progressAt: { x: number; y: number; z: number; tick: number } | null = null;
  private stalled = false;
  /** After a fall, a direction still held starts the new loop by itself from this time on. */
  private resumeAt: number | null = null;
  /** What the HUD last showed, to leave the DOM alone when nothing changed. */
  private shown = '';
  /** A run played by the game itself (`?demo`): the loops still to play, and the one in progress. */
  private script: FrameInput[][] | null = null;

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
    this.geometry = buildGeometry(entry.level, themeFor(entry.level.world).ceiling !== null);
    this.elapsedMs = 0;
    this.pendingWin = null;
    this.help = 0;
    this.script = null;
    this.effects.clear();
    this.reset();
  }

  /** Plays a tape as if it were typed: the way to watch a run, and to check one in a real browser. */
  demo(loops: FrameInput[][]): void {
    this.script = loops.map((loop) => [...loop]);
    this.running = true;
  }

  /** Back to the start of the loop, with the clones already recorded. */
  private reset(retry = false): void {
    if (!this.session) return;
    if (!retry) this.checkpoint = null;
    this.world = this.checkpoint?.world ?? initialFlow(this.session.level, this.session.loops.length);
    this.session = this.checkpoint?.session ?? { ...this.session, current: [] };
    this.pendingBoots = false;
    this.pendingShift = false;
    this.resumeAt = null;
    this.running = false;
    this.debt = 0;
    this.doors.clear();
    this.landedAt.clear();
    this.cam = null;
    this.flash = 1;
    this.stalled = false;
    this.progressAt = null;
    if (this.fallTimer !== null) window.clearTimeout(this.fallTimer);
    this.fallTimer = null;
    this.refreshHud();
  }

  get outcome(): 'playing' | 'won' | 'fallen' {
    return this.world ? outcomeOfFlow(this.world) : 'playing';
  }

  get returnedToReality(): boolean {
    if (!this.world || this.outcome !== 'won') return false;
    return cellAt(this.world.level, cellOfBody(this.world.level, playerOfFlow(this.world)))?.reality === true;
  }

  /** Seconds of the winning run, once, when the exit has just been reached. */
  takeWin(): number | null {
    const seconds = this.pendingWin;
    this.pendingWin = null;
    return seconds;
  }

  /** State for automated checks. */
  debug(): { outcome: string; x: number; y: number; z: number; dim: number; loops: number; seconds: number; demo: boolean; boots: boolean; tick: number; checkpointTick: number | null } {
    const p = this.world ? playerOfFlow(this.world) : null;
    return {
      outcome: this.outcome,
      x: p?.x ?? 0,
      y: p?.y ?? 0,
      z: p?.z ?? 0,
      dim: p?.dim ?? 0,
      loops: this.session?.loops.length ?? 0,
      seconds: Math.round(this.elapsedMs / 100) / 10,
      demo: this.script !== null,
      boots: p?.boots ?? false,
      tick: this.world?.tick ?? 0,
      checkpointTick: this.checkpoint?.world.tick ?? null,
    };
  }

  private rewind(): void {
    if (!this.session || this.session.current.length === 0) return;
    this.session = rewindFlow(this.session);
    this.audio.play('rewind');
    this.reset();
  }

  keyDown(code: string, shift: boolean): void {
    if (!this.session || !this.world) return;
    // A key of the player's takes the run back from the demo.
    this.script = null;
    switch (code) {
      case 'KeyR':
        if (shift) {
          // Start the level over, without any clone.
          this.session = newFlowSession(this.session.level);
          this.elapsedMs = 0;
          this.audio.play('undo');
          this.reset();
        } else {
          this.rewind();
        }
        return;
      case 'KeyU':
      case 'Backspace':
        // Try the loop again: the clones stay, this attempt is forgotten.
        if (this.session.current.length > 0) {
          this.audio.play('undo');
          this.reset(true);
        }
        return;
      case 'KeyH':
        // H recalls the level's line, then gives its hint; a third press clears.
        this.help = ((this.help + 1) % 3) as 0 | 1 | 2;
        this.audio.play('select');
        this.refreshHud();
        return;
      case 'KeyB':
        if (this.world.level.gravity === 'normal') return;
        this.pendingBoots = true;
        break;
      case 'KeyE':
      case 'Enter':
      case 'NumpadEnter':
        this.pendingShift = true;
        break;
      default:
        break;
    }
    this.held.add(code);
    this.resumeAt = null;
    if (this.outcome === 'playing' && !this.running) this.running = true;
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  releaseAll(): void {
    this.held.clear();
    this.pendingShift = false;
    this.pendingBoots = false;
  }

  /** The keys as they are held: what the up arrow means is the physics' business, and a clone's. */
  private readInput(): FrameInput {
    const any = (codes: ReadonlySet<string>): boolean => [...codes].some((code) => this.held.has(code));
    const x = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0);
    const z = (any(UP) ? 1 : 0) - (any(DOWN) ? 1 : 0);
    const shift = this.pendingShift;
    this.pendingShift = false;
    const boots = this.pendingBoots;
    this.pendingBoots = false;
    return { boots, x: x as -1 | 0 | 1, z: z as -1 | 0 | 1, jump: this.held.has('Space'), shift };
  }

  /** The next input of the demo; a loop that has run out rewinds into the next one. */
  private scripted(): FrameInput | null {
    const { script } = this;
    if (script === null || !this.session) return null;
    const loop = script[0];
    const input = loop?.shift();
    if (input !== undefined) return input;
    if (script.length > 1) {
      script.shift();
      this.rewind();
      this.running = true;
      return null;
    }
    return IDLE;
  }

  private simulate(now: number): void {
    if (!this.world || !this.session) return;
    const input = this.script === null ? this.readInput() : this.scripted();
    if (input === null || !this.world || !this.session) return;
    const before = this.world;
    const next = stepFlow(before, inputsAtFlow(this.session, before.tick, input));
    this.session = { ...this.session, current: [...this.session.current, input] };
    this.world = next;
    const hero = playerOfFlow(next);
    if (hero.grounded && next.level.cells[hero.cell]?.checkpoint && this.checkpoint?.cell !== hero.cell) {
      this.checkpoint = { world: next, session: this.session, cell: hero.cell };
      this.audio.play('select');
      this.effects.ring(hero.x, hero.y + 0.5, hero.z, '#8fffe2', 0.9);
    }
    this.elapsedMs += STEP_MS;
    this.cues(before, next, now);
    this.refreshHud();
  }

  /** Sounds and dust, read off the difference between two frames. */
  private cues(before: FlowWorld, next: FlowWorld, now: number): void {
    const theme = themeFor(next.level.world);
    if (next.level.gravity === 'pulse' && before.tick > 0 && before.tick % PULSE_TICKS === 0) {
      const hero = playerOfFlow(next);
      this.effects.ring(hero.x, hero.y + HEIGHT / 2, hero.z, '#cab5ff', 1.6);
      this.audio.play('wait');
    }
    let sliding = 0;
    for (const body of next.bodies) {
      const was = before.bodies[body.id];
      if (!was || was.status !== 'active') continue;
      const mine = body.role === 'player';
      if (body.status === 'fallen') {
        if (mine) this.audio.play('fall', 0.02);
        continue;
      }
      // The soles: under the box for most, on top of it for whoever falls upward.
      if (mine && body.boots !== was.boots) this.audio.play(body.boots ? 'to2d' : 'to3d');
      const up = fallOf(next.level, body, before.tick) > 0 ? -1 : 1;
      const soles = up > 0 ? body.y : body.y + HEIGHT;
      if (was.grounded && !body.grounded && body.vy * up > 4 && mine) this.audio.play('hop');
      if (!was.grounded && body.grounded) {
        this.landedAt.set(body.id, now);
        this.effects.dust(body.x, soles, body.z, body.slick ? COLORS.ice : theme.haze, up);
        if (mine) this.audio.play('land');
      }
      const pace = Math.abs(body.vx) + Math.abs(body.vz);
      if (body.slick && body.grounded && body.dim !== 1 && pace > SLIDE_PACE) {
        // No grip: the soles cut the ice and throw it up behind them.
        sliding = Math.max(sliding, mine ? pace : pace * 0.5);
        if (next.tick % 3 === 0) this.effects.speck(body.x - Math.sign(body.vx) * 0.2, soles, body.z, next.tick % 2 === 0 ? COLORS.ice : COLORS.iceDeep, -Math.sign(body.vx) * 0.6, up);
      } else if (mine && body.grounded && pace > 2 && now - this.stepAt > 230) {
        this.stepAt = now;
        this.audio.play('step');
      }
      if (was.dim !== body.dim) {
        const wire = was.dim === 1 || body.dim === 1;
        this.effects.ring(body.x, body.y + 0.5, body.z, wire ? COLORS.wire : COLORS.threshold, 0.7);
        if (mine) this.audio.play(body.dim === 1 ? 'to1d' : body.dim === 3 ? 'to3d' : 'to2d');
      }
    }
    for (const crate of next.crates) {
      const was = before.crates.find((c) => c.id === crate.id);
      if (!was) continue;
      const carried = crate.grounded && Math.abs(crate.vx) + Math.abs(crate.vz) > SLIDE_PACE;
      if (!was.grounded && crate.grounded) {
        this.effects.dust(crate.x, crate.y, crate.z, theme.haze);
        this.audio.play('land');
      } else if (carried) {
        // On ice a crate is not pushed along, it goes by itself: a hiss, not the scrape of stone.
        sliding = Math.max(sliding, Math.abs(crate.vx) + Math.abs(crate.vz));
        if (next.tick % 3 === 0) this.effects.speck(crate.x - Math.sign(crate.vx) * 0.45, crate.y, crate.z, next.tick % 2 === 0 ? COLORS.ice : COLORS.iceDeep, -Math.sign(crate.vx) * 0.6);
      } else if ((was.x !== crate.x || (was.z !== crate.z && crate.grounded)) && now - this.pushAt > 260) {
        this.pushAt = now;
        this.audio.play('push');
      }
      // Stopped dead by a wall or by stone after a slide: it knocks.
      if (crate.grounded && Math.abs(was.vx) + Math.abs(was.vz) > 1.5 && crate.vx === 0 && crate.vz === 0) this.audio.play('bump');
    }
    if (sliding > 0 && now - this.slideAt > 150) {
      this.slideAt = now;
      this.audio.play('slide', 0, Math.min(1, sliding / 5));
    }
    if (next.toggled.join() !== before.toggled.join()) this.audio.play('lever');
    if (next.broken.length > before.broken.length) this.audio.play('crumble');
    const live = liveChannels(next).size - liveChannels(before).size;
    if (live !== 0) this.audio.play(live > 0 ? 'plateOn' : 'plateOff');

    // Standing still against something while a clone exists is probably a missed door.
    const hero = playerOfFlow(next);
    const mark = this.progressAt;
    if (mark === null || Math.abs(hero.x - mark.x) + Math.abs(hero.y - mark.y) + Math.abs(hero.z - mark.z) > 0.2) {
      this.progressAt = { x: hero.x, y: hero.y, z: hero.z, tick: next.tick };
      this.stalled = false;
    } else if (next.tick - mark.tick > FPS * 3 && this.session !== null && this.session.loops.length > 0) {
      this.stalled = true;
    }

    const outcome = outcomeOfFlow(next);
    if (outcome !== 'playing' && outcomeOfFlow(before) === 'playing') {
      this.running = false;
      // A fall is not a menu: the loop starts over by itself, clones kept.
      if (outcome === 'fallen') {
        this.fallTimer = window.setTimeout(() => {
          if (this.outcome !== 'fallen') return;
          this.reset(true);
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
    }
  }

  private refreshHud(): void {
    if (!this.entry || !this.session || !this.world) return;
    const { level } = this.session;
    const other = cloneWord(level);
    const outcome = this.outcome;
    const hero = playerOfFlow(this.world);
    const transition = outcome === 'playing' ? transitionAt(level, hero) : null;
    const action = transition === null ? null : ACTIONS[transition];
    const fresh = this.session.current.length === 0;
    // An antipode that has run past the end of its ceiling is gone for this loop, and it happens off screen.
    const lost = level.antipode ? this.world.bodies.filter((body) => body.role === 'clone' && body.status === 'fallen').length : 0;
    // How the clones set off: a reflection the other way round, an antipode toward the sky.
    const manner = `${level.mirror ? (level.antipode ? ', en miroir,' : ", à l'envers") : ''}${level.antipode ? ' et tombe vers le haut' : ''}`;

    const [message, tone] = ((): [string, '' | 'fallen' | 'hint'] => {
      if (outcome === 'fallen') return [this.checkpoint ? 'Retour à la dernière balise.' : 'Tombé dans le vide. La boucle recommence.', 'fallen'];
      if (outcome === 'won') return ['', ''];
      if (this.help === 1 && level.tip !== null) return [level.tip, ''];
      if (this.help === 2 || (this.help === 1 && level.tip === null)) return [level.hint ?? level.tip ?? '', 'hint'];
      if (this.checkpoint && this.world && this.world.tick - this.checkpoint.world.tick < FPS * 2) return ['Balise activée. U reprend ici avec tes clones.', ''];
      if (this.stalled) return [`Bloqué ? U retente cette boucle. R la rembobine : elle devient ton ${other}. H donne un indice.`, ''];
      if (fresh && this.session.loops.length > 0) return [`Ton ${other} part à ta première touche${manner}.`, ''];
      if (this.session.current.length < TIP_FRAMES && this.session.loops.length === 0 && level.tip !== null) return [level.tip, ''];
      if (action !== null) return [`E : ${action}`, ''];
      if (lost > 0) return [`${lost > 1 ? 'Des antipodes sont tombés' : 'Ton antipode est tombé'} dans le ciel, au bout de ${lost > 1 ? 'leur' : 'son'} plafond.`, ''];
      return ['', ''];
    })();

    const tick = Math.max(0, this.world.tick - 1);
    const arrow = fallOf(level, hero, tick) > 0 ? '↑' : '↓';
    const pulse = level.gravity === 'pulse' && !hero.boots ? ` · inversion dans ${Math.ceil((PULSE_TICKS - tick % PULSE_TICKS) / FPS)} s` : '';
    const field = level.gravity === 'normal' ? '' : `${hero.boots ? 'Bottes actives' : 'Champ libre'} ${arrow}${pulse}`;
    const signature = `${this.entry.id}|${hero.dim}|${this.session.loops.length}|${message}|${tone}|${field}|${action ?? ''}`;
    if (signature === this.shown) return;
    this.shown = signature;
    this.hud.update(this.entry, { dim: hero.dim, loops: this.session.loops.length, field, message, tone, action });
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

  /** The moment as the scene reads it: every body and crate in the cell it stands in. */
  private sceneOf(world: FlowWorld): SceneView {
    const { level } = world;
    const hero = playerOfFlow(world);
    return {
      level,
      hero: { dim: hero.dim, cell: cellOf(level, hero) },
      bodies: world.bodies.filter((b) => b.status === 'active').map((b) => ({ id: b.id, cell: cellOf(level, b) })),
      crates: world.crates.map((c) => vec(Math.floor(c.x), Math.max(0, Math.floor(c.y + 0.01)), Math.floor(c.z))),
      toggled: world.toggled,
      live: liveChannels(world),
      broken: new Set(world.broken),
      checkpoint: this.checkpoint?.cell ?? null,
    };
  }

  /** Draws the level; `live` is false while a menu is up, and the world then holds still. */
  frame(now: number, live = true): void {
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
    if (this.running && live) {
      this.debt += dt * 1000;
      for (let i = 0; i < MAX_STEPS_PER_FRAME && this.debt >= STEP_MS && this.running; i++) {
        this.debt -= STEP_MS;
        this.simulate(now);
      }
      if (this.debt > STEP_MS * MAX_STEPS_PER_FRAME) this.debt = 0;
    }
    const current = this.world ?? world;
    const { level } = current;
    const scene = this.sceneOf(current);
    this.hud.setClock(this.elapsedMs / 1000, targetSeconds(level), this.elapsedMs > 0);

    const target = cameraTarget(level, scene.hero, view);
    if (this.cam === null) this.cam = target;
    else approach(this.cam, target, 1 - Math.exp((-dt * 1000) / 110));
    const cam = this.cam;

    // Doors ease open and shut.
    const { size } = level;
    level.cells.forEach((cell, index) => {
      if (cell.door === null) return;
      const x = index % size.w;
      const y = Math.floor(index / size.w) % size.h;
      const z = Math.floor(index / (size.w * size.h));
      const goal = doorClosed(current, scene.live, x, y, z) ? 0 : 1;
      const at = this.doors.get(index) ?? goal;
      this.doors.set(index, Math.abs(goal - at) < 0.01 ? goal : at + (goal - at) * (1 - Math.exp((-dt * 1000) / 70)));
    });
    this.effects.update(dt);

    const time = now / 1000;
    const poses: ActorPose[] = current.bodies
      // Whoever has fallen out is drawn as far as the edge of the void, below or, for an antipode, above.
      .filter((b) => b.status !== 'fallen' || (b.y > -3 && b.y < size.h + 3))
      .map((b: Body) => {
        const up = fallOf(level, b, Math.max(0, current.tick - 1)) > 0 ? -1 : 1;
        const pace = Math.abs(b.vx) + Math.abs(b.vz);
        return {
          id: b.id,
          role: b.role,
          dim: b.dim,
          // Before the first key everyone stands on the start: fan the clones out behind the hero.
          x: b.x - 0.5 - (current.tick === 0 ? (current.bodies.length - 1 - b.id) * 0.22 : 0),
          // The soles: an antipode's are at the top of its box. A rider is a point on its wire.
          y: up < 0 && b.dim !== 1 ? b.y + HEIGHT : b.y,
          z: b.z - 0.5,
          up,
          cell: cellOf(level, b),
          alpha: b.status === 'fallen' ? 0.5 : 1,
          stride: b.grounded && pace > 0.6 ? (((b.x + b.z) * 1.1) % 1 + 1) % 1 : null,
          airborne: !b.grounded && b.dim !== 1,
          heading: (Math.sign(b.vx) || 0) as -1 | 0 | 1,
          slide: b.slick && b.grounded && b.dim !== 1 && pace > SLIDE_PACE ? slideOf(b) : null,
          plunge: level.wrap.y && !b.grounded && b.dim !== 1 && Math.abs(b.vy) > PLUNGE_PACE ? b.vy : 0,
        };
      });
    const crates: CratePose[] = current.crates.map((c, i) => ({
      id: c.id,
      x: c.x - 0.5,
      y: c.y,
      z: c.z - 0.5,
      cell: scene.crates[i] ?? vec(0, 0, 0),
      slide: c.grounded && Math.abs(c.vx) + Math.abs(c.vz) > SLIDE_PACE ? slideOf(c) : null,
    }));

    const theme = themeFor(level.world);
    const tiles = this.assets.tiles[(level.world - 1) % this.assets.tiles.length];
    if (!tiles) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = 1;
    drawBackdrop(ctx, this.assets.backgrounds[(level.world - 1) % this.assets.backgrounds.length], theme, cam, view, time);
    drawScene({
      ctx,
      cam,
      world: scene,
      geometry,
      tiles,
      theme,
      time,
      actors: poses,
      crates,
      lookOf: (pose) => ({
        joy: pose.role === 'player' && this.outcome === 'won',
        boots: current.bodies[pose.id]?.boots ?? false,
        facing: current.bodies[pose.id]?.facing ?? 1,
        squash: Math.min(1, Math.max(0, 1 - (now - (this.landedAt.get(pose.id) ?? -1e9)) / 200)),
      }),
      doorOpen: (cell) => this.doors.get(cell) ?? (level.cells[cell]?.door ? 0 : 1),
    });
    this.effects.draw(ctx, cam, level);
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(255, 220, 160, ${this.flash * 0.25})`;
      ctx.fillRect(0, 0, view.width, view.height);
      this.flash *= Math.exp(-dt * 8);
    }
  }
}
