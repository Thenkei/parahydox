import { type Command, type GameState, newGame, reduce } from '../core/game';
import { parseScript } from '../core/script';
import { replayFrames, tapesOf, totalActions } from '../core/session';
import { wireHeading } from '../core/step';
import { cellAt, sameCell } from '../core/grid';
import type { Dir, Input } from '../core/types';
import { outcomeOf, playerOf } from '../core/world';
import { LEVEL_SOURCES, loadLevels } from '../levels';
import { loadAssets } from './assets';
import { Audio } from './audio';
import { cuesFor } from './feedback';
import { type DeadKey, Hud, type LevelEntry, transitionAt } from './hud';
import { type Key, keyFor, moveFor } from './input';
import { loadProgress, saveProgress, starsFor, swiftSeconds, withWin } from './progress';
import { FLOW_SOURCES, loadFlowLevels } from '../flow/levels';
import { FlowGame, flowTarget } from './flow';
import { Stage } from './render/stage';
import { themeFor } from './themes';

type Screen = 'title' | 'select' | 'play' | 'flow';

/** A held direction starts repeating after this long, so a tap is always exactly one step. */
const REPEAT_AFTER_MS = 210;
const WIN_CARD_AFTER_MS = 650;
/** Keys typed faster than the hero moves wait their turn here. The limit only guards against a stuck key. */
const QUEUE_LIMIT = 64;
/** In real-time mode, the world takes a step by itself when the player has not pressed anything for this long. */
const IDLE_STEP_MS = 350;
/** A jump with nobody else in motion hangs longer: time to press the direction, even slowly. */
const HANG_MS = 650;

function buildEntries(): LevelEntry[] {
  const counters = new Map<number, number>();
  return loadLevels().map((level, i) => {
    const position = (counters.get(level.world) ?? 0) + 1;
    counters.set(level.world, position);
    return { id: LEVEL_SOURCES[i]?.id ?? String(i), level, label: `${level.world}-${position}` };
  });
}

/** The flow chapter comes after the step levels: same world, continuous movement. */
function buildFlowEntries(): LevelEntry[] {
  return loadFlowLevels().map((level, i) => ({ id: FLOW_SOURCES[i]?.id ?? `flow-${i}`, level, label: `${level.world}-${i + 1}` }));
}

