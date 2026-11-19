import bg1 from '../assets/bg-w1.jpg';
import bg2 from '../assets/bg-w2.jpg';
import bg3 from '../assets/bg-w3.jpg';
import bg4 from '../assets/bg-w4.jpg';
import bg5 from '../assets/bg-w5.jpg';
import bg6 from '../assets/bg-w6.jpg';
import bg7 from '../assets/bg-w7.jpg';
import bg8 from '../assets/bg-w8.jpg';
import bgH1 from '../assets/bg-h1.jpg';
import bgH2 from '../assets/bg-h2.jpg';
import bgH3 from '../assets/bg-h3.jpg';
import bgH4 from '../assets/bg-h4.jpg';
import bgG1 from '../assets/bg-g1.jpg';
import bgG2 from '../assets/bg-g2.jpg';
import bgT1 from '../assets/bg-t1.jpg';
import bgT2 from '../assets/bg-t2.jpg';
import bgE1 from '../assets/bg-e1.jpg';
import bgE2 from '../assets/bg-e2.jpg';

/**
 * The family of textures and small scenery a chapter is built from: sandstone and grass
 * under a painted sky, basalt and embers under a burnt one, frosted stone under snow,
 * marble under a mosaic, or the meadow again with a second garden hanging beneath it.
 */
export type Biome = 'meadow' | 'ember' | 'givre' | 'tore' | 'envers' | 'hyperspace';

/**
 * How the specks in the air travel. `rise` and `fall` are pollen, embers and ash; `snow` is
 * heavier and sways; `orbit` goes round the screen sideways and comes back, as everything
 * does on a torus; `both` rises and falls at once, for a world with two grounds.
 */
export type MoteKind = 'drift' | 'snow' | 'orbit' | 'both';

/**
 * One look per chapter. The textures of its biome are re-tinted for each so that the
 * terrain sits in the light of its painted sky.
 */
export interface Theme {
  readonly biome: Biome;
  readonly background: string;
  /** Multiplied over stone and crates. */
  readonly stoneTint: string;
  /** Screened over them afterwards: dark rock keeps a colour of its own under a dark sky. Null for none. */
  readonly stoneLift: string | null;
  /** The living top of a block, grass or embers, takes this hue (null keeps the painted one), then this tint. */
  readonly grassHue: string | null;
  readonly grassTint: string;
  /** Flat colours for procedural details that must match the tinted textures. */
  readonly grassLight: string;
  readonly grassDark: string;
  readonly rockDark: string;
  /** Sea of clouds below the islands. */
  readonly haze: string;
  /** The line around the terrain's silhouette: dark on a bright sky, a rim of light on a dark one. */
  readonly outline: string;
  /** Small ironwork drawn in code, the stick of a lever, the posts of a door: it must stand out from the sky. */
  readonly metal: string;
  /** Specks in the air: pollen rising, embers rising, ash falling. `kind` defaults to a plain drift. */
  readonly mote: { readonly color: string; readonly drift: 1 | -1; readonly count: number; readonly kind?: MoteKind };
  /** The outline is a rim of light on a dark sky: dark posts and bases are then edged with it too. */
  readonly rim: boolean;
  /** A world with two grounds: what grows under its blocks, where an antipode walks. Null where undersides are bare rock. */
  readonly ceiling: { readonly light: string; readonly dark: string } | null;
  /** Root note (Hz) of the ambient scale, and whether it sings in major or minor. */
  readonly root: number;
  readonly mode: 'major' | 'minor';
}

type Palette = Pick<Theme, 'background' | 'stoneTint' | 'grassHue' | 'grassTint' | 'grassLight' | 'grassDark' | 'rockDark' | 'haze' | 'root'>;

/** The main campaign: bright stone, grass, pollen in the air, a major key. */
const meadow = (palette: Palette): Theme => ({
  ...palette,
  biome: 'meadow',
  stoneLift: null,
  outline: 'rgba(20, 16, 30, 0.55)',
  metal: '#1b1f2e',
  mote: { color: '#fff8ea', drift: 1, count: 16 },
  rim: false,
  ceiling: null,
  mode: 'major',
});

