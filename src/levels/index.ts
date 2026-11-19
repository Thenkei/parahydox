import { formatLevelErrors, parseLevel } from '../core/level-parser';
import type { Level } from '../core/types';

export type CampaignId = 'main' | 'givre' | 'tore' | 'envers' | 'hardcore';

/** One folder per campaign; the main one is this folder itself. An empty or missing folder is a campaign without levels yet. */
const FILES: Readonly<Record<CampaignId, Record<string, string>>> = {
  main: import.meta.glob<string>('./*.txt', { query: '?raw', import: 'default', eager: true }),
  givre: import.meta.glob<string>('./givre/*.txt', { query: '?raw', import: 'default', eager: true }),
  tore: import.meta.glob<string>('./tore/*.txt', { query: '?raw', import: 'default', eager: true }),
  envers: import.meta.glob<string>('./envers/*.txt', { query: '?raw', import: 'default', eager: true }),
  hardcore: import.meta.glob<string>('./hardcore/*.txt', { query: '?raw', import: 'default', eager: true }),
};

export interface Chapter {
  /** The `world:` number its levels carry: unique across campaigns, so a level names its chapter by itself. */
  readonly world: number;
  readonly name: string;
}

/**
 * What opens a campaign: that many levels of another one solved, whichever they are. A count
 * and not a stretch from the first level, because N skips levels.
 */
export interface Requirement {
  readonly campaign: CampaignId;
  readonly solved: number;
}

/**
 * A campaign is an environment of its own: its chapters, its look, and what must be
 * solved before it opens.
 */
export interface Campaign {
  readonly id: CampaignId;
  readonly name: string;
  /** Prefix of its chapter numbers in labels: "3-2" in the main campaign, "H3-2" in hardcore. */
  readonly tag: string;
  readonly chapters: readonly Chapter[];
  /** What it waits for; null when it is open from the start. */
  readonly requires: Requirement | null;
  /** One line under its name, on the title screen and in the level list. */
  readonly pitch: string;
}

const chapters = (first: number, names: readonly string[]): Chapter[] => names.map((name, i) => ({ world: first + i, name }));

/**
 * In play order, which is also the order of the tabs. The side campaigns (one new rule each)
 * open along the main one; hardcore, which asks for all of it, comes last. Chapter numbers
 * say when a campaign was written, not where it is played: hardcore keeps 9 to 12.
 */
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
    id: 'givre',
    name: 'Le givre',
    tag: 'G',
    chapters: chapters(13, ['La glissade', 'Le verglas']),
    requires: { campaign: 'main', solved: 24 },
    pitch: 'Le même monde, sous la glace. Ici, on ne freine pas.',
  },
  {
    id: 'tore',
    name: 'Le tore',
    tag: 'T',
    chapters: chapters(15, ['Le ruban', 'La chute sans fin']),
    requires: { campaign: 'main', solved: 40 },
    pitch: "Le même monde, recousu bord à bord. Ce qui sort d'un côté revient de l'autre.",
  },
  {
    id: 'envers',
    name: "L'envers",
    tag: 'E',
    chapters: chapters(17, ['Les antipodes', 'Semelle contre semelle']),
    requires: { campaign: 'main', solved: 56 },
    pitch: 'Le même monde, la tête en bas. Tes clones tombent vers le ciel.',
  },
  {
    id: 'hardcore',
    name: 'Hardcore',
    tag: 'H',
    chapters: chapters(9, ['Le vertige', 'Le chœur', 'Le contre-jour', 'La ruine']),
    // Every level of the main campaign.
    requires: { campaign: 'main', solved: 64 },
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

/** "3-2", "G1-4": the chapter, then the place within it. One label per level, for levels given in play order. */
export function levelLabels(levels: readonly Pick<Level, 'world'>[]): string[] {
  const counters = new Map<number, number>();
  return levels.map(({ world }) => {
    const position = (counters.get(world) ?? 0) + 1;
    counters.set(world, position);
    return `${chapterLabel(world)}-${position}`;
  });
}

/**
 * The level a `?level=` value names, as an index into `labels`; -1 when it names none.
 * A number is a place in play order, counted from one and brought back into the list. A
 * label ("H2-5", in either case) is what the player reads on screen, and still names the
 * same level once campaigns are added or reordered: the one to put in a link meant to last.
 */
export function levelIndexOf(asked: string, labels: readonly string[]): number {
  if (labels.length === 0) return -1;
  const place = Number(asked);
  if (Number.isFinite(place)) return Math.min(labels.length, Math.max(1, Math.trunc(place))) - 1;
  const wanted = asked.trim().toUpperCase();
  return labels.findIndex((label) => label.toUpperCase() === wanted);
}

export interface LevelSource {
  /** Stable across releases: progress is saved under it. The file name, with its folder for a campaign that has one. */
  readonly id: string;
  readonly campaign: CampaignId;
  readonly source: string;
}

const sourcesOf = (campaign: CampaignId): LevelSource[] => {
  const files = FILES[campaign];
  return Object.keys(files)
    .sort()
    .map((path) => ({ id: path.replace(/^\.\//, '').replace(/\.txt$/, ''), campaign, source: files[path] ?? '' }));
};

/** Levels in play order: campaign after campaign; within one, files are numbered and the number is the order. */
export const LEVEL_SOURCES: readonly LevelSource[] = CAMPAIGNS.flatMap((campaign) => sourcesOf(campaign.id));

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