export async function startApp(): Promise<void> {
  const entries = [...buildEntries(), ...buildFlowEntries()];
  const assets = await loadAssets();
  const params = new URLSearchParams(location.search);
  const audio = new Audio();
  let progress = loadProgress();

  const entryAt = (index: number): LevelEntry => {
    const entry = entries[index];
    if (!entry) throw new Error(`No level at index ${index}`);
    return entry;
  };
  const clampIndex = (n: number): number => Math.min(entries.length - 1, Math.max(0, Math.trunc(n) || 0));
  const everything = params.has('unlock');
  // A level opens once the one before it is solved; solved levels stay open.
  const unlocked = (index: number): boolean =>
    everything ||
    index === 0 ||
    // The flow chapter is the game on the run: its first level is open from the start.
    (entryAt(index).level.flow && !entryAt(index - 1).level.flow) ||
    entryAt(index).id in progress.best ||
    entryAt(index - 1).id in progress.best;

  // `?level=12&script=REUURRRR|RR` opens a level in a given situation, to share or reproduce it.
  const deepLink = params.has('level');
  // A new player starts on the run: the first level of the continuous chapter.
  const firstFlow = entries.findIndex((e) => e.level.flow);
  const fresh = Object.keys(progress.best).length === 0 && progress.last === 0;
  let levelIndex = clampIndex(deepLink ? Number(params.get('level')) - 1 : fresh && firstFlow >= 0 ? firstFlow : progress.last);
  let state: GameState = newGame(entryAt(levelIndex).level);
  const script = parseScript(params.get('script') ?? '');
  if (script.ok) state = script.value.reduce(reduce, state);
  else console.warn(`Ignoring ?script: ${script.error}`);

  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing <canvas id="view"> in index.html');
  const stage = new Stage(canvas, assets, state.world);

  let screen: Screen = deepLink ? 'play' : 'title';
  let cursor = levelIndex;
  // Typing ahead must never lose a key: a tape with a missing step is a different tape.
  const queue: Command[] = [];
  const enqueue = (command: Command): void => {
    if (queue.length < QUEUE_LIMIT) queue.push(command);
  };
  let winTimer: number | null = null;
  let hintLevel: 0 | 1 | 2 | 3 = 0;
  let idleInputs = 0;
  let dead: DeadKey | null = null;
  // The clock of the attempt starts on the first key and stops on the exit.
  let startedAt: number | null = null;
  let finalSeconds: number | null = null;
  let missed: ReadonlySet<number> = new Set();
  // `stalled` marks a held direction whose last repeat changed nothing: leaning on a wall
  // must not keep spending actions.
  const held: { dir: Dir; since: number; stalled: boolean }[] = [];
  // Real time: clones and gravity do not wait for the player. It is the default, because it
  // is what makes a loop feel like a run; G switches to step-by-step, and the choice is kept.
  // `?steps` forces step-by-step: scripted tools type slower than the world would move.
  const MODE_KEY = 'parahydox.mode';
  const storedMode = ((): string | null => {
    try {
      return localStorage.getItem(MODE_KEY);
    } catch {
      return null;
    }
  })();
  let realtime = params.has('steps') ? false : params.has('realtime') ? true : storedMode !== 'steps';
  let lastInputAt = 0;
  // The world only runs by itself after a key of the player's: an undo, a rewind or a new
  // level leaves it paused, so that going back is a place to think and not a second fall.
  let armed = false;

  const hud = new Hud((index) => {
    if (unlocked(index)) openLevel(index);
  });
  const flow = new FlowGame(canvas, assets, hud, audio);

  /** Clones whose very next key is a wait slipped in with T: they wear a pause mark. */
  const heldNow = (): number[] =>
    state.session.loops.flatMap((log, i) => {
      const input = log[state.world.tick];
      return input?.kind === 'wait' && input.held ? [i] : [];
    });

  const refresh = (): void => {
    hud.showScreen(screen === 'flow' ? 'play' : screen);
    if (screen === 'flow') return;
    stage.held = screen === 'play' ? heldNow() : [];
    if (screen === 'play') hud.updatePlay(state, entryAt(levelIndex), { hint: hintLevel, stuck: idleInputs >= 3, missed, dead, realtime, paused: realtime && !armed });
    if (screen === 'select') hud.renderSelect({ entries, best: progress.best, times: progress.times, unlocked, cursor });
    stage.prompt = screen === 'play' && transitionAt(state) !== null ? 'E' : null;
  };

  const clearWin = (): void => {
    if (winTimer !== null) window.clearTimeout(winTimer);
    winTimer = null;
    hud.hideWin();
  };

  function openLevel(index: number): void {
    levelIndex = clampIndex(index);
    cursor = levelIndex;
    if (entryAt(levelIndex).level.flow) {
      // A flow level is played by its own loop: continuous movement, one input per frame.
      queue.length = 0;
      held.length = 0;
      screen = 'flow';
      progress = { ...progress, last: levelIndex };
      saveProgress(progress);
      audio.setRoot(themeFor(entryAt(levelIndex).level.world).root);
      audio.play('select');
      clearWin();
      hud.showScreen('play');
      flow.start(entryAt(levelIndex));
      hud.showBanner(entryAt(levelIndex));
      return;
    }
    state = newGame(entryAt(levelIndex).level);
    queue.length = 0;
    armed = false;
    startedAt = null;
    finalSeconds = null;
    hintLevel = 0;
    idleInputs = 0;
    dead = null;
    missed = new Set();
    screen = 'play';
    progress = { ...progress, last: levelIndex };
    saveProgress(progress);
    audio.setRoot(themeFor(state.world.level.world).root);
    audio.play('select');
    clearWin();
    stage.cut(state.world);
    hud.showBanner(entryAt(levelIndex));
    refresh();
  }

  const onWin = (): void => {
    const entry = entryAt(levelIndex);
    const steps = totalActions(state.session);
    const seconds = startedAt === null ? null : Math.round((performance.now() - startedAt) / 100) / 10;
    finalSeconds = seconds;
    progress = withWin(progress, entry.id, steps, seconds);
    saveProgress(progress);
    winTimer = window.setTimeout(() => {
      hud.showWin(entry, steps, starsFor(entry.level.par, steps), levelIndex === entries.length - 1, seconds);
    }, WIN_CARD_AFTER_MS);
  };

  /** `quiet` is for the steps the world takes by itself: they should not tick like a key press. */
  const dispatch = (command: Command, quiet = false): void => {
    const before = state;
    const next = reduce(state, command);
    if (next === state) {
      // Nothing to hold back: no clone has a key left.
      if (command.type === 'hold') audio.play('bump');
      return;
    }
    state = next;
    dead = null;
    clearWin();
    // Starting over starts the clock over; anything else lets it run.
    if (command.type === 'restart') startedAt = null;
    else if (startedAt === null) startedAt = performance.now();
    if (command.type !== 'input') {
      finalSeconds = null;
      if (command.type !== 'hold') armed = false;
    }

    switch (command.type) {
      case 'input': {
        lastInputAt = performance.now();
        if (!quiet) armed = true;
        const pressed = command.input.kind === 'move' ? command.input.dir : null;
        // A clone whose key press changed nothing has diverged: say so, on stage and in the HUD.
        const tick = before.world.tick;
        missed = new Set(
          tapesOf(next.session).flatMap((tape, i) => (tape.role === 'clone' && tape.keys[tick]?.lost ? [i] : [])),
        );
        const hero = playerOf(next.world);
        const heroBefore = playerOf(before.world);
        const still = sameCell(hero.pos, heroBefore.pos) && hero.dim === heroBefore.dim && command.input.kind !== 'wait';
        idleInputs = still ? idleInputs + 1 : 0;
        // A key that could never have worked here is worth one sentence, the first time.
        if (still && command.input.kind === 'shift') dead = 'shift';
        else if (still && heroBefore.dim === 1 && command.input.kind === 'move') {
          // Either the arrow does not follow the wire, or the wire is barred ahead.
          const level = before.world.level;
          const ref = cellAt(level, heroBefore.pos)?.wire;
          const cells = ref ? (level.wires[ref.wire]?.cells ?? []) : [];
          const dir = command.input.dir;
          const along = ref ? [cells[ref.index + 1], cells[ref.index - 1]].some((to) => to !== undefined && wireHeading(heroBefore.pos, to) === dir) : false;
          dead = along ? 'barred' : 'wire';
        }
        const ms = stage.step(before.world, next.world, pressed, [...missed]);
        if (dead === 'shift') stage.refuse();
        if (missed.size > 0) audio.play('bump', 0.04);
        for (const cue of cuesFor(before.world, next.world, command.input, ms)) {
          if (!(quiet && cue.sound === 'wait')) audio.play(cue.sound, cue.delay);
        }
        if (outcomeOf(next.world) === 'won') onWin();
        break;
      }
      case 'hold':
        // The clones' tapes slide one step to the right; the stage shows who is being held.
        stage.hold(next.world);
        audio.play('wait');
        break;
      case 'rewind':
        idleInputs = 0;
        missed = new Set();
        stage.rewind(replayFrames(before.session).reverse(), next.world);
        audio.play('rewind');
        break;
      case 'undo':
      case 'restart':
        idleInputs = 0;
        missed = new Set();
        stage.cut(next.world);
        audio.play('undo');
        break;
    }
    refresh();
  };

  const inputFor = (key: Key): Input | null => {
    switch (key.type) {
      case 'move':
        return { kind: 'move', dir: key.dir };
      case 'wait':
        return { kind: 'wait' };
      case 'shift':
        return { kind: 'shift' };
      default:
        return null;
    }
  };

  const onPlayKey = (key: Key): void => {
    const won = outcomeOf(state.world) === 'won';
    switch (key.type) {
      case 'menu':
        queue.length = 0;
        screen = 'select';
        cursor = levelIndex;
        clearWin();
        return refresh();
      case 'skip':
        return openLevel(levelIndex + key.by);
      case 'realtime':
        realtime = !realtime;
        try {
          localStorage.setItem(MODE_KEY, realtime ? 'realtime' : 'steps');
        } catch {
          // Storage unavailable: the choice lasts for this visit only.
        }
        audio.play('select');
        return refresh();
      case 'hint':
        // H recalls the level's line, then the shape of the solution, then the hint; a fourth press clears.
        hintLevel = ((hintLevel + 1) % 4) as 0 | 1 | 2 | 3;
        audio.play('select');
        return refresh();
      case 'confirm':
        if (!won) {
          enqueue({ type: 'input', input: { kind: 'shift' } });
        } else if (levelIndex + 1 < entries.length) {
          openLevel(levelIndex + 1);
        } else {
          screen = 'select';
          clearWin();
          refresh();
        }
        return;
      case 'rewind':
      case 'hold':
      case 'undo':
      case 'restart':
        enqueue({ type: key.type });
        return;
      default: {
        const input = inputFor(key);
        if (input !== null) enqueue({ type: 'input', input });
      }
    }
  };

  const onSelectKey = (key: Key): void => {
    if (key.type === 'menu') {
      screen = 'play';
      return refresh();
    }
    if (key.type === 'confirm' || key.type === 'shift') {
      if (unlocked(cursor)) openLevel(cursor);
      return;
    }
    if (key.type !== 'move') return;
    if (key.dir === 'left' || key.dir === 'right') {
      cursor = clampIndex(cursor + (key.dir === 'left' ? -1 : 1));
    } else {
      // Up and down change chapter and keep the column where they can.
      const here = entryAt(cursor).level.world;
      const column = entries.slice(0, cursor).filter((e) => e.level.world === here).length;
      // Rows on screen: the continuous chapter first, then worlds 1 to 8.
      const flowWorld = firstFlow >= 0 ? entryAt(firstFlow).level.world : -1;
      const rowOf = (world: number): number => (world === flowWorld ? 0 : world);
      const worldOf = (rowIndex: number): number => (rowIndex === 0 ? flowWorld : rowIndex);
      const wanted = worldOf(rowOf(here) + (key.dir === 'up' ? -1 : 1));
      const row = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.level.world === wanted);
      const target = row[Math.min(column, row.length - 1)];
      if (target) cursor = target.i;
    }
    audio.play('wait');
    refresh();
  };

  window.addEventListener('keydown', (event) => {
    const key = keyFor(event);
    if (key === null) return;
    // Arrows and space would otherwise scroll the page.
    event.preventDefault();
    audio.unlock();
    if (key.type === 'mute') return void audio.toggleMute();

    const dir = moveFor(event.code);
    if (event.repeat) return;
    if (dir !== null && !held.some((h) => h.dir === dir)) held.push({ dir, since: performance.now(), stalled: false });

    if (screen === 'flow') {
      if (key.type === 'menu') {
        flow.releaseAll();
        screen = 'select';
        cursor = levelIndex;
        clearWin();
        return refresh();
      }
      if (key.type === 'skip') return openLevel(levelIndex + key.by);
      if (key.type === 'confirm' && flow.outcome === 'won') {
        if (levelIndex + 1 < entries.length) return openLevel(levelIndex + 1);
        screen = 'select';
        clearWin();
        return refresh();
      }
      if (flow.outcome === 'won' && event.code !== 'KeyR') return;
      clearWin();
      return flow.keyDown(event.code, event.shiftKey);
    }
    if (screen === 'title') {
      if (key.type === 'confirm' || key.type === 'wait' || key.type === 'shift') openLevel(levelIndex);
    } else if (screen === 'select') {
      onSelectKey(key);
    } else {
      onPlayKey(key);
    }
  });

  window.addEventListener('keyup', (event) => {
    flow.keyUp(event.code);
    const dir = moveFor(event.code);
    const index = held.findIndex((h) => h.dir === dir);
    if (index >= 0) held.splice(index, 1);
  });
  window.addEventListener('blur', () => {
    flow.releaseAll();
    held.length = 0;
  });

  const loop = (now: number): void => {
    if (screen === 'flow') {
      flow.frame(now);
      const seconds = flow.takeWin();
      if (seconds !== null) {
        const entry = entryAt(levelIndex);
        progress = withWin(progress, entry.id, 1, seconds);
        saveProgress(progress);
        winTimer = window.setTimeout(() => hud.showFlowWin(entry, seconds, flowTarget(entry.level), levelIndex === entries.length - 1), WIN_CARD_AFTER_MS);
      }
      requestAnimationFrame(loop);
      return;
    }
    stage.sync(now);
    // With keys waiting, the step on screen hurries up instead of making them wait.
    stage.hurry(screen === 'play' && queue.length > 0);
    if (screen === 'play' && !stage.busy) {
      const command = queue.shift();
      if (command !== undefined) {
        dispatch(command);
      } else {
        const hero = playerOf(state.world);
        // The most recently pressed direction wins, once it has been held long enough. A
        // jump is always a tap: a held ↑ would cancel its own jump on the next step.
        const latest = [...held].reverse().find((h) => !h.stalled && !(hero.dim === 2 && (h.dir === 'up' || h.dir === 'down')));
        const clonesPending = state.session.loops.some((log) => log.length > state.world.tick);
        const pending = outcomeOf(state.world) === 'playing' && (clonesPending || hero.air > 0);
        const windowMs = clonesPending ? IDLE_STEP_MS : HANG_MS;
        const since = performance.now() - lastInputAt;
        const idle = since > windowMs;
        // The beat: how close the world is to taking its next step by itself.
        hud.setBeat(realtime && armed && pending ? Math.min(1, since / windowMs) : null);
        if (latest && now - latest.since > REPEAT_AFTER_MS) {
          dispatch({ type: 'input', input: { kind: 'move', dir: latest.dir } });
          const after = playerOf(state.world);
          latest.stalled = sameCell(after.pos, hero.pos) && after.dim === hero.dim && after.air === hero.air;
        } else if (realtime && armed && idle && pending) {
          // Real time: while a clone still has keys to play, or the hero hangs in the air,
          // the world goes on without waiting. Waits are free, so the score is untouched.
          dispatch({ type: 'input', input: { kind: 'wait' } }, true);
        }
      }
    }
    if (screen === 'play') {
      const won = outcomeOf(state.world) === 'won';
      const running = startedAt === null ? null : (performance.now() - startedAt) / 1000;
      hud.setClock(won ? finalSeconds : running, state.world.level);
    }
    stage.frame(now);
    requestAnimationFrame(loop);
  };

  // `?debug` exposes a handle for automated checks (sound level, current state).
  if (params.has('debug')) {
    Object.assign(window, { parahydox: { soundLevel: () => audio.level(), outcome: () => outcomeOf(state.world), steps: () => totalActions(state.session), tick: () => state.world.tick, seconds: () => finalSeconds, flow: () => flow.debug(), swift: () => swiftSeconds(state.world.level.solution) } });
  }

  audio.setRoot(themeFor(state.world.level.world).root);
  refresh();
  if (screen === 'play' && outcomeOf(state.world) === 'won') onWin();
  if (deepLink && entryAt(levelIndex).level.flow) openLevel(levelIndex);
  requestAnimationFrame(loop);
}