/** Hardcore: basalt lit from its own seams, a rim of light for an outline, a minor key. */
const ember = (palette: Palette & Pick<Theme, 'stoneLift' | 'outline' | 'mote'>): Theme => ({
  ...palette,
  biome: 'ember',
  metal: '#d8ccc0',
  rim: true,
  ceiling: null,
  mode: 'minor',
});

/** Le givre: frosted stone under a cap of snow, snow in the air, a major key pitched high and cold. */
const givre = (palette: Palette & Pick<Theme, 'stoneLift' | 'outline' | 'metal' | 'rim'> & { readonly snow: string }): Theme => {
  const { snow, ...rest } = palette;
  return { ...rest, biome: 'givre', mote: { color: snow, drift: -1, count: 46, kind: 'snow' }, ceiling: null, mode: 'major' };
};

/** Le tore: ivory marble edged in gold under a mosaic, gold dust going round and round. */
const tore = (palette: Palette & Pick<Theme, 'outline' | 'metal'> & { readonly gold: string }): Theme => {
  const { gold, ...rest } = palette;
  return { ...rest, biome: 'tore', stoneLift: null, mote: { color: gold, drift: 1, count: 20, kind: 'orbit' }, rim: true, ceiling: null, mode: 'major' };
};

/** L'envers: the meadow turned over. Its blocks are dressed on both sides, and pollen goes both ways. */
const envers = (palette: Palette & Pick<Theme, 'outline' | 'metal' | 'rim'> & { readonly ceiling: NonNullable<Theme['ceiling']> }): Theme => ({
  ...palette,
  biome: 'envers',
  stoneLift: null,
  mote: { color: '#fff8ea', drift: 1, count: 22, kind: 'both' },
  mode: 'major',
});

