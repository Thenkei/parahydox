import type { Dim, Level } from '../core/types';
import type { LessonId } from '../lessons';
import { type Campaign, type CampaignId, campaignById, chapterLabel, chapterName } from '../levels';
import { COLORS } from './themes';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement('span');
  if (className !== '') node.className = className;
  node.textContent = text;
  return node;
}

/** A key as the bar draws it, and the physical keys that light it up while held. */
interface Key {
  readonly cap: string;
  readonly codes: readonly string[];
}

const KEY = {
  left: { cap: '←', codes: ['ArrowLeft', 'KeyA'] },
  right: { cap: '→', codes: ['ArrowRight', 'KeyD'] },
  up: { cap: '↑', codes: ['ArrowUp', 'KeyW'] },
  down: { cap: '↓', codes: ['ArrowDown', 'KeyS'] },
  space: { cap: 'Espace', codes: ['Space'] },
  e: { cap: 'E', codes: ['KeyE', 'Enter', 'NumpadEnter'] },
  b: { cap: 'B', codes: ['KeyB'] },
  r: { cap: 'R', codes: ['KeyR'] },
  u: { cap: 'U', codes: ['KeyU', 'Backspace'] },
  shift: { cap: 'Maj', codes: ['ShiftLeft', 'ShiftRight'] },
  h: { cap: 'H', codes: ['KeyH'] },
  esc: { cap: 'Échap', codes: ['Escape'] },
  m: { cap: 'M', codes: ['KeyM'] },
} as const satisfies Record<string, Key>;

/** How long the bar's one-shot glows last; matches the CSS animations. */
const NUDGE_MS = 1100;

/** What a key nudge points at: the entry the player was probably looking for. */
export type Nudge = 'jump' | 'rewind';

function keyEntry(keys: readonly Key[], label: string, options: { lit?: boolean; nudge?: Nudge } = {}): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = 'key';
  if (options.lit) node.classList.add('lit');
  if (options.nudge) node.dataset.nudge = options.nudge;
  for (const key of keys) {
    const cap = document.createElement('kbd');
    cap.textContent = key.cap;
    cap.dataset.codes = key.codes.join(' ');
    node.append(cap);
  }
  node.append(span('key-label', label));
  return node;
}

/** One cluster of the key bar: what moves you, what plays with time, what leaves the level. */
function keyGroup(kind: 'move' | 'loop' | 'meta', entries: readonly HTMLElement[]): HTMLDivElement {
  const group = document.createElement('div');
  group.className = `key-group ${kind}`;
  group.append(...entries);
  return group;
}

/**
 * The dimensions a level can reach at all: a wire to enter for 1D, a threshold to unfold
 * for 3D. Whether the hero can get to them is the puzzle; whether they exist is not.
 */
export const reachableDims = (level: Pick<Level, 'wires' | 'cells'>): ReadonlySet<Dim> =>
  new Set<Dim>([...(level.wires.length > 0 ? [1 as const] : []), 2, ...(level.cells.some((cell) => cell.threshold) ? [3 as const] : [])]);

export interface LevelEntry {
  readonly id: string;
  readonly campaign: CampaignId;
  readonly lesson: LessonId | null;
  readonly level: Level;
  /** "2-3": chapter and position within it; "G2-3" in Le givre, "H2-3" in hardcore. Also what `?level=` accepts. */
  readonly label: string;
}

/** A campaign as the level list shows it: its tab, and whether it can be entered. */
export interface CampaignTab {
  readonly campaign: Campaign;
  readonly open: boolean;
  readonly solved: number;
  readonly total: number;
  /** What is still to do before it opens, as a sentence; null once open. */
  readonly lock: string | null;
}

/** What follows a win, which decides what the card says and where Enter leads. */
export type WinSequel =
  /** The next level of the same campaign. `opened` lists what this win opened on the way: said in one line, without taking the player out of the campaign. */
  | { readonly kind: 'next'; readonly opened: readonly Campaign[] }
  /** Nothing follows in this campaign, and this win opened `opened` (never empty): the card is theirs, and Enter shows the first. */
  | { readonly kind: 'unlocked'; readonly opened: readonly Campaign[] }
  /**
   * The last level of its campaign, with `remaining` levels of it still unsolved. `waiting` is the
   * campaign closest to opening behind it and the solves it lacks; `finished` says the whole game is solved.
   */
  | { readonly kind: 'end'; readonly remaining: number; readonly waiting: { readonly campaign: Campaign; readonly missing: number } | null; readonly finished: boolean };

