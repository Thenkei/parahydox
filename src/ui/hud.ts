import type { Dim, Level } from '../core/types';
import { WORLD_NAMES } from '../levels';

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
  readonly level: Level;
  /** "2-3": chapter and position within it. */
  readonly label: string;
}

export interface PlayStatus {
  readonly dim: Dim;
  /** Clones running with the hero right now. */
  readonly loops: number;
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
}

/** The DOM laid over the canvas: status, messages, and the title, select and win screens. */
export class Hud {
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
  private readonly select = element('select');
  private readonly grid = element('select-grid');
  private readonly win = element('win');
  private readonly banner = element('banner');

  constructor(private readonly onPick: (index: number) => void) {
    element('boot').hidden = true;
  }

  showScreen(screen: 'title' | 'select' | 'play'): void {
    this.title.hidden = screen !== 'title';
    this.select.hidden = screen !== 'select';
    this.hud.hidden = screen !== 'play';
    if (screen !== 'play') this.win.hidden = true;
  }

  /** Status of the level being played: where, in which dimension, with how many clones. */
  update(entry: LevelEntry, status: PlayStatus): void {
    const { level } = entry;
    const other = level.mirror ? 'reflet' : 'clone';
    // A level played with reflections says so: the clone rule is not the same.
    this.worldName.textContent = `${entry.label} · ${WORLD_NAMES[level.world - 1] ?? ''}${level.mirror ? ' · reflets' : ''}`;
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

  showWin(entry: LevelEntry, seconds: number, target: number | null, isLast: boolean): void {
    const swift = target !== null && seconds <= target;
    element('win-eyebrow').textContent = isLast ? 'Dernier niveau terminé' : 'Niveau terminé';
    element('win-title').textContent = entry.level.name;
    element('win-stars').textContent = swift ? '⚡' : '★';
    element('win-stats').textContent = `${seconds.toFixed(1)} s`;
    // The clock counts every attempt since the level was opened, falls included.
    element('win-time').textContent = swift ? `Éclair : moins de ${target} s, tentatives comprises` : target === null ? '' : `⚡ en ${target} s ou moins, tentatives comprises`;
    element('win-next').textContent = isLast ? 'retour aux niveaux' : 'niveau suivant';
    this.win.hidden = false;
  }

  hideWin(): void {
    this.win.hidden = true;
  }

  /** The level's name, large, for a moment: every level opens like a new page. */
  showBanner(entry: LevelEntry): void {
    this.banner.replaceChildren(span('eyebrow', `${entry.label} · ${WORLD_NAMES[entry.level.world - 1] ?? ''}`), span('banner-name', entry.level.name));
    this.banner.hidden = false;
    // Restart the CSS animation.
    this.banner.classList.remove('run');
    void this.banner.offsetWidth;
    this.banner.classList.add('run');
  }

  renderSelect({ entries, times, targets, unlocked, cursor }: SelectModel): void {
    const rows: HTMLElement[] = [];
    WORLD_NAMES.forEach((worldName, w) => {
      const cards = entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.level.world === w + 1)
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
      if (cards.length === 0) return;
      const row = document.createElement('div');
      row.className = 'select-world';
      const label = document.createElement('div');
      const eyebrow = document.createElement('div');
      eyebrow.className = 'eyebrow';
      eyebrow.textContent = `Monde ${w + 1}`;
      const strong = document.createElement('strong');
      strong.textContent = worldName;
      label.append(eyebrow, strong);
      const list = document.createElement('div');
      list.className = 'select-levels';
      list.append(...cards);
      row.append(label, list);
      rows.push(row);
    });
    this.grid.replaceChildren(...rows);
    this.grid.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }
}
