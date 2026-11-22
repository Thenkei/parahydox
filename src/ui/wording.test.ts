import { describe, expect, it } from 'vitest';
import { LESSONS } from '../lessons';
import { loadLevels } from '../levels';
import { CAMPAIGNS } from '../levels';
import { openedLine } from './hud';
import { KEYBOARD_ONLY, forInput } from './wording';

const keyboardOnly = (text: string): RegExp | undefined => KEYBOARD_ONLY.find((word) => word.test(text));

describe('forInput', () => {
  it('leaves the keyboard text as it was written', () => {
    const text = 'Maintiens → pour courir, Espace pour sauter. Maj+H donne un indice.';
    expect(forInput(text, 'keys')).toBe(text);
  });

  it('names the pad for the jump, and the stick for the arrows', () => {
    expect(forInput('Maintiens → pour courir, Espace pour sauter.', 'touch')).toBe('Maintiens → pour courir, SAUT pour sauter.');
    expect(forInput('En 3D, on saute avec Espace, et on vise avec les quatre flèches.', 'touch')).toBe(
      'En 3D, on saute avec SAUT, et on vise avec le stick.',
    );
    expect(forInput('E pour entrer dans le fil, les flèches pour le suivre', 'touch')).toBe('E pour entrer dans le fil, le stick pour le suivre');
  });

  it('leaves the field arrow of the Hyperspace alone: it is not a key', () => {
    const text = 'Traverse quand la flèche va basculer vers le bas.';
    expect(forInput(text, 'touch')).toBe(text);
  });

  it('sends to the menu what only the menu does', () => {
    expect(forInput('Bloqué ? X retente cette boucle. Maj+H donne un indice.', 'touch')).toBe(
      'Bloqué ? X retente cette boucle. Le menu ☰ donne un indice.',
    );
    expect(forInput('R la rembobine. H donne un indice.', 'touch')).toBe('R la rembobine. Le menu ☰ donne un indice.');
    const [first] = CAMPAIGNS;
    if (!first) throw new Error('No campaign');
    expect(keyboardOnly(forInput(openedLine([first]), 'touch'))).toBeUndefined();
  });
});

describe('every text a touch player reads', () => {
  it('names no key a phone does not have, in any level tip or hint', () => {
    const left = loadLevels().flatMap((level) =>
      [level.tip, level.hint].flatMap((text) => {
        if (text === null) return [];
        const said = forInput(text, 'touch');
        const word = keyboardOnly(said);
        return word ? [`${level.name}: ${word} in "${said}"`] : [];
      }),
    );
    expect(left).toEqual([]);
  });

  it('names no such key in the demonstrations', () => {
    const left = Object.values(LESSONS).flatMap((lesson) =>
      lesson.cues.flatMap(({ key, caption }) => [key, caption].map((text) => forInput(text, 'touch')).filter((text) => keyboardOnly(text) !== undefined)),
    );
    expect(left).toEqual([]);
  });
});
