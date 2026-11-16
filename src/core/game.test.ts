import { describe, expect, it } from 'vitest';
import { newGame, reduce } from './game';
import { replay, totalActions } from './session';
import { levelFrom, play } from './testing';
import { outcomeOf, playerOf } from './world';

const level = (clones: number) =>
  levelFrom(`
name: corridor
clones: ${clones}
z=0
......
@....X
######
`);

describe('rewind', () => {
  it('resets time and leaves a clone that replays the loop', () => {
    const state = play(level(1), 'RR|');
    expect(state.world.tick).toBe(0);
    expect(state.world.actors.map((a) => a.role)).toEqual(['clone', 'player']);
    expect(playerOf(state.world).pos).toEqual(state.session.level.start);
  });

  it('does nothing when no step has been played', () => {
    const fresh = newGame(level(1));
    expect(reduce(fresh, { type: 'rewind' })).toBe(fresh);
  });

  it('drops the oldest clone past the level limit', () => {
    const state = play(level(2), 'R|RR|RRR|');
    expect(state.session.loops.map((log) => log.length)).toEqual([2, 3]);
  });

  it('leaves no clone in a level without clones', () => {
    const state = play(level(0), 'RR|');
    expect(state.world.actors).toHaveLength(1);
    expect(state.world.tick).toBe(0);
  });
});

describe('undo', () => {
  it('takes back one step', () => {
    const state = reduce(play(level(1), 'RR'), { type: 'undo' });
    expect(state.world).toEqual(play(level(1), 'R').world);
  });

  it('crosses a rewind and gives the loop back', () => {
    const before = play(level(1), 'RR');
    const after = reduce(play(level(1), '|', before), { type: 'undo' });
    expect(after.session).toBe(before.session);
    expect(after.world).toEqual(before.world);
  });

  it('crosses a restart', () => {
    const before = play(level(1), 'RR|R');
    const after = reduce(reduce(before, { type: 'restart' }), { type: 'undo' });
    expect(after.session).toBe(before.session);
  });
});

describe('determinism', () => {
  it('replaying the logs yields exactly the world built step by step', () => {
    const state = play(level(2), 'RR.|R.RL|.RRR');
    expect(replay(state.session)).toEqual(state.world);
  });

  it('accepts no input once the level is won', () => {
    const won = play(level(1), 'RRRRR');
    expect(outcomeOf(won.world)).toBe('won');
    expect(play(level(1), 'L', won)).toBe(won);
  });
});

describe('hold', () => {
  it('makes the clone wait one step, then carry on with the same keys', () => {
    const held = play(level(1), 'RR|T');
    expect(held.world.tick).toBe(0);
    const oneStep = reduce(held, { type: 'input', input: { kind: 'wait' } });
    expect(oneStep.world.actors[0]?.pos.x).toBe(0);
    const threeSteps = play(level(1), 'RR|T...');
    expect(threeSteps.world.actors[0]?.pos.x).toBe(2);
  });

  it('leaves the world as it is and costs one action, unlike a recorded wait', () => {
    const before = play(level(1), 'RR|R');
    const after = reduce(before, { type: 'hold' });
    expect(after.world).toBe(before.world);
    expect(totalActions(after.session)).toBe(totalActions(before.session) + 1);
    expect(totalActions(play(level(1), 'R.R|R').session)).toBe(totalActions(before.session));
    expect(replay(after.session)).toEqual(before.world);
  });

  it('does nothing without a clone, or once every tape has run out', () => {
    const alone = play(level(1), 'RR');
    expect(reduce(alone, { type: 'hold' })).toBe(alone);
    const exhausted = play(level(1), 'R|..');
    expect(reduce(exhausted, { type: 'hold' })).toBe(exhausted);
  });

  it('is undone like any other command', () => {
    const before = play(level(1), 'RR|R');
    const undone = reduce(reduce(before, { type: 'hold' }), { type: 'undo' });
    expect(undone.session).toBe(before.session);
  });
});
