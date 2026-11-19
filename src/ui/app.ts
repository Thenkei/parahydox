import { parseTape } from '../flow/tape';
import { CAMPAIGNS, type CampaignId, LEVEL_SOURCES, campaignById, chapterLabel, loadLevels } from '../levels';
import { loadAssets } from './assets';
import { Audio } from './audio';
import { Game, targetSeconds } from './game';
import { type CampaignTab, Hud, type LevelEntry, type WinSequel } from './hud';
import { campaignOpen, levelOpen, loadProgress, remainingIn, saveProgress, withWin } from './progress';
import { themeFor } from './themes';

type Screen = 'title' | 'select' | 'play';

const WIN_CARD_AFTER_MS = 650;

function buildEntries(): LevelEntry[] {
  const counters = new Map<number, number>();
  return loadLevels().map((level, i) => {
    const source = LEVEL_SOURCES[i];
    if (!source) throw new Error(`Invariant violated: level ${i} has no source`);
    const position = (counters.get(level.world) ?? 0) + 1;
    counters.set(level.world, position);
    return { id: source.id, campaign: source.campaign, level, label: `${chapterLabel(level.world)}-${position}` };
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
  /** What the save has earned. `?unlock` shows everything open without earning any of it. */
  const earned = (campaign: CampaignId): boolean => campaignOpen(campaign, entries, progress.times);
  const campaignIsOpen = (campaign: CampaignId): boolean => everything || earned(campaign);
  const unlocked = (index: number): boolean => (everything ? entries[index] !== undefined : levelOpen(index, entries, progress.times));
  /** N, P and `?level=` go anywhere inside an open campaign, and never into one that is still shut. */
  const reachable = (index: number): boolean => {
    const entry = entries[index];
    return entry !== undefined && campaignIsOpen(entry.campaign);
  };
  /** A campaign's levels are contiguous in play order. */
  const rangeOf = (campaign: CampaignId): { first: number; last: number } => {
    const first = entries.findIndex((entry) => entry.campaign === campaign);
    return { first, last: first + entries.filter((entry) => entry.campaign === campaign).length - 1 };
  };
  const targets = new Map(entries.flatMap((e) => {
    const target = targetSeconds(e.level);
    return target === null ? [] : [[e.id, target] as const];
  }));

  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing <canvas id="view"> in index.html');

  // `?level=12` opens a level directly, to share or reproduce a situation; levels count on through hardcore (65 to 96).
  const asked = params.has('level') ? clampIndex(Number(params.get('level')) - 1) : -1;
  const deepLink = reachable(asked);
  const resumed = clampIndex(progress.last);
  let levelIndex = deepLink ? asked : reachable(resumed) ? resumed : 0;
  let screen: Screen = 'title';
  let cursor = levelIndex;
  /** The campaign whose levels the list is showing. */
  let shown: CampaignId = entryAt(levelIndex).campaign;
  let winTimer: number | null = null;
  /** What follows the win on screen: where Enter leads from the card. */
  let sequel: WinSequel = { kind: 'next' };

  const hud = new Hud(
    (index) => {
      if (unlocked(index)) openLevel(index);
    },
    (campaign) => showCampaign(campaign),
  );
  const game = new Game(canvas, assets, hud, audio);

  const clearWin = (): void => {
    if (winTimer !== null) window.clearTimeout(winTimer);
    winTimer = null;
    hud.hideWin();
  };

  const tabs = (): CampaignTab[] =>
    CAMPAIGNS.map((campaign) => {
      const mine = entries.filter((entry) => entry.campaign === campaign.id);
      const open = campaignIsOpen(campaign.id);
      const required = campaign.requires === null ? null : campaignById(campaign.requires);
      return {
        campaign,
        open,
        solved: mine.filter((entry) => entry.id in progress.times).length,
        total: mine.length,
        lock:
          open || required === null
            ? null
            : `Termine tous les niveaux de ${required.name} pour ouvrir ${campaign.name} : encore ${remainingIn(required.id, entries, progress.times)}.`,
      };
    });

  const renderSelect = (): void => hud.renderSelect({ entries, times: progress.times, targets, unlocked, cursor, tabs: tabs(), shown });

  /** Lists a campaign's levels. A shut campaign can be looked at: its cards are all locked. */
  function showCampaign(campaign: CampaignId): void {
    shown = campaign;
    const { first, last } = rangeOf(campaign);
    if (first >= 0 && (cursor < first || cursor > last)) {
      // Land on the level being played if it is here, otherwise on the first one still to solve.
      const todo = entries.findIndex((entry, i) => i >= first && i <= last && unlocked(i) && !(entry.id in progress.times));
      cursor = levelIndex >= first && levelIndex <= last ? levelIndex : todo >= 0 ? todo : first;
    }
    renderSelect();
  }

  const showSelect = (campaign: CampaignId = entryAt(levelIndex).campaign): void => {
    game.releaseAll();
    screen = 'select';
    cursor = levelIndex;
    clearWin();
    hud.showScreen('select');
    showCampaign(campaign);
  };

  function openLevel(index: number): void {
    if (!reachable(index)) return;
    levelIndex = index;
    cursor = levelIndex;
    screen = 'play';
    progress = { ...progress, last: levelIndex };
    saveProgress(progress);
    const entry = entryAt(levelIndex);
    const theme = themeFor(entry.level.world);
    audio.setKey(theme.root, theme.mode);
    audio.play('select');
    clearWin();
    hud.setCampaign(entry.campaign);
    hud.showScreen('play');
    game.start(entry);
    hud.showBanner(entry);
  }

  const onSelectKey = (code: string): void => {
    if (code === 'Escape') {
      screen = 'play';
      // The list may have been showing the other campaign: back to the colours of the level in play.
      hud.setCampaign(entryAt(levelIndex).campaign);
      return hud.showScreen('play');
    }
    if (code === 'Tab') {
      const next = CAMPAIGNS[(CAMPAIGNS.findIndex((campaign) => campaign.id === shown) + 1) % CAMPAIGNS.length];
      if (next) {
        audio.play('wait');
        showCampaign(next.id);
      }
      return;
    }
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'KeyE' || code === 'Space') {
      if (unlocked(cursor)) openLevel(cursor);
      return;
    }
    const dx = code === 'ArrowLeft' || code === 'KeyA' ? -1 : code === 'ArrowRight' || code === 'KeyD' ? 1 : 0;
    const dy = code === 'ArrowUp' || code === 'KeyW' ? -1 : code === 'ArrowDown' || code === 'KeyS' ? 1 : 0;
    if (dx === 0 && dy === 0) return;
    const { first, last } = rangeOf(shown);
    if (first < 0) return;
    if (dx !== 0) {
      cursor = Math.min(last, Math.max(first, cursor + dx));
    } else {
      // Up and down change chapter and keep the column where they can.
      const here = entryAt(cursor).level.world;
      const column = entries.slice(0, cursor).filter((e) => e.level.world === here).length;
      const row = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.campaign === shown && e.level.world === here + dy);
      const target = row[Math.min(column, row.length - 1)];
      if (target) {
        cursor = target.i;
      } else {
        // Past the first or the last chapter lies the neighbouring campaign.
        const neighbour = CAMPAIGNS[CAMPAIGNS.findIndex((campaign) => campaign.id === shown) + dy];
        if (!neighbour) return;
        audio.play('wait');
        return showCampaign(neighbour.id);
      }
    }
    audio.play('wait');
    renderSelect();
  };

  const onPlayKey = (event: KeyboardEvent): void => {
    const { code } = event;
    if (code === 'Escape') return showSelect();
    if (code === 'KeyN') return openLevel(levelIndex + 1);
    if (code === 'KeyP') return openLevel(levelIndex - 1);
    if (game.outcome === 'won') {
      if (code === 'Enter' || code === 'NumpadEnter') {
        if (sequel.kind === 'next') return openLevel(levelIndex + 1);
        // A campaign just opened is shown, not walked into: the player chooses to enter it.
        return showSelect(sequel.kind === 'unlocked' ? sequel.campaign.id : undefined);
      }
      // Once through the door only starting over means anything.
      if (!(code === 'KeyR' && event.shiftKey)) return;
    }
    clearWin();
    game.keyDown(code, event.shiftKey);
  };

  /** What a win leads to, given the campaigns that were already earned before it. */
  const sequelOf = (entry: LevelEntry, earnedBefore: readonly CampaignId[]): WinSequel => {
    const opened = CAMPAIGNS.find((campaign) => !earnedBefore.includes(campaign.id) && earned(campaign.id));
    if (opened) return { kind: 'unlocked', campaign: opened };
    if (entries[levelIndex + 1]?.campaign === entry.campaign) return { kind: 'next' };
    return {
      kind: 'end',
      remaining: remainingIn(entry.campaign, entries, progress.times),
      opens: CAMPAIGNS.find((campaign) => campaign.requires === entry.campaign) ?? null,
    };
  };

  const HANDLED = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'Enter', 'NumpadEnter', 'Escape', 'Backspace', 'Tab', 'KeyE', 'KeyR', 'KeyU', 'KeyH', 'KeyM', 'KeyN', 'KeyP']);

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || !HANDLED.has(event.code)) return;
    // Tab only means something in the level list; everywhere else it stays the browser's.
    if (event.code === 'Tab' && screen !== 'select') return;
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
      const earnedBefore = CAMPAIGNS.filter((campaign) => earned(campaign.id)).map((campaign) => campaign.id);
      progress = withWin(progress, entry.id, seconds);
      saveProgress(progress);
      const after = sequelOf(entry, earnedBefore);
      sequel = after;
      winTimer = window.setTimeout(() => hud.showWin(entry, seconds, targetSeconds(entry.level), after), WIN_CARD_AFTER_MS);
    }
    requestAnimationFrame(loop);
  };

  // `?debug` exposes a handle for automated checks (sound level, current state).
  if (params.has('debug')) {
    Object.assign(window, {
      parahydox: {
        soundLevel: () => audio.level(),
        game: () => game.debug(),
        levels: () => entries.map((e) => e.id),
        campaigns: () => CAMPAIGNS.map((campaign) => ({ id: campaign.id, open: campaignIsOpen(campaign.id), earned: earned(campaign.id) })),
      },
    });
  }

  const opening = entryAt(levelIndex);
  const openingTheme = themeFor(opening.level.world);
  audio.setKey(openingTheme.root, openingTheme.mode);
  hud.setCampaign(opening.campaign);
  // The level is already there behind the title: the game starts where the player left it.
  game.start(opening);
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
