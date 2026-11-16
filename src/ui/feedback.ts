import type { Input, World } from '../core/types';
import { isPlatePressed, outcomeOf, playerOf } from '../core/world';
import type { Sound } from './audio';

export interface Cue {
  readonly sound: Sound;
  /** Seconds after the step starts. */
  readonly delay: number;
}

/**
 * What a step should sound like, read off the difference between two worlds. The core
 * stays silent about "events": everything audible is derived from state.
 */
export function cuesFor(prev: World, next: World, input: Input, stepMs: number): Cue[] {
  const cues: Cue[] = [];
  const before = playerOf(prev);
  const after = playerOf(next);
  const landing = stepMs / 1000;

  if (after.status === 'fallen') {
    cues.push({ sound: 'fall', delay: 0.05 });
  } else if (before.dim !== after.dim) {
    cues.push({ sound: after.dim === 1 ? 'to1d' : after.dim === 3 ? 'to3d' : 'to2d', delay: 0 });
  } else if (before.pos.x === after.pos.x && before.pos.y === after.pos.y && before.pos.z === after.pos.z) {
    cues.push({ sound: input.kind === 'wait' ? 'wait' : 'bump', delay: 0 });
  } else {
    // A jump takes off or drifts in silence; only footsteps tick.
    if (after.pos.y > before.pos.y) cues.push({ sound: 'hop', delay: 0 });
    else if (before.air === 0) cues.push({ sound: 'step', delay: 0 });
    if (after.pos.y < before.pos.y && after.dim !== 1) cues.push({ sound: 'land', delay: landing });
  }

  const pushed = next.crates.some((crate) => {
    const was = prev.crates.find((c) => c.id === crate.id);
    return was !== undefined && (was.pos.x !== crate.pos.x || was.pos.z !== crate.pos.z);
  });
  if (pushed || next.crates.length < prev.crates.length) cues.push({ sound: 'push', delay: 0 });

  for (const channel of next.level.plates.keys()) {
    const was = isPlatePressed(prev, channel);
    const is = isPlatePressed(next, channel);
    if (was !== is) cues.push({ sound: is ? 'plateOn' : 'plateOff', delay: landing * 0.6 });
  }

  if (next.toggled.join() !== prev.toggled.join()) cues.push({ sound: 'lever', delay: landing * 0.6 });
  if (next.broken.length > prev.broken.length) cues.push({ sound: 'crumble', delay: 0.03 });

  if (outcomeOf(next) === 'won') cues.push({ sound: 'win', delay: 0.12 });
  return cues;
}
