import type { GameState } from '../core/game';
import { cellAt } from '../core/grid';
import type { Level } from '../core/types';
import { outlineOf } from '../core/outline';
import { tapesOf, totalActions } from '../core/session';
import { outcomeOf, playerOf } from '../core/world';
import { ALL_WORLD_NAMES as WORLD_NAMES } from '../flow/levels';
import { type Stars, starText, starsFor, swiftSeconds } from './progress';

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

export interface LevelEntry {
  readonly id: string;
  readonly level: Level;
  /** "2-3": chapter and position within it. */
  readonly label: string;
}

/** Columns of the timeline. Every tape shows the same steps, so a column is a moment. */
const WINDOW = 22;
/** Steps kept visible behind the present. */
const TRAIL = 8;
const GLYPHS: Readonly<Record<string, string>> = { left: '←', right: '→', up: '↑', down: '↓', wait: '•', held: '‖', shift: 'E' };

/** A key the hero pressed that could not do anything, and why. */
export type DeadKey = 'shift' | 'wire' | 'barred';

/** Transient context for the status line, owned by the app. */
export interface PlayNotes {
  /** Help asked for with H: 0 none, 1 the level's own line, 2 the shape of the solution, 3 the hint. */
  readonly hint: 0 | 1 | 2 | 3;
  /** Several inputs in a row changed nothing. */
  readonly stuck: boolean;
  /** Clones whose last input was lost, by index. */
  readonly missed: ReadonlySet<number>;
  /** The last key did nothing for a reason worth saying. */
  readonly dead: DeadKey | null;
  /** Real-time mode: the world steps by itself when the player is idle. */
  readonly realtime: boolean;
  /** Real time, but waiting for the player's next key (after an undo or a rewind). */
  readonly paused: boolean;
}

export interface SelectModel {
  readonly entries: readonly LevelEntry[];
  readonly best: Readonly<Record<string, number>>;
  readonly times: Readonly<Record<string, number>>;
  readonly unlocked: (index: number) => boolean;
  readonly cursor: number;
}