/** What clones are called in a level: the rule they follow is in their name. An antipode that is also a reflection is first of all an antipode. */
export const cloneWord = (level: Pick<Level, 'mirror' | 'antipode'>): string => (level.antipode ? 'antipode' : level.mirror ? 'reflet' : 'clone');

/**
 * How many clones a level gives, as its opening card says it: "1 clone", "2 reflets",
 * "2 antipodes en miroir". Null for a level played alone.
 */
export const cloneCount = (level: Pick<Level, 'maxClones' | 'mirror' | 'antipode'>): string | null => {
  if (level.maxClones <= 0) return null;
  const n = level.maxClones;
  return `${n} ${cloneWord(level)}${n > 1 ? 's' : ''}${level.antipode && level.mirror ? ' en miroir' : ''}`;
};

/** The colour a level's clones wear on stage, so the card announces them as they will look. */
const cloneColour = (level: Pick<Level, 'mirror' | 'antipode'>): string => (level.antipode ? COLORS.antipode : level.mirror ? COLORS.reflection : COLORS.clone);

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 'x' : ''}`;

/** "A", "A et B", "A, B et C". */
const listed = (names: readonly string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`);

/** The line a win card carries when the win opened campaigns and play goes on where it was. */
export const openedLine = (opened: readonly Campaign[]): string =>
  `${listed(opened.map((campaign) => campaign.name))} ${opened.length > 1 ? 'sont ouverts' : 'est ouvert'} : Échap pour y aller.`;

export interface PlayStatus {
  readonly dim: Dim;
  /** Clones running with the hero right now. */
  readonly loops: number;
  readonly field: string;
  readonly message: string;
  readonly tone: '' | 'fallen' | 'hint';
  /** What E would do where the hero stands; null when it would do nothing. */
  readonly action: string | null;
}

export interface SelectModel {
  readonly entries: readonly LevelEntry[];
  readonly times: Readonly<Record<string, number>>;
  readonly targets: ReadonlyMap<string, number>;
  readonly unlocked: (index: number) => boolean;
  readonly cursor: number;
  readonly tabs: readonly CampaignTab[];
  /** The campaign whose levels are listed. */
  readonly shown: CampaignId;
}

/** The DOM laid over the canvas: status, messages, and the title, select and win screens. */
export class Hud {
  private readonly root = element('game');
  private readonly hud = element('hud');
  private readonly worldName = element('world-name');
  private readonly levelName = element('level-name');
  private readonly dims = element('dims');
  private readonly tick = element('tick');
  private readonly tickLabel = element('tick-label');
  private readonly clock = element('clock');
  private readonly keys = element('keys');
  private readonly message = element('message');
  private readonly title = element('title');
  private readonly tagline = element('tagline');
  private readonly select = element('select');
  private readonly tabs = element('select-tabs');
  private readonly pitch = element('select-pitch');
  private readonly grid = element('select-grid');
  private readonly win = element('win');
  private readonly banner = element('banner');

