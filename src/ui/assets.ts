import crateUrl from '../assets/crate.jpg';
import grassUrl from '../assets/tile-grass.jpg';
import stoneAUrl from '../assets/tile-stone-a.jpg';
import stoneBUrl from '../assets/tile-stone-b.jpg';
import { THEMES, type Theme } from './themes';

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

/** Draws `image` into a square bitmap, optionally re-hued, then multiplied by each tint. */
function tinted(image: HTMLImageElement, hue: string | null, ...tints: string[]): Bitmap {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser');
  ctx.drawImage(image, 0, 0, TILE_PX, TILE_PX);
  if (hue !== null) {
    ctx.globalCompositeOperation = 'hue';
    ctx.fillStyle = hue;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  }
  ctx.globalCompositeOperation = 'multiply';
  for (const tint of tints) {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  }
  return canvas;
}

const SHADE = '#8f93b0';
const LIGHT = '#fffaf0';

function buildTileSet(theme: Theme, stoneA: HTMLImageElement, stoneB: HTMLImageElement, grass: HTMLImageElement, crate: HTMLImageElement): TileSet {
  // The plain block is far more common than the carved one.
  const faces = [stoneA, stoneA, stoneA, stoneA, stoneB, stoneA, stoneA, stoneA, stoneA, stoneA];
  return {
    stone: faces.map((image) => tinted(image, null, theme.stoneTint)),
    stoneSide: faces.map((image) => tinted(image, null, theme.stoneTint, SHADE)),
    grass: tinted(grass, theme.grassHue, theme.grassTint),
    crate: tinted(crate, null, theme.stoneTint),
    crateSide: tinted(crate, null, theme.stoneTint, SHADE),
    crateTop: tinted(crate, null, theme.stoneTint, LIGHT),
  };
}

export async function loadAssets(): Promise<Assets> {
  const [stoneA, stoneB, grass, crate, ...backgrounds] = await Promise.all([
    loadImage(stoneAUrl),
    loadImage(stoneBUrl),
    loadImage(grassUrl),
    loadImage(crateUrl),
    ...THEMES.map((theme) => loadImage(theme.background)),
  ]);
  if (!stoneA || !stoneB || !grass || !crate) throw new Error('Textures failed to load');
  return {
    backgrounds,
    tiles: THEMES.map((theme) => buildTileSet(theme, stoneA, stoneB, grass, crate)),
  };
}
