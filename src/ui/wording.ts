/**
 * Text written for the keyboard, said for the hand in use. Level tips, hints and messages are
 * written once, with keys in them; on touch, the few words that only mean something on a
 * keyboard are swapped for the control that does the same thing.
 *
 * Most need nothing: the pad's buttons wear the keys' letters (E, R, X, B), and the stick
 * shows the arrows (← → ↑ ↓) it presses. What remains is listed here as whole phrases, not
 * single words: "la flèche va basculer" in the Hyperspace is the field's arrow, not a key.
 */

/** The hand last used: what the interface shows, and what the text should name. */
export type InputMode = 'keys' | 'touch';

/** What the menu is called in a sentence: the button wears ☰. */
const MENU = 'le menu ☰';

const TOUCH: readonly (readonly [RegExp, string])[] = [
  // The arrows, named as a set: the stick is the set.
  [/les quatre flèches/g, 'le stick'],
  [/les flèches/g, 'le stick'],
  [/avec la flèche qui va dans son sens/g, 'avec le stick, dans son sens'],
  // The jump.
  [/\bEspace\b/g, 'SAUT'],
  // What only the menu does on touch.
  [/(?:Maj\+)?H donne un indice/g, `${MENU[0]!.toUpperCase()}${MENU.slice(1)} donne un indice`],
  [/Échap pour y aller/g, `Niveaux, dans ${MENU}, pour y aller`],
  [/Maj\+R\b/g, `Recommencer, dans ${MENU}`],
];

/** `text` as it should read for `mode`: unchanged for the keyboard it was written for. */
export function forInput(text: string, mode: InputMode): string {
  if (mode === 'keys') return text;
  return TOUCH.reduce((said, [phrase, replacement]) => said.replace(phrase, replacement), text);
}

/**
 * Words that only mean something with a keyboard. A text that still holds one after
 * `forInput(…, 'touch')` names a key a phone does not have: the tests check every level.
 */
export const KEYBOARD_ONLY: readonly RegExp[] = [
  /\bEspace\b/,
  /Échap/,
  /Entrée/,
  /Maj\+/,
  /\bTab\b/,
  /Retour arrière/,
  /\bclavier\b/,
  /flèches/,
  /la flèche qui/,
  // Keys with no button: H, M, N, P, U (E, R, X and B are on the pad).
  /(?:^|[\s(])[HMNPU](?=[\s).,:;]|$)/,
];