  constructor(
    private readonly onPick: (index: number) => void,
    private readonly onPickCampaign: (campaign: CampaignId) => void,
  ) {
    element('boot').hidden = true;
    // The bar answers the fingers: a held key lights its cap, whatever the game makes of it.
    window.addEventListener('keydown', (event) => this.press(event.code, true));
    window.addEventListener('keyup', (event) => this.press(event.code, false));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.lightKeys();
    });
  }

  private readonly held = new Set<string>();
  private shownDim: Dim | null = null;
  private shownEntry: string | null = null;
  /** When each one-shot animation of the bar started: a redraw mid-way picks it up where it was. */
  private readonly marks = new Map<string, number>();

  /** Plays (or resumes) a one-shot CSS animation on a node the bar may redraw at any time. */
  private animate(node: HTMLElement | null, mark: string, className: string, ms: number, restart = false): void {
    if (!node) return;
    const now = performance.now();
    if (restart) this.marks.set(mark, now);
    const since = now - (this.marks.get(mark) ?? -Infinity);
    if (since >= ms) return;
    node.classList.remove(className);
    void node.offsetWidth;
    node.style.animationDelay = `${-since}ms`;
    node.classList.add(className);
  }

  private press(code: string, down: boolean): void {
    if (down) this.held.add(code);
    else this.held.delete(code);
    this.lightKeys();
  }

  private lightKeys(): void {
    for (const cap of this.keys.querySelectorAll<HTMLElement>('kbd[data-codes]')) {
      cap.classList.toggle('down', (cap.dataset.codes ?? '').split(' ').some((code) => this.held.has(code)));
    }
  }

  /** Draws the eye to the key the player was looking for, for a moment. */
  nudge(what: Nudge): void {
    this.animate(this.keys.querySelector<HTMLElement>(`[data-nudge="${what}"]`), `nudge:${what}`, 'nudged', NUDGE_MS, true);
  }

  /** The clone counter jumps when R has just pushed the oldest clone out. */
  flashClones(): void {
    this.animate(this.tick.parentElement, 'flash', 'flash', NUDGE_MS, true);
  }

  /** Each campaign dresses the whole interface: the stylesheet reads this off the root. */
  setCampaign(campaign: CampaignId): void {
    if (this.root.dataset.campaign === campaign) return;
    this.root.dataset.campaign = campaign;
    this.tagline.textContent = campaignById(campaign).pitch;
  }

  showScreen(screen: 'title' | 'select' | 'play' | 'credits' | 'lesson'): void {
    element('lesson').hidden = screen !== 'lesson';
    element('credits').hidden = screen !== 'credits';
    if (screen !== 'play') this.banner.hidden = true;
    this.title.hidden = screen !== 'title';
    this.select.hidden = screen !== 'select';
    this.hud.hidden = screen !== 'play';
    if (screen !== 'play') this.win.hidden = true;
  }

  /** Status of the level being played: where, in which dimension, with how many clones. */
  update(entry: LevelEntry, status: PlayStatus): void {
    const { level } = entry;
    const other = cloneWord(level);
    // A level played with reflections or antipodes says so: the clone rule is not the same.
    // Unless the chapter is already named after it: "Les antipodes · antipodes" says it twice.
    const chapter = chapterName(level.world);
    const rule = level.antipode ? (level.mirror ? 'antipodes en miroir' : 'antipodes') : level.mirror ? 'reflets' : '';
    const said = rule === '' || chapter.toLowerCase().endsWith(rule);
    this.worldName.textContent = `${entry.label} · ${chapter}${said ? '' : ` · ${rule}`}`;
    this.levelName.textContent = level.name;
    // A dimension the level has no way into is not offered: no wire, no 1D; no threshold, no 3D.
    const reachable = reachableDims(level);
    for (const pip of this.dims.children) {
      const dim = Number((pip as HTMLElement).dataset.dim) as Dim;
      const absent = !reachable.has(dim);
      pip.classList.toggle('on', dim === status.dim);
      pip.classList.toggle('absent', absent);
      pip.setAttribute('title', absent ? (dim === 1 ? 'Pas de fil dans ce niveau' : 'Pas de seuil dans ce niveau') : '');
    }
    // How many clones run with you, out of how many the level allows. R can always re-record.
    this.tickLabel.textContent = level.maxClones > 0 ? `${other}s` : '';
    this.tick.textContent = level.maxClones > 0 ? `${status.loops}/${level.maxClones}` : '';
    this.message.textContent = status.message;
    this.message.dataset.tone = status.tone;

    // The key bar says what the keys do here and now: the verbs change with the dimension.
    const moves =
      status.dim === 1
        ? [keyEntry([KEY.left, KEY.right, KEY.up, KEY.down], 'suivre le fil')]
        : status.dim === 3
          ? [keyEntry([KEY.left, KEY.right], 'courir'), keyEntry([KEY.up, KEY.down], 'fond / avant'), keyEntry([KEY.space], 'sauter', { nudge: 'jump' })]
          : [keyEntry([KEY.left, KEY.right], 'courir'), keyEntry([KEY.space], 'sauter (tenir : plus haut)', { nudge: 'jump' })];
    const move = keyGroup('move', [
      ...moves,
      ...(status.field ? [keyEntry([KEY.b], status.field, { lit: true })] : []),
      keyEntry([KEY.e], status.action ?? 'dimension', { lit: status.action !== null }),
    ]);
    const loop = keyGroup('loop', [
      ...(level.maxClones > 0 ? [keyEntry([KEY.r], `→ ${other}`, { nudge: 'rewind' })] : []),
      keyEntry([KEY.u], 'retenter'),
      keyEntry([KEY.shift, KEY.r], 'recommencer'),
    ]);
    const meta = keyGroup('meta', [
      ...(entry.lesson ? [keyEntry([KEY.h], 'démo'), keyEntry([KEY.shift, KEY.h], 'indice')] : [keyEntry([KEY.h], 'indice')]),
      keyEntry([KEY.esc], 'niveaux'),
      keyEntry([KEY.m], 'son'),
    ]);
    this.keys.replaceChildren(move, loop, meta);
    // Changing dimension changes what the arrows do: the moves glow so the change is seen, not discovered.
    const turned = this.shownEntry === entry.id && this.shownDim !== null && this.shownDim !== status.dim;
    this.animate(move, 'changed', 'changed', NUDGE_MS, turned);
    for (const what of ['jump', 'rewind'] as const) this.animate(this.keys.querySelector<HTMLElement>(`[data-nudge="${what}"]`), `nudge:${what}`, 'nudged', NUDGE_MS);
    this.shownEntry = entry.id;
    this.shownDim = status.dim;
    this.lightKeys();
  }

  /** The running clock of the level, with the time to beat for the lightning mark. */
  setClock(seconds: number, target: number | null, show: boolean): void {
    const text = show ? `${seconds.toFixed(1)} s` : '';
    const shown = target === null ? text : `${text}${text === '' ? '' : ' · '}⚡ ${target} s`;
    // Called every frame: touch the DOM only when the text changes.
    if (this.clock.textContent !== shown) this.clock.textContent = shown;
  }

  showWin(entry: LevelEntry, seconds: number, target: number | null, sequel: WinSequel): void {
    const swift = target !== null && seconds <= target;
    const [eyebrow, next, extra] = ((): [string, string, string] => {
      switch (sequel.kind) {
        case 'next':
          return ['Niveau terminé', 'niveau suivant', sequel.opened.length > 0 ? openedLine(sequel.opened) : ''];
        case 'unlocked': {
          const [first, ...others] = sequel.opened;
          const names = listed(sequel.opened.map((campaign) => campaign.name));
          // Several at once is a list of names; one alone has room for its pitch.
          return [`${names} ${others.length > 0 ? 'débloqués' : 'débloqué'}`, `découvrir ${first?.name ?? ''}`, others.length > 0 ? '' : (first?.pitch ?? '')];
        }
        case 'end': {
          if (sequel.remaining === 0) return ['Dernier niveau terminé', 'retour aux niveaux', sequel.finished ? 'Il ne reste rien. Vraiment rien.' : ''];
          const { waiting } = sequel;
          const more = waiting === null ? `Encore ${plural(sequel.remaining, 'niveau')} à terminer.` : `Encore ${plural(waiting.missing, 'niveau')} à terminer pour ouvrir ${waiting.campaign.name}.`;
          return ['Dernier niveau terminé', 'retour aux niveaux', more];
        }
      }
    })();
    element('win-eyebrow').textContent = eyebrow;
    element('win-title').textContent = entry.level.name;
    element('win-stars').textContent = swift ? '⚡' : '★';
    element('win-stats').textContent = `${seconds.toFixed(1)} s`;
    // The clock counts every attempt since the level was opened, falls included.
    element('win-time').textContent = swift ? `Éclair : moins de ${target} s, tentatives comprises` : target === null ? '' : `⚡ en ${target} s ou moins, tentatives comprises`;
    const note = element('win-extra');
    note.textContent = extra;
    note.hidden = extra === '';
    element('win-next').textContent = next;
    // Whatever announces a campaign wears its colours: the whole card when it is about nothing else, the one line otherwise.
    const announced = sequel.kind === 'end' ? undefined : sequel.opened[0]?.id;
    const wearer = sequel.kind === 'unlocked' ? this.win : note;
    for (const node of [this.win, note]) {
      if (node === wearer && announced !== undefined) node.dataset.announces = announced;
      else delete node.dataset.announces;
    }
    this.win.classList.toggle('unlock', sequel.kind === 'unlocked');
    this.win.hidden = false;
  }

  hideWin(): void {
    this.win.hidden = true;
  }

  /** The level's name, large, for a moment: every level opens like a new page. */
  showBanner(entry: LevelEntry): void {
    const { level } = entry;
    const count = cloneCount(level);
    const clones: HTMLElement[] = [];
    if (count !== null) {
      // One pip per clone, in their colour, then the count in words.
      const line = span('banner-clones', '');
      line.style.setProperty('--clone', cloneColour(level));
      line.append(...Array.from({ length: level.maxClones }, () => span('banner-pip', '')), span('banner-count', count));
      clones.push(line);
    }
    this.banner.replaceChildren(span('eyebrow', `${entry.label} · ${chapterName(level.world)}`), span('banner-name', level.name), ...clones);
    this.banner.hidden = false;
    // Restart the CSS animation.
    this.banner.classList.remove('run');
    void this.banner.offsetWidth;
    this.banner.classList.add('run');
  }

  renderSelect({ entries, times, targets, unlocked, cursor, tabs, shown }: SelectModel): void {
    this.setCampaign(shown);
    this.tabs.replaceChildren(
      ...tabs.map(({ campaign, open, solved, total }) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `tab${campaign.id === shown ? ' on' : ''}${open ? '' : ' locked'}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(campaign.id === shown));
        tab.append(span('tab-name', `${open ? '' : '🔒 '}${campaign.name}`), span('tab-count', `${solved}/${total}`));
        tab.addEventListener('click', () => this.onPickCampaign(campaign.id));
        return tab;
      }),
    );
    const current = tabs.find((tab) => tab.campaign.id === shown);
    this.pitch.textContent = current === undefined ? '' : (current.lock ?? current.campaign.pitch);
    this.pitch.classList.toggle('locked', current?.lock != null);

    const rows: HTMLElement[] = [];
    for (const chapter of current?.campaign.chapters ?? []) {
      const cards = entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.level.world === chapter.world)
        .map(({ entry, index }) => {
          const card = document.createElement('button');
          const open = unlocked(index);
          const record = times[entry.id];
          card.type = 'button';
          card.className = `level-card${open ? '' : ' locked'}${record !== undefined ? ' solved' : ''}${index === cursor ? ' current' : ''}`;
          card.disabled = !open;
          const name = document.createElement('span');
          name.className = 'name';
          name.textContent = open ? entry.level.name : '· · ·';
          const meta = document.createElement('span');
          meta.className = 'meta';
          const swift = record !== undefined && record <= (targets.get(entry.id) ?? -1);
          meta.textContent = record !== undefined ? `${entry.label} ${swift ? '⚡' : '★'} ${record.toFixed(1)} s` : `${entry.label} ${open ? '' : '🔒'}`.trim();
          card.append(name, meta);
          card.addEventListener('click', () => this.onPick(index));
          return card;
        });
      if (cards.length === 0) continue;
      const row = document.createElement('div');
      row.className = 'select-world';
      const label = document.createElement('div');
      const eyebrow = document.createElement('div');
      eyebrow.className = 'eyebrow';
      eyebrow.textContent = `Monde ${chapterLabel(chapter.world)}`;
      const strong = document.createElement('strong');
      strong.textContent = chapter.name;
      label.append(eyebrow, strong);
      const list = document.createElement('div');
      list.className = 'select-levels';
      list.append(...cards);
      row.append(label, list);
      rows.push(row);
    }
    this.grid.replaceChildren(...rows);
    this.grid.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }
}