export const THEMES: readonly Theme[] = [
  meadow({
    background: bg1,
    stoneTint: '#fff4e6',
    grassHue: null,
    grassTint: '#fff6d8',
    grassLight: '#8fd14a',
    grassDark: '#3f8f2c',
    rockDark: '#6b5a4b',
    haze: '#ffd9c2',
    root: 220,
  }),
  meadow({
    background: bg2,
    stoneTint: '#e6f1f5',
    grassHue: null,
    grassTint: '#f0ffe0',
    grassLight: '#9be05a',
    grassDark: '#3d9a3a',
    rockDark: '#5d6470',
    haze: '#eafaf5',
    root: 246.94,
  }),
  meadow({
    background: bg3,
    stoneTint: '#cdb8e8',
    grassHue: '#e0609a',
    grassTint: '#e8d0f0',
    grassLight: '#f08ab8',
    grassDark: '#a8457f',
    rockDark: '#4a3a66',
    haze: '#e8a0b8',
    root: 196,
  }),
  meadow({
    background: bg4,
    stoneTint: '#8fa6c8',
    grassHue: '#25c79a',
    grassTint: '#a8d8d0',
    grassLight: '#4fe0b0',
    grassDark: '#1c8a78',
    rockDark: '#27344d',
    haze: '#2c5f7a',
    root: 174.61,
  }),
  meadow({
    background: bg5,
    stoneTint: '#9d8fd0',
    grassHue: '#7c6cff',
    grassTint: '#c0b8f0',
    grassLight: '#9a8cff',
    grassDark: '#5140b8',
    rockDark: '#2a2350',
    haze: '#3a2c70',
    root: 164.81,
  }),
  meadow({
    background: bg6,
    stoneTint: '#f0c9a0',
    grassHue: '#d9a13a',
    grassTint: '#f5dfb0',
    grassLight: '#f2c14e',
    grassDark: '#a8701e',
    rockDark: '#5c3a2a',
    haze: '#ffc79a',
    root: 207.65,
  }),
  meadow({
    background: bg7,
    stoneTint: '#dfe3f5',
    grassHue: '#8fb0e8',
    grassTint: '#eef2ff',
    grassLight: '#b9d0ff',
    grassDark: '#6f8fd0',
    rockDark: '#59607f',
    haze: '#e6e9ff',
    root: 233.08,
  }),
  meadow({
    background: bg8,
    stoneTint: '#e0b0b8',
    grassHue: '#e8607a',
    grassTint: '#f5d0d8',
    grassLight: '#ff8fa3',
    grassDark: '#b0405a',
    rockDark: '#4d2c44',
    haze: '#f5a5a0',
    root: 185,
  }),
  // Hardcore, chapters 9 to 12: the same islands, burnt.
  ember({
    background: bgH1,
    stoneTint: '#ffffff',
    stoneLift: '#3a1a1c',
    grassHue: null,
    grassTint: '#ffffff',
    grassLight: '#ffa040',
    grassDark: '#6e1c10',
    rockDark: '#2a1216',
    haze: '#d8481c',
    outline: 'rgba(255, 176, 120, 0.6)',
    mote: { color: '#ffb060', drift: 1, count: 28 },
    root: 146.83,
  }),
  ember({
    background: bgH2,
    stoneTint: '#ffffff',
    stoneLift: '#2a323e',
    grassHue: '#8fb4d8',
    grassTint: '#f0f6ff',
    grassLight: '#d2e6f8',
    grassDark: '#3e4e62',
    rockDark: '#1e242e',
    haze: '#8a94a6',
    outline: 'rgba(206, 226, 246, 0.55)',
    mote: { color: '#dfe5ee', drift: -1, count: 34 },
    root: 130.81,
  }),
  ember({
    background: bgH3,
    stoneTint: '#ffffff',
    stoneLift: '#30183c',
    grassHue: '#ff3d8a',
    grassTint: '#ffe8f4',
    grassLight: '#ff6aa8',
    grassDark: '#74164a',
    rockDark: '#1e0f28',
    haze: '#b0204e',
    outline: 'rgba(255, 138, 196, 0.55)',
    mote: { color: '#ff9cc4', drift: 1, count: 22 },
    root: 138.59,
  }),
  ember({
    background: bgH4,
    stoneTint: '#ffffff',
    stoneLift: '#16262a',
    grassHue: '#5ff0e0',
    grassTint: '#f0fffc',
    grassLight: '#d6fff8',
    grassDark: '#1c5e5a',
    rockDark: '#0e1618',
    haze: '#8fcfc6',
    outline: 'rgba(196, 255, 246, 0.6)',
    mote: { color: '#eafffb', drift: -1, count: 24 },
    root: 123.47,
  }),
  // Le givre, chapters 13 and 14: a pale morning, then the night under an aurora.
  givre({
    background: bgG1,
    stoneTint: '#ffffff',
    stoneLift: null,
    grassHue: null,
    grassTint: '#ffffff',
    grassLight: '#ffffff',
    grassDark: '#a9c2e6',
    rockDark: '#46587c',
    haze: '#fbe6f0',
    outline: 'rgba(22, 34, 66, 0.6)',
    metal: '#1b2440',
    rim: false,
    snow: '#ffffff',
    root: 261.63,
  }),
  givre({
    background: bgG2,
    stoneTint: '#c9d6f2',
    stoneLift: '#0e1a3c',
    grassHue: null,
    grassTint: '#bcd0f6',
    grassLight: '#e4f1ff',
    grassDark: '#5f83c4',
    rockDark: '#17224a',
    haze: '#5c96d8',
    outline: 'rgba(150, 240, 214, 0.6)',
    metal: '#d6e6f6',
    rim: true,
    snow: '#e6f2ff',
    root: 293.66,
  }),
  // Le tore, chapters 15 and 16: marble at dusk under a golden arc, then in a green night.
  tore({
    background: bgT1,
    stoneTint: '#fff3de',
    grassHue: null,
    grassTint: '#ffffff',
    grassLight: '#f6cf6a',
    grassDark: '#17616e',
    rockDark: '#3d2c6a',
    haze: '#c49ae6',
    outline: 'rgba(246, 200, 104, 0.85)',
    metal: '#f2cc74',
    gold: '#ffd98a',
    root: 196,
  }),
  tore({
    background: bgT2,
    stoneTint: '#e9e2ff',
    grassHue: null,
    grassTint: '#ffd9f2',
    grassLight: '#ffd27e',
    grassDark: '#3a3f96',
    rockDark: '#2c1f5e',
    haze: '#49c8c0',
    outline: 'rgba(255, 214, 130, 0.85)',
    metal: '#ffd98a',
    gold: '#ffe2a0',
    root: 174.61,
  }),
  // L'envers, chapters 17 and 18: the first meadow under a sky turned over, then the same at sunset.
  envers({
    background: bgE1,
    stoneTint: '#fff0e0',
    grassHue: null,
    grassTint: '#f4ffd8',
    grassLight: '#8fd14a',
    grassDark: '#3f8f2c',
    rockDark: '#5a4c5e',
    haze: '#ffd2b8',
    outline: 'rgba(16, 20, 48, 0.6)',
    metal: '#161a30',
    rim: false,
    ceiling: { light: '#ff9a8a', dark: '#c24a64' },
    root: 220,
  }),
  envers({
    background: bgE2,
    stoneTint: '#dcc6ee',
    grassHue: '#22c9a6',
    grassTint: '#d6f6ee',
    grassLight: '#58e6c4',
    grassDark: '#1b8a7c',
    rockDark: '#42285c',
    haze: '#ffb49a',
    outline: 'rgba(28, 14, 52, 0.6)',
    metal: '#22123c',
    rim: false,
    ceiling: { light: '#ffd35a', dark: '#c0822a' },
    root: 207.65,
  }),
  {
    biome: 'hyperspace', background: bg5, stoneTint: '#8778c3', stoneLift: '#211740',
    grassHue: '#60f2ed', grassTint: '#9affeb', grassLight: '#b1fff1', grassDark: '#358b9c',
    rockDark: '#201b41', haze: '#8176da', outline: 'rgba(173, 151, 255, 0.72)',
    metal: '#c5d8ff', ceiling: { light: '#e0b2ff', dark: '#8055a7' }, rim: true,
    mote: { color: '#9afaff', drift: 1, count: 55 }, root: 138.59, mode: 'minor',
  },
];

