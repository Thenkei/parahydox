import { parseTape } from '../flow/tape';
import { LEVEL_SOURCES, loadLevels } from '../levels';
import { loadAssets } from './assets';
import { Audio } from './audio';
import { Game, targetSeconds } from './game';
import { Hud, type LevelEntry } from './hud';
import { loadProgress, saveProgress, withWin } from './progress';
import { themeFor } from './themes';

type Screen = 'title' | 'select' | 'play';

const WIN_CARD_AFTER_MS = 650;

function buildEntries(): LevelEntry[] {
  const counters = new Map<number, number>();
  return loadLevels().map((level, i) => {
    const position = (counters.get(level.world) ?? 0) + 1;
    counters.set(level.world, position);
    return { id: LEVEL_SOURCES[i]?.id ?? String(i), level, label: `${level.world}-${position}` };
  });
}

/**
 * The shell around the game: which screen is up, which level is open, what is unlocked.
 * Keys are matched on `code` (physical position), so the WASD cluster is ZQSD on an AZERTY
 * keyboard without configuration.
 */
export async function startApp(): Promise<void> {
  const entries = buildEntries();
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
  const unlocked = (index: number): boolean => everything || index === 0 || entryAt(index).id in progress.times || entryAt(index - 1).id in progress.times;
  const targets = new Map(entries.flatMap((e) => {
    const target = targetSeconds(e.level);
    return target === null ? [] : [[e.id, target] as const];
  }));

  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing <canvas id="view"> in index.html');

  // `?level=12` opens a level directly, to share or reproduce a situation.
  const deepLink = params.has('level');
  let levelIndex = clampIndex(deepLink ? Number(params.get('level')) - 1 : progress.last);
  let screen: Screen = 'title';
  let cursor = levelIndex;
  let winTimer: number | null = null;

  const hud = new Hud((index) => {
    if (unlocked(index)) openLevel(index);
  });
  const game = new Game(canvas, assets, hud, audio);

  const clearWin = (): void => {
    if (winTimer !== null) window.clearTimeout(winTimer);
    winTimer = null;
    hud.hideWin();
  };

  const showSelect = (): void => {
    game.releaseAll();
    screen = 'select';
    cursor = levelIndex;
    clearWin();
    hud.showScreen('select');
    hud.renderSelect({ entries, times: progress.times, targets, unlocked, cursor });
  };

  function openLevel(index: number): void {
    levelIndex = clampIndex(index);
    cursor = levelIndex;
    screen = 'play';
    progress = { ...progress, last: levelIndex };
    saveProgress(progress);
    const entry = entryAt(levelIndex);
    audio.setRoot(themeFor(entry.level.world).root);
    audio.play('select');
    clearWin();
    hud.showScreen('play');
    game.start(entry);
    hud.showBanner(entry);
  }

  const onSelectKey = (code: string): void => {
    if (code === 'Escape') {
      screen = 'play';
      return hud.showScreen('play');
    }
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'KeyE' || code === 'Space') {
      if (unlocked(cursor)) openLevel(cursor);
      return;
    }
    const dx = code === 'ArrowLeft' || code === 'KeyA' ? -1 : code === 'ArrowRight' || code === 'KeyD' ? 1 : 0;
    const dy = code === 'ArrowUp' || code === 'KeyW' ? -1 : code === 'ArrowDown' || code === 'KeyS' ? 1 : 0;
    if (dx === 0 && dy === 0) return;
    if (dx !== 0) {
      cursor = clampIndex(cursor + dx);
    } else {
      // Up and down change chapter and keep the column where they can.
      const here = entryAt(cursor).level.world;
      const column = entries.slice(0, cursor).filter((e) => e.level.world === here).length;
      const row = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.level.world === here + dy);
      const target = row[Math.min(column, row.length - 1)];
      if (target) cursor = target.i;
    }
    audio.play('wait');
    hud.renderSelect({ entries, times: progress.times, targets, unlocked, cursor });
  };

  const onPlayKey = (event: KeyboardEvent): void => {
    const { code } = event;
    if (code === 'Escape') return showSelect();
    if (code === 'KeyN') return openLevel(levelIndex + 1);
    if (code === 'KeyP') return openLevel(levelIndex - 1);
    if (game.outcome === 'won') {
      if (code === 'Enter' || code === 'NumpadEnter') return levelIndex + 1 < entries.length ? openLevel(levelIndex + 1) : showSelect();
      // Once through the door only starting over means anything.
      if (!(code === 'KeyR' && event.shiftKey)) return;
    }
    clearWin();
    game.keyDown(code, event.shiftKey);
  };

  const HANDLED = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'Enter', 'NumpadEnter', 'Escape', 'Backspace', 'KeyE', 'KeyR', 'KeyU', 'KeyH', 'KeyM', 'KeyN', 'KeyP']);

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || !HANDLED.has(event.code)) return;
    // Arrows and space would otherwise scroll the page.
    event.preventDefault();
    audio.unlock();
    if (event.repeat) return;
    if (event.code === 'KeyM') return void audio.toggleMute();
    if (screen === 'title') {
      if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space' || event.code === 'KeyE') openLevel(levelIndex);
    } else if (screen === 'select') {
      onSelectKey(event.code);
    } else {
      onPlayKey(event);
    }
  });
  window.addEventListener('keyup', (event) => game.keyUp(event.code));
  window.addEventListener('blur', () => game.releaseAll());

  const loop = (now: number): void => {
    // The level stays on screen behind the title and the level list, but only runs while it is played.
    game.frame(now, screen === 'play');
    const seconds = game.takeWin();
    if (seconds !== null) {
      const entry = entryAt(levelIndex);
      progress = withWin(progress, entry.id, seconds);
      saveProgress(progress);
      winTimer = window.setTimeout(() => hud.showWin(entry, seconds, targetSeconds(entry.level), levelIndex === entries.length - 1), WIN_CARD_AFTER_MS);
    }
    requestAnimationFrame(loop);
  };

  // `?debug` exposes a handle for automated checks (sound level, current state).
  if (params.has('debug')) {
    Object.assign(window, { parahydox: { soundLevel: () => audio.level(), game: () => game.debug(), levels: () => entries.map((e) => e.id) } });
  }

  audio.setRoot(themeFor(entryAt(levelIndex).level.world).root);
  // The level is already there behind the title: the game starts where the player left it.
  game.start(entryAt(levelIndex));
  hud.showScreen('title');
  if (deepLink) {
    openLevel(levelIndex);
    // `?demo` plays the level's own run, `?tape=…` a given one: a run to watch, or to check in a real browser.
    const tape = params.has('tape') ? params.get('tape') : params.has('demo') ? entryAt(levelIndex).level.tape : null;
    const parsed = tape === null || tape === undefined ? null : parseTape(tape);
    if (parsed?.ok) game.demo(parsed.value);
    else if (parsed) console.warn(`Ignoring tape: ${parsed.error}`);
  }
  requestAnimationFrame(loop);
}
