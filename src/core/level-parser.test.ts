import { describe, expect, it } from 'vitest';
import { cellAt, vec } from './grid';
import { parseLevel } from './level-parser';

const messages = (source: string): string[] => {
  const parsed = parseLevel(source);
  return parsed.ok ? [] : parsed.error.map((e) => e.message);
};

describe('parseLevel', () => {
  it('reads rows top to bottom and layers front to back', () => {
    const parsed = parseLevel(`
; comment
name: demo
clones: 2
z=0
..X
@..
###
z=1
...
..a
###
`);
    if (!parsed.ok) throw new Error('expected a valid level');
    const level = parsed.value;
    expect(level.size).toEqual({ w: 3, h: 3, d: 2 });
    expect(level.maxClones).toBe(2);
    expect(level.start).toEqual(vec(0, 1, 0));
    expect(cellAt(level, vec(2, 2, 0))?.exit).toBe(true);
    expect(cellAt(level, vec(1, 0, 0))?.solid).toBe(true);
    expect(level.plates.get('a')).toEqual([vec(2, 1, 1)]);
  });

  it('orders a wire from its leftmost anchor and lets custom glyphs stack features', () => {
    const parsed = parseLevel(`
name: wire
glyph: ! = wire + door a
z=0
@*=!*aX
#######
`);
    if (!parsed.ok) throw new Error('expected a valid level');
    const [wire] = parsed.value.wires;
    expect(wire?.cells.map((c) => c.x)).toEqual([1, 2, 3, 4]);
    expect(cellAt(parsed.value, vec(3, 1, 0))).toMatchObject({ door: 'a', wire: { wire: 0, index: 2 } });
  });

  it('follows a wire that leaves its plane', () => {
    const parsed = parseLevel(`
name: bend
z=0
@*X
###
z=1
.*.
###
`);
    if (!parsed.ok) throw new Error('expected a valid level');
    expect(parsed.value.wires[0]?.cells).toEqual([vec(1, 1, 0), vec(1, 1, 1)]);
  });

  it.each([
    ['a missing start', 'name: x\nz=0\n..X\n###', 'exactly one player start'],
    ['a missing exit', 'name: x\nz=0\n@..\n###', 'at least one exit'],
    ['a ragged row', 'name: x\nz=0\n@.X\n##', 'wide, expected 3'],
    ['an unknown glyph', 'name: x\nz=0\n@?X\n###', 'Unknown glyph "?"'],
    ['a layer gap', 'name: x\nz=0\n@.X\n###\nz=2\n...\n###', 'without gaps'],
    ['a door without a plate or lever', 'name: x\nz=0\n@AX\n###', 'has no plate or lever'],
    ['a dangling wire', 'name: x\nz=0\n@*=.X\n#####', 'without reaching a second anchor'],
    ['a branching wire', 'name: x\nz=0\n..=..\n@*=*X\n#####', 'branches'],
    ['a wire with no anchor', 'name: x\nz=0\n@.=.X\n#####', 'not connected to an anchor'],
    ['a missing name', 'z=0\n@.X\n###', 'Missing "name:"'],
  ])('rejects %s', (_label, source, expected) => {
    expect(messages(source).join('\n')).toContain(expected);
  });
});
