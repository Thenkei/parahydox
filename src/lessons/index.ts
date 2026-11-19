import { formatLevelErrors, parseLevel } from '../core/level-parser';
import type { Level } from '../core/types';
import type { FrameInput } from '../flow/physics';
import { parseTape } from '../flow/tape';
import bootsRoom from './boots.txt?raw';
import cloneRoom from './clone.txt?raw';
import depthRoom from './depth.txt?raw';

export type LessonId = 'depth' | 'clone' | 'boots';

export function lessonFor(level: Level): LessonId | null {
  if (level.gravity !== 'normal') return 'boots';
  if (level.maxClones > 0 && !level.antipode && !level.mirror) return 'clone';
  if (level.size.d > 1 && level.cells.some(cell => cell.threshold)) return 'depth';
  return null;
}

interface Cue {
  readonly end: number;
  readonly key: string;
  readonly caption: string;
}

export interface Lesson {
  readonly level: Level;
  readonly loops: FrameInput[][];
  readonly cues: readonly Cue[];
}

/** A new row of beats starts a new loop. Key callouts and captions share the tape's simulation clock. */
function lesson(source: string, loops: readonly (readonly [tape: string, key: string, caption: string][])[]): Lesson {
  const level = parseLevel(source);
  if (!level.ok) throw new Error(formatLevelErrors('lesson', level.error));
  const cues: Cue[] = [];
  let end = 0;
  const inputs = loops.map(beats => beats.flatMap(([tape, key, caption]) => {
    const parsed = parseTape(tape);
    if (!parsed.ok) throw new Error(parsed.error);
    const [frames] = parsed.value;
    if (parsed.value.length !== 1 || !frames?.length) throw new Error(`Invalid lesson beat: ${tape}`);
    end += frames.length;
    cues.push({ end, key, caption });
    return frames;
  }));
  return { level: level.value, loops: inputs, cues };
}

export const LESSONS: Readonly<Record<LessonId, Lesson>> = {
  depth: lesson(depthRoom, [[
    ['R74', '→', 'De face, le mur ferme le passage.'],
    ['E1 _70', 'E', 'Sur le seuil violet, déplie la profondeur.'],
    ['U22 _47', '↑', 'Rejoins le plan derrière le mur.'],
    ['R63 _53', '→', 'Le passage est libre sur ce plan.'],
  ]]),
  clone: lesson(cloneRoom, [
    [['R155', '→', 'Maintiens la touche, même contre la porte fermée.']],
    [
      ['_52', 'R', 'Rembobine. Le clone orange rejoue ta course.'],
      ['L54', '←', 'Avec le personnage bleu, tiens la plaque.'],
      ['_94', '→', 'Le clone rejoue la même touche. Cette fois, il passe.'],
    ],
  ]),
  boots: lesson(bootsRoom, [[
    ['_108', '', 'Le champ attire tes pieds vers le plafond.'],
    ['B1 _110', 'B', 'Chausse les bottes pour redescendre au sol.'],
    ['B1 _109', 'B', 'Retire-les et le champ te soulève à nouveau.'],
  ]]),
};
