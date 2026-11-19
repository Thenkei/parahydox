import crateIronUrl from '../assets/crate-iron.jpg';
import crateUrl from '../assets/crate.jpg';
import basaltAUrl from '../assets/tile-basalt-a.jpg';
import basaltBUrl from '../assets/tile-basalt-b.jpg';
import emberUrl from '../assets/tile-ember.jpg';
import grassUrl from '../assets/tile-grass.jpg';
import stoneAUrl from '../assets/tile-stone-a.jpg';
import stoneBUrl from '../assets/tile-stone-b.jpg';
import { type Biome, THEMES, type Theme } from './themes';

type Bitmap = HTMLCanvasElement;

/** Textures of one chapter, already tinted and sized for drawing. */
export interface TileSet {
  /** Block front faces; a block picks one from its position. */
  readonly stone: readonly Bitmap[];
  /** The same, darkened: faces turned away from the light in the 3D view. */
  readonly stoneSide: readonly Bitmap[];
  readonly grass: Bitmap;
  readonly crate: Bitmap;
  readonly crateSide: Bitmap;
  readonly crateTop: Bitmap;
}

export interface Assets {
  readonly backgrounds: readonly HTMLImageElement[];
  readonly tiles: readonly TileSet[];
}

const TILE_PX = 128;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

interface Tint {
  /** Re-hues the image, keeping its light and shade. */
  readonly hue?: string | null;
  /** Colours multiplied over it, in order. */
  readonly multiply: readonly string[];
  /** A colour screened over the result: lifts the darks without washing out the lights. */
  readonly lift?: string | null;
}

/** Draws `image` into a square bitmap, tinted. */
function tinted(image: HTMLImageElement, tint: Tint): Bitmap {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser');
  ctx.drawImage(image, 0, 0, TILE_PX, TILE_PX);
  const wash = (operation: GlobalCompositeOperation, color: string): void => {
    ctx.globalCompositeOperation = operation;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  };
  if (tint.hue) wash('hue', tint.hue);
  for (const color of tint.multiply) wash('multiply', color);
  if (tint.lift) wash('screen', tint.lift);
  return canvas;
}

const SHADE = '#8f93b0';
const LIGHT = '#fffaf0';

/** The source images of one biome. */
interface Sources {
  /** The plain block, and the carved or cracked one that breaks the pattern now and then. */
  readonly stone: HTMLImageElement;
  readonly stoneRare: HTMLImageElement;
  readonly top: HTMLImageElement;
  readonly crate: HTMLImageElement;
}

function buildTileSet(theme: Theme, { stone, stoneRare, top, crate }: Sources): TileSet {
  // The plain block is far more common than the other.
  const faces = [stone, stone, stone, stone, stoneRare, stone, stone, stone, stone, stone];
  const lift = theme.stoneLift;
  return {
    stone: faces.map((image) => tinted(image, { multiply: [theme.stoneTint], lift })),
    stoneSide: faces.map((image) => tinted(image, { multiply: [theme.stoneTint, SHADE], lift })),
    grass: tinted(top, { hue: theme.grassHue, multiply: [theme.grassTint] }),
    crate: tinted(crate, { multiply: [theme.stoneTint], lift }),
    crateSide: tinted(crate, { multiply: [theme.stoneTint, SHADE], lift }),
    crateTop: tinted(crate, { multiply: [theme.stoneTint, LIGHT], lift }),
  };
}

const SOURCE_URLS: Readonly<Record<Biome, Readonly<Record<keyof Sources, string>>>> = {
  meadow: { stone: stoneAUrl, stoneRare: stoneBUrl, top: grassUrl, crate: crateUrl },
  ember: { stone: basaltAUrl, stoneRare: basaltBUrl, top: emberUrl, crate: crateIronUrl },
};

async function loadSources(biome: Biome): Promise<Sources> {
  const urls = SOURCE_URLS[biome];
  const [stone, stoneRare, top, crate] = await Promise.all([loadImage(urls.stone), loadImage(urls.stoneRare), loadImage(urls.top), loadImage(urls.crate)]);
  return { stone, stoneRare, top, crate };
}

export async function loadAssets(): Promise<Assets> {
  const [meadow, ember, backgrounds] = await Promise.all([
    loadSources('meadow'),
    loadSources('ember'),
    Promise.all(THEMES.map((theme) => loadImage(theme.background))),
  ]);
  const sources: Readonly<Record<Biome, Sources>> = { meadow, ember };
  return {
    backgrounds,
    tiles: THEMES.map((theme) => buildTileSet(theme, sources[theme.biome])),
  };
}
