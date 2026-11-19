import type { Assets, TileSet } from './assets';
import { drawCharacter } from './render/character';
import { THEMES } from './themes';

// Each page is built with the same textures as the chapter it remembers.
const PAGES = [
  { worlds: [1, 2, 3, 4, 5, 6, 7, 8], lines: ['A GAME BY', 'MORGAN PERRE'] },
  { worlds: [13, 14], lines: ['LES NIVEAUX', 'MORGAN PERRE'] },
  { worlds: [15, 16], lines: ['CODE', 'TYPESCRIPT'] },
  { worlds: [17, 18], lines: ['RENDU DU JEU', 'CANVAS 2D'] },
  { worlds: [10, 11], lines: ['CIELS ET TEXTURES', 'CODEX'] },
  { worlds: [9, 12], lines: ['MUSIQUE ET SON', 'WEB AUDIO'] },
  { worlds: [19], lines: ['MERCI', 'D’AVOIR JOUÉ'] },
] as const;

/** Each pair of hex digits is one row of five terrain cells, most significant cell on the left. */
const LETTERS: Readonly<Record<string, string>> = {
  A: '0e11111f111111', B: '1e11111e11111e', C: '0f10101010100f', D: '1e11111111111e',
  E: '1f10101e10101f', F: '1f10101e101010', G: '0f10101311110f', H: '1111111f111111',
  I: '0e04040404040e', J: '0702020212120c', K: '11121418141211', L: '1010101010101f',
  M: '111b1515111111', N: '11191915131311', O: '0e11111111110e', P: '1e11111e101010',
  Q: '0e11111115120d', R: '1e11111e141211', S: '0f10100e01011e', T: '1f040404040404',
  U: '1111111111110e', V: '11111111110a04', W: '1111111515150a', X: '11110a040a1111',
  Y: '11110a04040404', Z: '1f01020408101f', '2': '0e11010204081f', '’': '04040800000000',
};

function brick(ctx: CanvasRenderingContext2D, tiles: TileSet, x: number, y: number, size: number, cap: string, seed: number): void {
  const face = tiles.stone[seed % tiles.stone.length] ?? tiles.grass;
  ctx.drawImage(face, x, y, size - 0.4, size - 0.4);
  ctx.fillStyle = cap;
  ctx.fillRect(x, y, size - 0.4, Math.max(1, size * 0.18));
}

function masonry(ctx: CanvasRenderingContext2D, assets: Assets, worlds: readonly number[], text: string, cx: number, top: number, size: number): void {
  const start = cx - ((text.length * 6 - 1) * size) / 2;
  [...text].forEach((letter, i) => {
    const world = worlds[Math.min(worlds.length - 1, Math.floor(i * worlds.length / text.length))]!;
    const tiles = assets.tiles[world - 1]!;
    const cap = THEMES[world - 1]!.grassLight;
    const rows = LETTERS[letter === 'É' ? 'E' : letter];
    if (letter === 'É') brick(ctx, tiles, start + (6 * i + 3) * size, top - 1.4 * size, size, cap, i);
    if (!rows) return;
    for (let row = 0; row < 7; row++) {
      const bits = Number.parseInt(rows.slice(row * 2, row * 2 + 2), 16);
      for (let col = 0; col < 5; col++) {
        if (bits & (16 >> col)) brick(ctx, tiles, start + (6 * i + col) * size, top + row * size, size, cap, i + row + col);
      }
    }
  });
}

const PAGE_MS = 5500;

/** Draws each still once. The actor and sky belong to the same world as the lettering. */
export class Credits {
  private page = 0;
  private since = 0;
  private drawn = '';
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly assets: Assets) {
    const canvas = document.querySelector<HTMLCanvasElement>('#credits-view');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) throw new Error('Credits canvas unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  start(now: number): void {
    this.page = 0;
    this.since = now;
    this.drawn = '';
    this.frame(now);
  }

  /** False after the last page, where advancing returns to the level selection. */
  turn(delta: number, now: number): boolean {
    if (this.page + delta >= PAGES.length) return false;
    this.page = Math.max(0, this.page + delta);
    this.since = now;
    this.frame(now);
    return true;
  }

  frame(now: number): void {
    if (!this.reduced.matches && now - this.since >= PAGE_MS && this.page < PAGES.length - 1) {
      this.page++;
      this.since = now;
    }
    const { canvas, ctx } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    const key = `${this.page}/${w}/${h}/${ratio}`;
    if (key === this.drawn || w === 0 || h === 0) return;
    this.drawn = key;
    const page = PAGES[this.page]!;
    const tiles = this.assets.tiles[page.worlds[0] - 1]!;
    const theme = THEMES[page.worlds[0] - 1]!;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const sky = this.assets.backgrounds[page.worlds[0] - 1]!;
    const scale = Math.max(w / sky.width, h / sky.height);
    ctx.drawImage(sky, (w - sky.width * scale) / 2, (h - sky.height * scale) / 2, sky.width * scale, sky.height * scale);
    const shade = ctx.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, 'rgba(10, 8, 29, .4)');
    shade.addColorStop(0.43, 'rgba(10, 8, 29, .90)');
    shade.addColorStop(1, 'rgba(10, 8, 29, .64)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);

    const [role, name] = page.lines;
    const cell = Math.min(w * 0.88 / (6 * name.length - 1), h * 0.033);
    const small = Math.min(cell * 0.58, w * 0.82 / (role.length * 6 - 1));
    masonry(ctx, this.assets, page.worlds, role, w / 2, h * 0.44 - small * 9, small);
    masonry(ctx, this.assets, page.worlds, name, w / 2, h * 0.46, cell);

    const unit = Math.max(8, Math.min(w / 32, h / 22));
    const floor = h * 0.79;
    for (let col = -1; col <= Math.ceil(w / unit); col++) {
      const x = col * unit;
      const island = (col + this.page + 3) % 13;
      if (island > 9) continue;
      for (let row = 0; row < (island > 0 && island < 9 ? 3 : 1); row++) {
        brick(ctx, tiles, x, floor + row * unit, unit, row === 0 ? theme.grassLight : theme.rockDark, col + row + 2);
      }
    }
    drawCharacter(ctx, (5.5 - this.page) * unit + 13 * unit, floor, unit * 1.55, {
      role: 'player', reflection: false, antipode: false, boots: false, inverted: false, onWire: false,
      facing: 1, stride: null, airborne: false, joy: true, squash: 0, alpha: 1, time: 0, seed: 0,
    });
    canvas.setAttribute('aria-label', this.page === 0 ? 'A game by Morgan Perre' : page.lines.join(' · '));
    const caption = document.getElementById('credits-caption')!;
    caption.textContent = `${this.page + 1} / ${PAGES.length} · ${this.page === PAGES.length - 1 ? 'Fin' : 'Générique'}`;
  }
}