/** The key that changes dimension where the hero stands, with what it does; null if none. */
export function transitionAt(state: GameState): string | null {
  const player = playerOf(state.world);
  const cell = cellAt(state.world.level, player.pos);
  if (cell?.anchor) return player.dim === 1 ? 'sortir du fil' : player.dim === 2 ? 'entrer dans le fil' : null;
  if (cell?.threshold) return player.dim === 2 ? 'déplier la profondeur' : player.dim === 3 ? 'replier sur cette coupe' : null;
  return null;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`;

/** What the second press of H says: how the intended solution is built, not what it is. */
function outlineText(level: Level): string | null {
  const outline = outlineOf(level);
  if (outline === null) return null;
  const parts: string[] = [];
  if (outline.loops.length === 1) {
    parts.push(`une seule boucle de ${plural(outline.loops[0] ?? 0, 'touche')}, sans rembobiner`);
  } else {
    parts.push(`${outline.loops.length} boucles (${outline.loops.map((keys) => keys).join(', puis ')} touches)`);
  }
  if (outline.jumps > 0) parts.push(plural(outline.jumps, 'saut'));
  if (outline.shifts > 0) parts.push(plural(outline.shifts, 'changement', 'changements') + ' de dimension');
  if (outline.lostKeys > 0) parts.push(`${plural(outline.lostKeys, 'touche perdue', 'touches perdues')} par un ${level.mirror ? 'reflet' : 'clone'}`);
  return `Solution prévue : ${parts.join(' · ')}.`;
}

/** The DOM laid over the canvas: status, messages, and the title, select and win screens. */
export class Hud {
  private readonly hud = element('hud');
  private readonly worldName = element('world-name');
  private readonly levelName = element('level-name');
  private readonly dims = element('dims');
  private readonly slice = element('slice');
  private readonly clones = element('clones');
  private readonly tick = element('tick');
  private readonly par = element('par');
  private readonly tickLabel = element('tick-label');
  private readonly clock = element('clock');
  private readonly beat = element('beat');
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

  updatePlay(state: GameState, entry: LevelEntry, notes: PlayNotes): void {
    const { world, session } = state;
    const { level } = world;
    const player = playerOf(world);
    const outcome = outcomeOf(world);
    const other = level.mirror ? 'reflet' : 'clone';

    // A level played with reflections says so: the clone rule is not the same.
    this.worldName.textContent = `${entry.label} · ${WORLD_NAMES[level.world - 1] ?? ''}${level.mirror ? ' · reflets' : ''}`;
    this.levelName.textContent = level.name;
    for (const pip of this.dims.children) {
      const dim = (pip as HTMLElement).dataset.dim;
      if (dim !== undefined) pip.classList.toggle('on', dim === String(player.dim));
    }
    // Which slice of the volume is on screen: two slices can look alike.
    this.slice.hidden = level.size.d < 2 || player.dim !== 2;
    this.slice.textContent = `coupe ${player.pos.z + 1}/${level.size.d}`;
    // One counter, the one the stars are given on. The step number lives on the timeline.
    this.tickLabel.textContent = 'actions';
    this.tick.textContent = String(totalActions(session));
    this.par.textContent = level.par === null ? '' : `★★★ en ${level.par}`;
    this.renderTapes(state, other);
    this.renderKeys(state, other, notes.realtime);

    const [text, tone] = ((): [string, string] => {
      if (outcome === 'won') return ['', ''];
      if (outcome === 'fallen') return ['Tombé dans le vide. R : rembobiner · U : annuler', 'fallen'];
      if (notes.hint === 1 && level.tip !== null) return [level.tip, ''];
      if (notes.hint === 2) return [outlineText(level) ?? level.hint ?? '', 'hint'];
      if (notes.hint === 3 && level.hint !== null) return [level.hint, 'hint'];
      // The level's own line comes first: it must be seen even when the hero starts on a threshold.
      if (world.tick === 0 && session.loops.length === 0 && level.tip !== null) return [level.tip, ''];
      if (notes.dead === 'shift') {
        return [
          player.dim === 3
            ? 'E ne fait rien ici : on se replie sur un seuil (le cube), et un fil ne se prend que depuis la 2D.'
            : 'E ne fait rien ici : il faut être sur une ancre (le losange) ou sur un seuil (le cube).',
          '',
        ];
      }
      if (notes.dead === 'wire') return ['Sur un fil, on avance dans le sens du fil : suis les flèches affichées.', ''];
      if (notes.dead === 'barred') return ['Le fil est barré devant toi : une barrière fermée, ou quelqu\'un sur le fil.', ''];
      if (notes.stuck) {
        // With a clone to come, keys pressed into an obstacle are not wasted: they are being recorded.
        return level.maxClones > 0
          ? [`Ces touches comptent : elles sont enregistrées, et ton ${other} les rejouera.`, '']
          : ['Coincé ? U annule un pas, Maj+R recommence le niveau, H rappelle la consigne puis donne des indices.', ''];
      }
      if (notes.paused && world.tick > 0 && session.loops.some((log) => log.length > world.tick)) {
        return [`En pause : le monde repart à ta prochaine touche. Ton ${other} attend aussi.`, ''];
      }
      const action = transitionAt(state);
      if (action !== null) return [`E : ${action}`, ''];
      if (player.dim === 3 && cellAt(level, player.pos)?.anchor) return ['Un fil ne se prend que depuis la 2D.', ''];
      if (notes.missed.size > 0) return [`Ton ${other} a buté : une de ses touches est perdue.`, 'fallen'];
      // The chapter that introduces a dimension also says how to move in it.
      if (player.dim === 1 && level.world === 1) return ['Suis le fil avec les flèches. E sur une ancre pour en sortir.', ''];
      if (player.dim === 3 && level.world === 2) return ["↑ s'enfonce dans la profondeur, ↓ revient vers l'avant.", ''];
      if (world.tick === 0 && session.loops.length > 0) {
        return [
          level.mirror
            ? `Ton reflet part à ta première touche, à l'envers${notes.realtime ? ", et n'attend pas" : ''}. T le retient d'un pas (1 action).`
            : `Ton clone part à ta première touche${notes.realtime ? " et n'attend pas" : ''}. T le retient d'un pas (1 action). G : ${notes.realtime ? 'pas à pas' : 'temps réel'}.`,
          '',
        ];
      }
      return ['', ''];
    })();
    this.message.textContent = text;
    this.message.dataset.tone = tone;
  }

  /**
   * The timeline: one row per clone, then the player's own recording, all on the same
   * steps so that a column is a moment. It shows what each clone is about to press, what
   * it has pressed, and which keys were lost. This is the game's central rule (clones
   * replay keys, not moves) made visible.
   */
  private renderTapes(state: GameState, other: string): void {
    const { world, session } = state;
    const { level } = world;
    if (level.maxClones === 0) return void this.clones.replaceChildren();
    const player = playerOf(world);
    const tapes = tapesOf(session);
    const now = session.current.length;
    const longest = Math.max(now + 1, ...tapes.map((tape) => tape.keys.length));
    const from = Math.max(0, Math.min(now - TRAIL, longest - WINDOW));
    const columns = Array.from({ length: WINDOW }, (_, i) => from + i);

    // The ruler: step numbers every five, and a mark on the present.
    const ruler = document.createElement('div');
    ruler.className = 'tape ruler';
    ruler.append(span('tape-label', `pas ${now + 1}`), span('tape-dim blank', ''));
    for (const tick of columns) {
      const numbered = (tick + 1) % 5 === 0;
      ruler.append(span(`mark${tick === now ? ' now' : ''}${numbered ? ' numbered' : ''}`, tick === now ? '▾' : numbered ? String(tick + 1) : ''));
    }

    const rows = tapes.map((tape, index) => {
      const row = document.createElement('div');
      row.className = `tape ${tape.role}`;
      const actor = world.actors[index];
      row.append(span('tape-label', tape.role === 'player' ? 'toi' : `${other} ${index + 1}`));

      if (tape.role === 'clone' && actor) {
        // A clone outside the player's slice is not on screen: say where it is instead.
        const inSight = actor.status !== 'active' || player.dim === 3 || (player.dim === 2 && actor.pos.z === player.pos.z) || player.dim === 1;
        const where = span(inSight ? 'tape-dim' : 'tape-dim away', actor.status === 'fallen' ? 'tombé' : `${actor.dim}D`);
        if (!inSight) where.title = 'Hors de ta coupe';
        row.append(where);
      } else {
        row.append(span('tape-dim blank', ''));
      }

      for (const tick of columns) {
        const key = tape.keys[tick];
        if (key === undefined) {
          // Past the end of a tape there is nothing; the player's next key lands on the present.
          row.append(span(tick === now ? (tape.role === 'player' ? 'key cursor' : 'key idle now') : 'key idle', ''));
          continue;
        }
        const phase = tick < tape.played ? (key.lost ? 'lost' : 'done') : tick === tape.played ? 'next' : 'ahead';
        const glyph = key.input.kind === 'move' ? key.input.dir : key.input.kind === 'wait' && key.input.held ? 'held' : key.input.kind;
        const cell = span(`key ${phase}${key.input.kind === 'wait' ? ' wait' : ''}`, GLYPHS[glyph] ?? '?');
        if (key.input.kind === 'wait' && key.input.held) cell.title = 'Attente ajoutée avec T';
        row.append(cell);
      }
      return row;
    });
    this.clones.replaceChildren(ruler, ...rows);
  }

  /** The key bar says what the keys do here and now: the verbs change with the dimension. */
  private renderKeys(state: GameState, other: string, realtime: boolean): void {
    const { world, session } = state;
    const player = playerOf(world);
    const entry = (keys: readonly string[], label: string, lit = false): HTMLSpanElement => {
      const node = document.createElement('span');
      if (lit) node.className = 'lit';
      for (const key of keys) {
        const cap = document.createElement('kbd');
        cap.textContent = key;
        node.append(cap);
      }
      node.append(` ${label}`);
      return node;
    };
    const moves =
      player.dim === 1
        ? [entry(['←', '→', '↑', '↓'], 'suivre le fil')]
        : player.dim === 3
          ? [entry(['←', '→'], 'marcher'), entry(['↑', '↓'], 'profondeur')]
          : [entry(['←', '→'], 'marcher'), entry(['↑'], 'sauter')];
    const action = transitionAt(state);
    const clones = session.loops.length > 0;
    this.keys.replaceChildren(
      ...moves,
      entry(['E'], action ?? 'dimension', action !== null),
      entry(['Espace'], 'attendre'),
      entry(['R'], world.level.maxClones > 0 ? `rembobiner → ${other}` : 'reprendre au début'),
      ...(clones ? [entry(['T'], `retenir ${session.loops.length > 1 ? `les ${other}s` : `le ${other}`}`, true)] : []),
      entry(['U'], 'annuler'),
      entry(['G'], realtime ? 'temps réel' : 'pas à pas', realtime),
      entry(['H'], 'aide'),
      entry(['Échap'], 'niveaux'),
      entry(['M'], 'son'),
    );
  }

  /** Status of a flow level: no timeline, no actions; a loop number and the same messages. */
  updateFlow(entry: LevelEntry, info: { dim: 2 | 3; loops: number; message: string; tone: string }): void {
    const { level } = entry;
    const other = level.mirror ? 'reflet' : 'clone';
    this.worldName.textContent = `${entry.label} · ${WORLD_NAMES[level.world - 1] ?? ''}`;
    this.levelName.textContent = level.name;
    for (const pip of this.dims.children) {
      const dim = (pip as HTMLElement).dataset.dim;
      if (dim !== undefined) pip.classList.toggle('on', dim === String(info.dim));
    }
    this.slice.hidden = true;
    this.clones.replaceChildren();
    // How many clones run with you, out of how many the level allows. R can always re-record.
    this.tickLabel.textContent = level.maxClones > 0 ? `${other}s` : 'course';
    this.tick.textContent = level.maxClones > 0 ? `${info.loops}/${level.maxClones}` : '';
    this.par.textContent = '';
    this.setBeat(null);
    this.message.textContent = info.message;
    this.message.dataset.tone = info.tone;
    const entryOf = (keys: readonly string[], label: string): HTMLSpanElement => {
      const node = document.createElement('span');
      for (const key of keys) {
        const cap = document.createElement('kbd');
        cap.textContent = key;
        node.append(cap);
      }
      node.append(` ${label}`);
      return node;
    };
    this.keys.replaceChildren(
      ...(info.dim === 3 ? [entryOf(['←', '→', '↑', '↓'], 'courir'), entryOf(['Espace'], 'sauter')] : [entryOf(['←', '→'], 'courir'), entryOf(['↑', 'Espace'], 'sauter (maintenir : plus haut)')]),
      entryOf(['E'], 'dimension'),
      ...(level.maxClones > 0 ? [entryOf(['R'], `rembobiner → ${other}`)] : []),
      entryOf(['U'], 'retenter'),
      entryOf(['Maj', 'R'], 'recommencer'),
      entryOf(['Échap'], 'niveaux'),
      entryOf(['M'], 'son'),
    );
  }

  setFlowClock(seconds: number, target: number | null, show: boolean): void {
    const text = show ? `${seconds.toFixed(1)} s` : '';
    const shown = target === null ? text : `${text}${text === '' ? '' : ' · '}⚡ ${target} s`;
    if (this.clock.textContent !== shown) this.clock.textContent = shown;
  }

  showFlowWin(entry: LevelEntry, seconds: number, target: number | null, isLast: boolean): void {
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

  /** The beat of real time: a bar that fills until the world steps by itself; null hides it. */
  setBeat(progress: number | null): void {
    const width = progress === null ? '0%' : `${Math.round(progress * 100)}%`;
    if (this.beat.style.width !== width) this.beat.style.width = width;
  }

  /** The running clock of the attempt, with the time to beat for the lightning mark. */
  setClock(seconds: number | null, level: Level): void {
    const target = swiftSeconds(level.solution);
    const text = seconds === null ? '' : `${seconds.toFixed(1)} s`;
    const shown = target === null ? text : `${text}${text === '' ? '' : ' · '}⚡ ${target} s`;
    // Called every frame: touch the DOM only when the text changes.
    if (this.clock.textContent !== shown) this.clock.textContent = shown;
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

  showWin(entry: LevelEntry, steps: number, stars: Stars, isLast: boolean, seconds: number | null = null): void {
    const par = entry.level.par;
    const target = swiftSeconds(entry.level.solution);
    const swift = seconds !== null && target !== null && seconds <= target;
    element('win-time').textContent =
      seconds === null ? '' : swift ? `⚡ ${seconds.toFixed(1)} s : d'une traite !` : `${seconds.toFixed(1)} s${target === null ? '' : ` · ⚡ en ${target} s ou moins`}`;
    element('win-eyebrow').textContent = isLast ? 'Dernier niveau terminé' : 'Niveau terminé';
    element('win-title').textContent = entry.level.name;
    element('win-stars').textContent = starText(stars);
    element('win-stats').textContent =
      par === null || stars === 3 ? `${steps} actions` : `${steps} actions · ★★★ en ${par} ou moins (attendre est gratuit, retenir avec T coûte 1)`;
    element('win-next').textContent = isLast ? 'retour aux niveaux' : 'niveau suivant';
    this.win.hidden = false;
  }

  hideWin(): void {
    this.win.hidden = true;
  }

  renderSelect({ entries, best, times, unlocked, cursor }: SelectModel): void {
    const rows: HTMLElement[] = [];
    // The chapter on the run comes first: it is the way into the game.
    const order = [WORLD_NAMES.length - 1, ...WORLD_NAMES.slice(0, -1).map((_, w) => w)];
    order.forEach((w) => {
      const worldName = WORLD_NAMES[w] ?? '';
      const cards = entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.level.world === w + 1)
        .map(({ entry, index }) => {
          const card = document.createElement('button');
          const open = unlocked(index);
          const record = best[entry.id];
          card.type = 'button';
          card.className = `level-card${open ? '' : ' locked'}${record !== undefined ? ' solved' : ''}${index === cursor ? ' current' : ''}`;
          card.disabled = !open;
          const name = document.createElement('span');
          name.className = 'name';
          name.textContent = open ? entry.level.name : '· · ·';
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent =
            record !== undefined
              ? entry.level.flow
                ? `${entry.label} ✓ ${(times[entry.id] ?? 0).toFixed(1)} s`
                : `${entry.label} ${starText(starsFor(entry.level.par, record))}${(times[entry.id] ?? Infinity) <= (swiftSeconds(entry.level.solution) ?? -1) ? ' ⚡' : ''}`
              : `${entry.label} ${open ? '' : '🔒'}`.trim();
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
      eyebrow.textContent = w === WORLD_NAMES.length - 1 ? 'En mouvement' : `Monde ${w + 1}`;
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