export const themeFor = (world: number): Theme => THEMES[(world - 1) % THEMES.length] ?? (THEMES[0] as Theme);

/** Colours shared by every chapter: they carry game meaning, not mood. */
export const COLORS = {
  ink: '#1b1f2e',
  paper: '#fff8ea',
  player: '#3fa7ff',
  playerDark: '#1f6fd0',
  clone: '#ffb347',
  cloneDark: '#d9801a',
  reflection: '#b9a6ff',
  reflectionDark: '#7a5fe0',
  /** A clone that falls upward: jade, far from the player's blue, a clone's amber and a reflection's violet. */
  antipode: '#3fdc98',
  antipodeDark: '#148a62',
  /** Ice is the same ice everywhere: its glint and the spray under whoever slides on it. */
  ice: '#d8f6ff',
  iceDeep: '#2f8fd8',
  /** A joined pair of edges wears one thread: gold from left to right, rose from bottom to top. */
  seamX: '#ffcf6b',
  seamY: '#ff9fd0',
  wire: '#7ff2ff',
  threshold: '#c79bff',
  exit: '#ffe9a8',
  channels: {
    a: '#ffb347',
    b: '#5fe3c2',
    c: '#ff7fb0',
    d: '#b6e35a',
    // Lever channels.
    e: '#ff7fd0',
    f: '#9be35a',
    g: '#7fc8ff',
    h: '#ffe066',
  } as Readonly<Record<string, string>>,
} as const;

export const channelColor = (channel: string): string => COLORS.channels[channel] ?? COLORS.paper;
