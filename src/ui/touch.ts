import { type LevelEntry, type PlayStatus, cloneWord } from './hud';
import { type Direction, NEUTRAL, type Point, STICK_RADIUS, codesOf, directionOf, follow, knobOffset } from './stick';

/**
 * Where touch input goes: the same entry points the keyboard uses, by key code. Touch is one
 * more way of pressing keys, so the physics, the tapes and the clones never learn it exists:
 * a clone recorded with a thumb replays exactly like one recorded with a finger on a key.
 */
export interface InputSink {
  press(code: string, shift: boolean): void;
  release(code: string): void;
}

type InputMode = 'keys' | 'touch';

/** The thumb on the stick: which pointer, where its centre is now, and what it holds down. */
interface Grip {
  readonly pointer: number;
  /** The layer's box when the thumb landed: pointer coordinates are read against it. */
  readonly frame: DOMRect;
  origin: Point;
  thumb: Point;
  direction: Direction;
}

type PadKind = 'jump' | 'shift' | 'boots' | 'rewind' | 'retry';

interface PadButton {
  readonly node: HTMLButtonElement;
  readonly label: HTMLSpanElement;
  readonly code: string;
  /** Pointers holding it: two fingers on one button let go of it with the last one. */
  readonly pointers: Set<number>;
}

interface MenuItem {
  readonly label: string;
  readonly code: string;
  readonly shift: boolean;
  /** Only in levels that come with a demonstration. */
  readonly lessonOnly?: boolean;
}

const MENU: readonly MenuItem[] = [
  { label: 'Recommencer le niveau', code: 'KeyR', shift: true },
  { label: 'Revoir la démo', code: 'KeyH', shift: false, lessonOnly: true },
  { label: 'Indice', code: 'KeyH', shift: true },
  { label: 'Son', code: 'KeyM', shift: false },
  { label: 'Niveaux', code: 'Escape', shift: false },
];

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

/**
 * The controls a phone needs in place of a keyboard: a stick that appears under the left
 * thumb wherever it lands, and buttons under the right one. They show while the last input
 * was a touch, and give way to the key bar as soon as a key is pressed (an iPad with a
 * keyboard, a laptop with a touch screen).
 */
