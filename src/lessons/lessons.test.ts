import { describe, expect, it } from 'vitest';
import { FPS, outcomeOfFlow, playerOfFlow } from '../flow/physics';
import { runTape } from '../flow/tape';
import { LESSONS, type LessonId } from './index';

/** Observe the same frame the player sees, across the rewind as well as inside a loop. */
function atFrame(id: LessonId, frame: number) {
  const { level, loops } = LESSONS[id];
  const played = [];
  for (const loop of loops) {
    played.push(loop.slice(0, frame));
    frame -= loop.length;
    if (frame <= 0) break;
  }
  return runTape(level, played).world;
}

describe('mechanic demonstrations', () => {
  it.each(Object.entries(LESSONS))('%s stays playable until its last caption', (_id, lesson) => {
    const frames = lesson.loops.flat().length;
    const world = runTape(lesson.level, lesson.loops).world;
    expect(outcomeOfFlow(world)).toBe('playing');
    expect(lesson.cues.at(-1)?.end).toBe(frames);
    expect(frames / FPS).toBeGreaterThanOrEqual(5);
    expect(frames / FPS).toBeLessThanOrEqual(8);
  });

  it('shows the clone passing the door that stopped the recorded player', () => {
    const first = LESSONS.clone.loops[0]!.length;
    const stopped = playerOfFlow(atFrame('clone', first));
    const replay = atFrame('clone', first + 155);
    expect(stopped.x).toBeGreaterThan(6);
    expect(stopped.x).toBeLessThan(7);
    expect(playerOfFlow(replay).x).toBeLessThan(2);
    expect(replay.bodies[0]!.x).toBeGreaterThan(9);
  });

  it('shows the same wall first blocking the slice and then passed in depth', () => {
    const [wall, unfold, back, pass] = LESSONS.depth.cues;
    expect(playerOfFlow(atFrame('depth', wall!.end))).toMatchObject({ dim: 2 });
    expect(playerOfFlow(atFrame('depth', wall!.end)).x).toBeLessThan(5);
    expect(playerOfFlow(atFrame('depth', unfold!.end)).dim).toBe(3);
    expect(playerOfFlow(atFrame('depth', back!.end)).z).toBeGreaterThan(1.5);
    expect(playerOfFlow(atFrame('depth', pass!.end)).x).toBeGreaterThan(6);
  });

  it('shows the soles reaching the ceiling, floor and ceiling in sequence', () => {
    const poses = LESSONS.boots.cues.map(cue => playerOfFlow(atFrame('boots', cue.end)));
    expect(poses.map(body => body.boots)).toEqual([false, true, false]);
    expect(poses.every(body => body.grounded)).toBe(true);
    expect(poses[0]!.y).toBeGreaterThan(3);
    expect(poses[1]!.y).toBe(1);
    expect(poses[2]!.y).toBe(poses[0]!.y);
  });
});
