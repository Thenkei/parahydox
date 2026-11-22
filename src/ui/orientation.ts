/**
 * Phones play sideways. Held upright, a phone gets a prompt to turn it (in CSS, on every
 * screen) and the level holds still behind it. Where the browser allows it, the first tap
 * also turns the game sideways by itself: fullscreen, then an orientation lock.
 */

/** A phone held upright. Must match the `@media` rule over `.rotate` in style.css. */
export const UPRIGHT_PHONE = '(orientation: portrait) and (max-width: 600px) and (pointer: coarse)';

/** A phone, whichever way it is held: a coarse pointer on a screen whose short side is a phone's. */
const isPhone = (): boolean => window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 600;

/** `lock()` is out of TypeScript's DOM types: only some browsers ship it (Chrome on Android does, Safari on iPhone does not). */
interface LockableOrientation {
  lock(orientation: 'landscape'): Promise<void>;
}

const lockable = (orientation: ScreenOrientation | undefined): orientation is ScreenOrientation & LockableOrientation =>
  orientation !== undefined && typeof (orientation as Partial<LockableOrientation>).lock === 'function';

/**
 * Tries to put a phone in landscape for good: Android allows a lock only in fullscreen, and
 * only from a user gesture, so this must run inside one. Safari on iPhone has neither
 * fullscreen for a page nor a lock: there the prompt does the work. Resolves to whether the
 * lock took; never throws, since the game plays the same either way.
 */
export async function lockLandscape(): Promise<boolean> {
  if (!isPhone() || !document.fullscreenEnabled || !lockable(screen.orientation)) return false;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation.lock('landscape');
    return true;
  } catch (error) {
    console.info('Landscape lock unavailable:', error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Asks for landscape on the first touch of the page, once: a player who leaves fullscreen
 * afterwards has chosen to, and is not pulled back in on every tap.
 */
export function lockOnFirstTouch(): void {
  const attempt = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    window.removeEventListener('pointerup', attempt);
    void lockLandscape();
  };
  window.addEventListener('pointerup', attempt, { passive: true });
}
