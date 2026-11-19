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

  it('reads ice as a block of its own, built in or stacked in a custom glyph', () => {
    const parsed = parseLevel(`
name: frost
glyph: % = ice
z=0
@..X
#i%~
`);
    if (!parsed.ok) throw new Error('expected a valid level');
    const floor = [0, 1, 2, 3].map((x) => cellAt(parsed.value, vec(x, 0, 0)));
    expect(floor.map((cell) => cell?.solid)).toEqual([true, true, true, true]);
    expect(floor.map((cell) => cell?.ice)).toEqual([false, true, true, false]);
    expect(floor.map((cell) => cell?.fragile)).toEqual([false, false, false, true]);
  });

  it('a level has neither antipodes nor seams unless its header says so', () => {
    const plain = parseLevel('name: x\nz=0\n@..X\n####');
    if (!plain.ok) throw new Error('expected a valid level');
    expect(plain.value.antipode).toBe(false);
    expect(plain.value.wrap).toEqual({ x: false, y: false });
  });

  it('reads the antipode and wrap headers, alongside mirror', () => {
    const level = (headers: string) => {
      const parsed = parseLevel(`name: x\n${headers}\nz=0\n....\n....\n@..X\n####`);
      if (!parsed.ok) throw new Error(`expected a valid level: ${parsed.error.map((e) => e.message).join(', ')}`);
      return parsed.value;
    };
    expect(level('antipode: true\nmirror: true')).toMatchObject({ antipode: true, mirror: true });
    expect(level('antipode: false').antipode).toBe(false);
    expect(level('wrap: x').wrap).toEqual({ x: true, y: false });
    expect(level('wrap: y').wrap).toEqual({ x: false, y: true });
    expect(level('wrap: xy').wrap).toEqual({ x: true, y: true });
  });

  it.each([
    ['an antipode header that is not a boolean', 'name: x\nantipode: yes\nz=0\n@.X\n###', 'antipode must be true or false'],
    ['a wrap along depth', 'name: x\nwrap: z\nz=0\n@..X\n####', 'wrap must be x, y or xy'],
    ['an empty wrap', 'name: x\nwrap:\nz=0\n@..X\n####', 'wrap must be x, y or xy'],
    ['a wrapped x shorter than four cells', 'name: x\nwrap: x\nz=0\n...\n...\n@.X\n###', 'at least 4 cells wide, this one is 3'],
    ['a wrapped y shorter than four cells', 'name: x\nwrap: xy\nz=0\n....\n@..X\n####', 'at least 4 cells high, this one is 3'],
    ['ice with an argument', 'name: x\nglyph: % = ice a\nz=0\n@.X\n###', 'Feature "ice" takes no argument'],
    ['ice that carries something else', 'name: x\nglyph: % = ice + exit\nz=0\n@.X\n##%', 'a block cannot carry other features'],
    ['a second meaning for i', 'name: x\nglyph: i = block\nz=0\n@.X\n###', 'Glyph "i" is already defined'],
  ])('rejects %s', (_label, source, expected) => {
    expect(messages(source).join('\n')).toContain(expected);
  });

  it('pins a wrap that is too short to the line of its header', () => {
    const parsed = parseLevel('name: x\nwrap: x\nz=0\n@.X\n###');
    expect(parsed.ok ? [] : parsed.error.map((e) => e.line)).toEqual([2]);
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
