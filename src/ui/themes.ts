import bg1 from '../assets/bg-w1.jpg';
import bg2 from '../assets/bg-w2.jpg';
import bg3 from '../assets/bg-w3.jpg';
import bg4 from '../assets/bg-w4.jpg';
import bg5 from '../assets/bg-w5.jpg';
import bg6 from '../assets/bg-w6.jpg';
import bg7 from '../assets/bg-w7.jpg';
import bg8 from '../assets/bg-w8.jpg';

/**
 * One look per chapter. The same stone, grass and crate textures are re-tinted for each
 * so that the terrain sits in the light of its painted sky.
 */
export interface Theme {
  readonly background: string;
  /** Multiplied over stone and crates. */
  readonly stoneTint: string;
  /** Grass takes this hue (null keeps the painted green), then this tint. */
  readonly grassHue: string | null;
  readonly grassTint: string;
  /** Flat colours for procedural details that must match the tinted textures. */
  readonly grassLight: string;
  readonly grassDark: string;
  readonly rockDark: string;
  /** Sea of clouds below the islands. */
  readonly haze: string;
  /** Root note (Hz) of the ambient scale. */
  readonly root: number;
}

export const THEMES: readonly Theme[] = [
  {
    background: bg1,
    stoneTint: '#fff4e6',
    grassHue: null,
    grassTint: '#fff6d8',
    grassLight: '#8fd14a',
    grassDark: '#3f8f2c',
    rockDark: '#6b5a4b',
    haze: '#ffd9c2',
    root: 220,
  },
  {
    background: bg2,
    stoneTint: '#e6f1f5',
    grassHue: null,
    grassTint: '#f0ffe0',
    grassLight: '#9be05a',
    grassDark: '#3d9a3a',
    rockDark: '#5d6470',
    haze: '#eafaf5',
    root: 246.94,
  },
  {
    background: bg3,
    stoneTint: '#cdb8e8',
    grassHue: '#e0609a',
    grassTint: '#e8d0f0',
    grassLight: '#f08ab8',
    grassDark: '#a8457f',
    rockDark: '#4a3a66',
    haze: '#e8a0b8',
    root: 196,
  },
  {
    background: bg4,
    stoneTint: '#8fa6c8',
    grassHue: '#25c79a',
    grassTint: '#a8d8d0',
    grassLight: '#4fe0b0',
    grassDark: '#1c8a78',
    rockDark: '#27344d',
    haze: '#2c5f7a',
    root: 174.61,
  },
  {
    background: bg5,
    stoneTint: '#9d8fd0',
    grassHue: '#7c6cff',
    grassTint: '#c0b8f0',
    grassLight: '#9a8cff',
    grassDark: '#5140b8',
    rockDark: '#2a2350',
    haze: '#3a2c70',
    root: 164.81,
  },
  {
    background: bg6,
    stoneTint: '#f0c9a0',
    grassHue: '#d9a13a',
    grassTint: '#f5dfb0',
    grassLight: '#f2c14e',
    grassDark: '#a8701e',
    rockDark: '#5c3a2a',
    haze: '#ffc79a',
    root: 207.65,
  },
  {
    background: bg7,
    stoneTint: '#dfe3f5',
    grassHue: '#8fb0e8',
    grassTint: '#eef2ff',
    grassLight: '#b9d0ff',
    grassDark: '#6f8fd0',
    rockDark: '#59607f',
    haze: '#e6e9ff',
    root: 233.08,
  },
  {
    background: bg8,
    stoneTint: '#e0b0b8',
    grassHue: '#e8607a',
    grassTint: '#f5d0d8',
    grassLight: '#ff8fa3',
    grassDark: '#b0405a',
    rockDark: '#4d2c44',
    haze: '#f5a5a0',
    root: 185,
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