export class TouchControls {
  private readonly layer = make('div', 'touch');
  private readonly zone = make('div', 'touch-zone');
  private readonly stick = make('div', 'stick');
  private readonly knob = make('div', 'stick-knob');
  private readonly arrows = new Map<string, HTMLSpanElement>();
  private readonly pad = new Map<PadKind, PadButton>();
  private readonly sheet = make('div', 'touch-sheet');
  private readonly field = make('p', 'pad-field');
  private readonly demoItem: HTMLButtonElement;
  private grip: Grip | null = null;
  /** Whether ↑ ↓ mean something where the hero stands: on a wire or in depth, not in a slice. */
  private vertical = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly sink: InputSink,
  ) {
    const hud = root.querySelector<HTMLElement>('#hud');
    const meters = root.querySelector<HTMLElement>('.hud-meters');
    if (!hud || !meters) throw new Error('Missing #hud or .hud-meters in index.html');

    for (const [code, glyph] of [['ArrowLeft', '◀'], ['ArrowRight', '▶'], ['ArrowUp', '▲'], ['ArrowDown', '▼']] as const) {
      const arrow = make('span', `stick-arrow ${code}`, glyph);
      this.arrows.set(code, arrow);
      this.stick.append(arrow);
    }
    this.stick.append(this.knob);
    this.stick.setAttribute('aria-hidden', 'true');

    const small = make('div', 'pad-row');
    small.append(this.button('boots', 'B', 'KeyB', 'bottes'), this.button('rewind', 'R', 'KeyR'), this.button('retry', 'X', 'KeyX', 'retenter'));
    const large = make('div', 'pad-row');
    large.append(this.button('shift', 'E', 'KeyE', 'dimension'), this.button('jump', 'SAUT', 'Space', 'tenir : plus haut'));
    const pad = make('div', 'pad');
    this.field.hidden = true;
    pad.append(this.field, small, large);

    const items = make('div', 'sheet-items');
    let demo: HTMLButtonElement | null = null;
    for (const item of MENU) {
      const node = make('button', 'sheet-item', item.label);
      node.type = 'button';
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        this.closeMenu();
        this.sink.press(item.code, item.shift);
        this.sink.release(item.code);
      });
      if (item.lessonOnly) demo = node;
      items.append(node);
    }
    if (!demo) throw new Error('Invariant violated: the menu has no demo item');
    this.demoItem = demo;
    this.sheet.append(items);
    this.sheet.hidden = true;
    this.sheet.addEventListener('click', () => this.closeMenu());

    const toggle = make('button', 'menu-toggle for-touch', '☰');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Menu');
    toggle.addEventListener('click', () => this.openMenu());
    meters.append(toggle);

    this.layer.append(this.zone, this.stick, pad, this.sheet);
    hud.append(this.layer);
    this.listenToStick();

    // The controls follow the hand on the device: a coarse pointer starts on touch, a key hands back to the bar.
    this.setMode(window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys');
    window.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') this.setMode('touch');
    }, { capture: true, passive: true });
    window.addEventListener('keydown', (event) => {
      if (!event.repeat) this.setMode('keys');
    }, { capture: true, passive: true });
    // A notification, a call or the app switcher takes the thumbs away without a pointerup.
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  /** What the controls offer follows the level and the hero: the same facts the key bar is drawn from. */
  update(entry: LevelEntry, status: PlayStatus): void {
    const { level } = entry;
    this.vertical = status.dim !== 2;
    this.stick.classList.toggle('vertical', this.vertical);

    // The field (pull, boots, the countdown to the next flip) lives in the key bar, hidden here: it gets its own line.
    this.field.textContent = status.field;
    this.field.hidden = status.field === '';
    this.show(this.padButton('boots'), status.field !== '');

    const shift = this.padButton('shift');
    shift.label.textContent = status.action ?? 'dimension';
    shift.node.classList.toggle('lit', status.action !== null);

    const rewind = this.padButton('rewind');
    this.show(rewind, level.maxClones > 0);
    rewind.label.textContent = `→ ${cloneWord(level)}`;

    this.demoItem.hidden = entry.lesson === null;
    // Leaving a wire for a slice drops ↑ ↓ from under a thumb that may still be pushing them.
    if (this.grip) this.steer(this.grip);
  }

  /** Lets go of everything the thumbs hold. */
  releaseAll(): void {
    this.drop();
    for (const button of this.pad.values()) this.letGo(button);
  }

  private setMode(mode: InputMode): void {
    if (this.root.dataset.input === mode) return;
    this.root.dataset.input = mode;
    if (mode === 'keys') {
      this.releaseAll();
      this.closeMenu();
    }
  }

  private padButton(kind: PadKind): PadButton {
    const button = this.pad.get(kind);
    if (!button) throw new Error(`Invariant violated: no ${kind} button on the pad`);
    return button;
  }

  private show(button: PadButton, shown: boolean): void {
    button.node.hidden = !shown;
    // A button that leaves under a finger must not leave its key down.
    if (!shown) this.letGo(button);
  }

  private button(kind: PadKind, cap: string, code: string, text = ''): HTMLButtonElement {
    const node = make('button', `pad-button ${kind}`);
    node.type = 'button';
    // Never focusable: a focused button would answer the keyboard's Space and Enter as clicks.
    node.tabIndex = -1;
    const label = make('span', 'pad-label', text);
    node.append(make('span', 'pad-cap', cap), label);
    const button: PadButton = { node, label, code, pointers: new Set() };
    this.pad.set(kind, button);

    node.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      node.setPointerCapture(event.pointerId);
      const first = button.pointers.size === 0;
      button.pointers.add(event.pointerId);
      if (!first) return;
      node.classList.add('down');
      this.sink.press(code, false);
    });
    const lift = (event: PointerEvent): void => {
      if (!button.pointers.delete(event.pointerId) || button.pointers.size > 0) return;
      node.classList.remove('down');
      this.sink.release(code);
    };
    node.addEventListener('pointerup', lift);
    node.addEventListener('pointercancel', lift);
    node.addEventListener('lostpointercapture', lift);
    // iOS opens its magnifier on a long press without this, and a held jump is a long press.
    node.addEventListener('contextmenu', (event) => event.preventDefault());
    return node;
  }

  private letGo(button: PadButton): void {
    if (button.pointers.size === 0) return;
    button.pointers.clear();
    button.node.classList.remove('down');
    this.sink.release(button.code);
  }

  private listenToStick(): void {
    const at = (event: PointerEvent, frame: DOMRect): Point => ({ x: event.clientX - frame.left, y: event.clientY - frame.top });

    this.zone.addEventListener('pointerdown', (event) => {
      // One stick: a second thumb on the left half is resting, not steering.
      if (this.grip) return;
      event.preventDefault();
      this.zone.setPointerCapture(event.pointerId);
      const frame = this.layer.getBoundingClientRect();
      const thumb = at(event, frame);
      this.grip = { pointer: event.pointerId, frame, origin: thumb, thumb, direction: NEUTRAL };
      this.stick.classList.add('held');
      this.draw(this.grip);
    });
    this.zone.addEventListener('pointermove', (event) => {
      const grip = this.grip;
      if (!grip || event.pointerId !== grip.pointer) return;
      grip.thumb = at(event, grip.frame);
      grip.origin = follow(grip.origin, grip.thumb);
      this.steer(grip);
    });
    const end = (event: PointerEvent): void => {
      if (this.grip?.pointer === event.pointerId) this.drop();
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
    this.zone.addEventListener('lostpointercapture', end);
    this.zone.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** Reads the thumb as arrows and presses or releases only what changed. */
  private steer(grip: Grip): void {
    const next = directionOf(grip.thumb.x - grip.origin.x, grip.thumb.y - grip.origin.y, this.vertical, grip.direction);
    this.hold(grip.direction, next);
    grip.direction = next;
    this.draw(grip);
  }

  private hold(from: Direction, to: Direction): void {
    const before = codesOf(from);
    const after = codesOf(to);
    // Release first: ← then → in the same frame must never read as both held.
    for (const code of before) if (!after.includes(code)) this.sink.release(code);
    for (const code of after) if (!before.includes(code)) this.sink.press(code, false);
  }

  private draw(grip: Grip): void {
    this.stick.style.left = `${grip.origin.x}px`;
    this.stick.style.top = `${grip.origin.y}px`;
    const knob = knobOffset(grip.origin, grip.thumb, STICK_RADIUS);
    this.knob.style.transform = `translate(${knob.x}px, ${knob.y}px)`;
    const held = codesOf(grip.direction);
    for (const [code, arrow] of this.arrows) arrow.classList.toggle('on', held.includes(code));
  }

  /** The thumb is off the stick: everything it held goes up, and the stick goes back to rest. */
  private drop(): void {
    const grip = this.grip;
    if (!grip) return;
    this.grip = null;
    this.hold(grip.direction, NEUTRAL);
    if (this.zone.hasPointerCapture(grip.pointer)) this.zone.releasePointerCapture(grip.pointer);
    this.stick.classList.remove('held');
    this.stick.style.left = '';
    this.stick.style.top = '';
    this.knob.style.transform = '';
    for (const arrow of this.arrows.values()) arrow.classList.remove('on');
  }

  private openMenu(): void {
    this.releaseAll();
    this.sheet.hidden = false;
  }

  private closeMenu(): void {
    this.sheet.hidden = true;
  }
}
