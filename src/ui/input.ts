import type { Dir } from '../core/types';

/** What a key means, before the current screen decides what to do with it. */
export type Key =
  | { readonly type: 'move'; readonly dir: Dir }
  | { readonly type: 'wait' }
  | { readonly type: 'shift' }
  | { readonly type: 'rewind' }
  | { readonly type: 'hold' }
  | { readonly type: 'restart' }
  | { readonly type: 'undo' }
  | { readonly type: 'confirm' }
  | { readonly type: 'menu' }
  | { readonly type: 'mute' }
  | { readonly type: 'hint' }
  | { readonly type: 'realtime' }
  | { readonly type: 'skip'; readonly by: 1 | -1 };

type KeyInfo = Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>;

/**
 * Keys are matched on `code` (physical position), so the WASD cluster is ZQSD on an
 * AZERTY keyboard without configuration. E, R, T, U, H, N and P sit in the same place on both.
 */
const MOVES: Readonly<Record<string, Dir>> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
};

export const moveFor = (code: string): Dir | null => MOVES[code] ?? null;

export function keyFor(event: KeyInfo): Key | null {
  if (event.ctrlKey || event.metaKey) {
    return event.code === 'KeyZ' && !event.altKey ? { type: 'undo' } : null;
  }
  if (event.altKey) return null;

  const dir = moveFor(event.code);
  if (dir !== null) return { type: 'move', dir };
  switch (event.code) {
    case 'Space':
      return { type: 'wait' };
    case 'KeyE':
      return { type: 'shift' };
    case 'Enter':
    case 'NumpadEnter':
      return { type: 'confirm' };
    case 'KeyR':
      return event.shiftKey ? { type: 'restart' } : { type: 'rewind' };
    case 'KeyT':
      return { type: 'hold' };
    case 'KeyU':
    case 'Backspace':
      return { type: 'undo' };
    case 'Escape':
      return { type: 'menu' };
    case 'KeyM':
      return { type: 'mute' };
    case 'KeyH':
      return { type: 'hint' };
    case 'KeyG':
      return { type: 'realtime' };
    case 'KeyN':
      return { type: 'skip', by: 1 };
    case 'KeyP':
      return { type: 'skip', by: -1 };
    default:
      return null;
  }
}
