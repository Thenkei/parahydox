import { formatLevelErrors, parseLevel } from '../core/level-parser';
import type { Level } from '../core/types';

const mainSources = import.meta.glob('./*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const hardcoreSources = import.meta.glob('./hardcore/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export type CampaignId = 'main' | 'hardcore';

export interface Chapter {
  /** The `world:` number its levels carry: unique across campaigns, so a level names its chapter by itself. */
  readonly world: number;
  readonly name: string;
}

/**
 * A campaign is an environment of its own: its chapters, its look, and what must be
 * finished before it opens.
 */
export interface Campaign {
  readonly id: CampaignId;
  readonly name: string;
  /** Prefix of its chapter numbers in labels: "3-2" in the main campaign, "H3-2" here. */
  readonly tag: string;
  readonly chapters: readonly Chapter[];
  /** The campaign to finish, every level of it, before this one opens; null when it is open from the start. */
  readonly requires: CampaignId | null;
  /** One line under its name, on the title screen and in the level list. */
  readonly pitch: string;
}

const chapters = (first: number, names: readonly string[]): Chapter[] => names.map((name, i) => ({ world: first + i, name }));

/** In play order. */
export const CAMPAIGNS: readonly Campaign[] = [
  {
    id: 'main',
    name: 'Parahydox',
    tag: '',
    chapters: chapters(1, ['Le fil', 'Le volume', 'La boucle', 'Le croisement', 'La divergence', 'Le levier', 'Le reflet', "L'éphémère"]),
    requires: null,
    pitch: 'Un seul monde. Trois façons de le lire.',
  },
  {
    id: 'hardcore',
    name: 'Hardcore',
    tag: 'H',
    chapters: chapters(9, ['Le vertige', 'Le chœur', 'Le contre-jour', 'La ruine']),
    requires: 'main',
    pitch: "Le même monde, à la braise. Trente-deux niveaux d'élite.",
  },
];

export function campaignById(id: CampaignId): Campaign {
  const found = CAMPAIGNS.find((campaign) => campaign.id === id);
  if (!found) throw new Error(`Invariant violated: no campaign "${id}"`);
  return found;
}

/** The campaign a chapter belongs to; an unknown chapter number is the main campaign's problem to report. */
export const campaignOfWorld = (world: number): Campaign =>
  CAMPAIGNS.find((campaign) => campaign.chapters.some((chapter) => chapter.world === world)) ?? campaignById('main');

export const chapterName = (world: number): string =>
  campaignOfWorld(world).chapters.find((chapter) => chapter.world === world)?.name ?? '';

/** "3" in the main campaign, "H3" in hardcore: the chapter as the player counts it. */
export function chapterLabel(world: number): string {
  const campaign = campaignOfWorld(world);
  const position = campaign.chapters.findIndex((chapter) => chapter.world === world);
  return `${campaign.tag}${position < 0 ? world : position + 1}`;
}

export interface LevelSource {
  /** Stable across releases: progress is saved under it. The file name, with its folder for a campaign that has one. */
  readonly id: string;
  readonly campaign: CampaignId;
  readonly source: string;
}

const sourcesOf = (campaign: CampaignId, files: Record<string, string>): LevelSource[] =>
  Object.keys(files)
    .sort()
    .map((path) => ({ id: path.replace(/^\.\//, '').replace(/\.txt$/, ''), campaign, source: files[path] ?? '' }));

/** Levels in play order: the main campaign, then hardcore; within one, files are numbered and the number is the order. */
export const LEVEL_SOURCES: readonly LevelSource[] = [...sourcesOf('main', mainSources), ...sourcesOf('hardcore', hardcoreSources)];

/** A level that does not parse, or that sits in the wrong campaign's folder, is a build error, not something to discover while playing. */
export function loadLevels(): Level[] {
  return LEVEL_SOURCES.map(({ id, campaign, source }) => {
    const parsed = parseLevel(source);
    if (!parsed.ok) throw new Error(formatLevelErrors(id, parsed.error));
    const level = parsed.value;
    if (!campaignById(campaign).chapters.some((chapter) => chapter.world === level.world)) {
      throw new Error(`Invalid level "${id}": world ${level.world} is not a chapter of the ${campaign} campaign`);
    }
    return level;
  });
}
