import { describe, expect, it } from 'vitest';
import { DEAD_ZONE, NEUTRAL, RELEASE_ZONE, STICK_RADIUS, codesOf, directionOf, follow, knobOffset } from './stick';

describe('directionOf', () => {
  it('says nothing inside the dead zone', () => {
    expect(directionOf(DEAD_ZONE, 0, false)).toEqual(NEUTRAL);
    expect(directionOf(DEAD_ZONE * 0.7, DEAD_ZONE * 0.7, true)).toEqual(NEUTRAL);
  });

  it('reads ← → past the dead zone', () => {
    expect(directionOf(DEAD_ZONE + 1, 0, false)).toEqual({ x: 1, z: 0 });
    expect(directionOf(-(DEAD_ZONE + 1), 0, true)).toEqual({ x: -1, z: 0 });
  });

  it('never reads ↑ in a slice, however far the thumb drifts', () => {
    expect(directionOf(0, -80, false)).toEqual(NEUTRAL);
    expect(directionOf(30, -80, false)).toEqual({ x: 1, z: 0 });
  });

  it('reads ↓ in a slice only straight down: the key that waits', () => {
    expect(directionOf(0, 40, false)).toEqual({ x: 0, z: -1 });
    expect(directionOf(10, 40, false)).toEqual({ x: 0, z: -1 });
    // A running thumb that sags is still running.
    expect(directionOf(30, 40, false)).toEqual({ x: 1, z: 0 });
    expect(directionOf(0, DEAD_ZONE - 1, false)).toEqual(NEUTRAL);
    expect(directionOf(0, (DEAD_ZONE + RELEASE_ZONE) / 2, false, { x: 0, z: -1 })).toEqual({ x: 0, z: -1 });
  });

  it('reads up as ↑ (z = 1) where the vertical counts', () => {
    expect(directionOf(0, -40, true)).toEqual({ x: 0, z: 1 });
    expect(directionOf(0, 40, true)).toEqual({ x: 0, z: -1 });
  });

  it('holds both axes on a diagonal, and only one near an axis', () => {
    expect(directionOf(30, -30, true)).toEqual({ x: 1, z: 1 });
    // 15° off the horizontal: inside the ← → sector, not a diagonal.
    expect(directionOf(40, -40 * Math.tan(Math.PI / 12), true)).toEqual({ x: 1, z: 0 });
  });

  it('lets go of a held direction only nearer the centre: no chatter on the edge', () => {
    const between = (DEAD_ZONE + RELEASE_ZONE) / 2;
    expect(directionOf(between, 0, false)).toEqual(NEUTRAL);
    expect(directionOf(between, 0, false, { x: 1, z: 0 })).toEqual({ x: 1, z: 0 });
    expect(directionOf(between, 0, true, { x: 1, z: 0 })).toEqual({ x: 1, z: 0 });
    expect(directionOf(RELEASE_ZONE - 1, 0, false, { x: 1, z: 0 })).toEqual(NEUTRAL);
  });

  it('does not carry the hysteresis across a reversal', () => {
    expect(directionOf(-(DEAD_ZONE - 1), 0, false, { x: 1, z: 0 })).toEqual(NEUTRAL);
  });
});

describe('follow', () => {
  it('leaves the centre alone while the thumb is inside the rim', () => {
    const origin = { x: 100, y: 100 };
    expect(follow(origin, { x: 140, y: 100 })).toBe(origin);
  });

  it('drags the centre so that it stays one radius behind the thumb', () => {
    const moved = follow({ x: 0, y: 0 }, { x: STICK_RADIUS + 40, y: 0 });
    expect(moved.x).toBeCloseTo(40);
    expect(moved.y).toBeCloseTo(0);
  });

  it('makes a reversal cost one radius of travel, not the whole drag back', () => {
    // Run far right, then come back: ← holds as soon as the thumb is a dead zone left of the dragged centre.
    const origin = follow({ x: 0, y: 0 }, { x: 300, y: 0 });
    const back = { x: 300 - STICK_RADIUS - DEAD_ZONE - 1, y: 0 };
    expect(directionOf(back.x - origin.x, back.y - origin.y, false, { x: 1, z: 0 })).toEqual({ x: -1, z: 0 });
  });
});

describe('knobOffset', () => {
  it('sits under the thumb inside the rim and on the rim past it', () => {
    expect(knobOffset({ x: 0, y: 0 }, { x: 10, y: -5 })).toEqual({ x: 10, y: -5 });
    const clamped = knobOffset({ x: 0, y: 0 }, { x: 0, y: 500 });
    expect(clamped.x).toBeCloseTo(0);
    expect(clamped.y).toBeCloseTo(STICK_RADIUS);
  });
});

describe('codesOf', () => {
  it('maps a direction onto the arrow codes the game reads', () => {
    expect(codesOf(NEUTRAL)).toEqual([]);
    expect(codesOf({ x: -1, z: 1 })).toEqual(['ArrowLeft', 'ArrowUp']);
    expect(codesOf({ x: 1, z: -1 })).toEqual(['ArrowRight', 'ArrowDown']);
  });
});
