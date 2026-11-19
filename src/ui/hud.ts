import type { Dim, Level } from '../core/types';
import { type Campaign, type CampaignId, campaignById, chapterLabel, chapterName } from '../levels';

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

function keyEntry(keys: readonly string[], label: string, lit = false): HTMLSpanElement {
  const node = document.createElement('span');
  if (lit) node.className = 'lit';
  for (const key of keys) {
    const cap = document.createElement('kbd');
    cap.textContent = key;
    node.append(cap);
  }
  node.append(` ${label}`);
  return node;
}

export interface LevelEntry {
  readonly id: string;
  readonly campaign: CampaignId;
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
  }

  /** Each campaign dresses the whole interface: the stylesheet reads this off the root. */
  setCampaign(campaign: CampaignId): void {
    if (this.root.dataset.campaign === campaign) return;
    this.root.dataset.campaign = campaign;
    this.tagline.textContent = campaignById(campaign).pitch;
  }

  showScreen(screen: 'title' | 'select' | 'play' | 'credits'): void {
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
    for (const pip of this.dims.children) {
      const dim = (pip as HTMLElement).dataset.dim;
      if (dim !== undefined) pip.classList.toggle('on', dim === String(status.dim));
    }
    // How many clones run with you, out of how many the level allows. R can always re-record.
    this.tickLabel.textContent = level.maxClones > 0 ? `${other}s` : '';
    this.tick.textContent = level.maxClones > 0 ? `${status.loops}/${level.maxClones}` : '';
    this.message.textContent = status.message;
    this.message.dataset.tone = status.tone;

    // The key bar says what the keys do here and now: the verbs change with the dimension.
    const moves =
      status.dim === 1
        ? [keyEntry(['←', '→', '↑', '↓'], 'suivre le fil')]
        : status.dim === 3
          ? [keyEntry(['←', '→', '↑', '↓'], 'courir'), keyEntry(['Espace'], 'sauter')]
          : [keyEntry(['←', '→'], 'courir'), keyEntry(['↑', 'Espace'], 'sauter (maintenir : plus haut)')];
    this.keys.replaceChildren(
      ...moves,
      ...(status.field ? [keyEntry(['B'], status.field, true)] : []),
      keyEntry(['E'], status.action ?? 'dimension', status.action !== null),
      ...(level.maxClones > 0 ? [keyEntry(['R'], `rembobiner → ${other}`)] : []),
      keyEntry(['U'], 'retenter'),
      keyEntry(['Maj', 'R'], 'recommencer'),
      keyEntry(['H'], 'indice'),
      keyEntry(['Échap'], 'niveaux'),
      keyEntry(['M'], 'son'),
    );
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
    this.banner.replaceChildren(span('eyebrow', `${entry.label} · ${chapterName(entry.level.world)}`), span('banner-name', entry.level.name));
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
