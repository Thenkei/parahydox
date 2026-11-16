/**
 * Text-mode play: prints what the player would see after a script of inputs. Shows only
 * the player's slice, exactly like the game, so it can be used to playtest a level blind
 * (by a person or an agent) or to check a level while designing it.
 *
 *   npm run play -- <level number> "<script>" [hint]
 *
 * Script: L R U D move · . wait · E change dimension · T hold the clones · | rewind (see src/core/script.ts).
 */
import { newGame, reduce } from '../src/core/game';
import { cellAt, sameCell, vec } from '../src/core/grid';
import { parseScript } from '../src/core/script';
import type { Vec3, World } from '../src/core/types';
import { isDoorClosed, isPlatePressed, isSolid, outcomeOf, playerOf } from '../src/core/world';
import { WORLD_NAMES, loadLevels } from '../src/levels';

const LEGEND = [
  '@ toi   1 2 clones   # bloc   . vide   o caisse   X sortie',
  'En 2D, U saute : une case de haut, puis deux pas en l\'air (franchit un trou d\'une case)',
  '* ancre (E : entrer/sortir du fil)   = fil   ^ seuil 3D (E : déplier/replier)',
  'a b plaque libre   _ plaque enfoncée   A B porte fermée   : porte ouverte',
  '! barrière fermée sur un fil   ; barrière ouverte',
  'e f levier (/ une fois basculé)   E F porte à levier   % grille : ouverte tant que le levier est au repos',
  '~ dalle fragile : elle tombe quand celui qui était dessus la quitte à pied',
].join('\n');

function glyphAt(world: World, p: Vec3): string {
  const actor = world.actors.find((a) => a.status === 'active' && sameCell(a.pos, p));
  if (actor) return actor.role === 'player' ? '@' : String(actor.id + 1);
  if (world.crates.some((c) => sameCell(c.pos, p))) return 'o';
  const cell = cellAt(world.level, p);
  if (!cell) return ' ';
  if (cell.solid) return !cell.fragile ? '#' : isSolid(world, p) ? '~' : ' ';
  if (cell.door !== null) {
    const closed = isDoorClosed(world, p);
    if (cell.wire !== null) return closed ? '!' : ';';
    return closed ? (cell.inverted ? '%' : cell.door.toUpperCase()) : ':';
  }
  if (cell.exit) return 'X';
  if (cell.anchor) return '*';
  if (cell.threshold) return '^';
  if (cell.lever !== null) return world.toggled.includes(cell.lever) ? '/' : cell.lever;
  if (cell.plate !== null) return isPlatePressed(world, cell.plate) ? '_' : cell.plate;
  if (cell.wire !== null) return '=';
  return '.';
}

function layer(world: World, z: number): string {
  const { w, h } = world.level.size;
  const rows: string[] = [];
  for (let y = h - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < w; x++) row += glyphAt(world, vec(x, y, z));
    rows.push(row);
  }
  return rows.join('\n');
}

function view(world: World): string {
  const player = playerOf(world);
  const { level } = world;
  if (player.dim === 1) {
    const ref = cellAt(level, player.pos)?.wire;
    const cells = ref ? (level.wires[ref.wire]?.cells ?? []) : [];
    const heading = (a: Vec3, b: Vec3): string => (b.x > a.x ? '→' : b.x < a.x ? '←' : b.y > a.y || b.z > a.z ? '↑' : '↓');
    const parts = cells.map((c, i) => {
      const next = cells[i + 1];
      return glyphAt(world, c) + (next ? ` ${heading(c, next)} ` : '');
    });
    return `Vue 1D : seul le fil existe. Chaque flèche indique la touche pour passer à la case suivante.\n${parts.join('')}`;
  }
  if (player.dim === 2) return `Vue 2D : coupe z=${player.pos.z}, vue de côté.\n${layer(world, player.pos.z)}`;
  const layers: string[] = [];
  for (let z = level.size.d - 1; z >= 0; z--) layers.push(`z=${z}${z === 0 ? ' (devant)' : ''}\n${layer(world, z)}`);
  return `Vue 3D : tout le volume, une couche par profondeur. Haut = vers z plus grand, bas = vers z plus petit.\n${layers.join('\n\n')}`;
}

function main(): void {
  const [levelArg, scriptArg = '', hintArg] = process.argv.slice(2);
  const levels = loadLevels();
  const index = Number(levelArg) - 1;
  const level = levels[index];
  if (!level) {
    console.error(`Usage: npm run play -- <1..${levels.length}> "<script>"`);
    process.exit(1);
  }
  const commands = parseScript(scriptArg);
  if (!commands.ok) {
    console.error(commands.error);
    process.exit(1);
  }
  const state = commands.value.reduce(reduce, newGame(level));
  const { world, session } = state;
  const player = playerOf(world);
  const here = cellAt(level, player.pos);
  const outcome = outcomeOf(world);

  console.log(`Niveau ${index + 1} — ${level.name} (monde ${level.world} : ${WORLD_NAMES[level.world - 1]})`);
  console.log(`Clones possibles : ${level.maxClones}${level.tip ? `\nMessage du niveau : ${level.tip}` : ''}`);
  if (hintArg === 'hint' && level.hint) console.log(`Indice demandé (touche H) : ${level.hint}`);
  console.log(`\n${view(world)}\n`);
  console.log(`Dimension ${player.dim}D · pas ${world.tick}`);
  session.loops.forEach((log, i) => console.log(`Clone ${i + 1} : ${Math.min(world.tick, log.length)}/${log.length} touches rejouées`));
  if (here?.anchor) console.log('Tu es sur une ancre.');
  if (here?.threshold) console.log('Tu es sur un seuil.');
  console.log(outcome === 'won' ? '>>> SORTIE ATTEINTE' : outcome === 'fallen' ? '>>> TOMBÉ DANS LE VIDE (la boucle est finie : | pour rembobiner)' : '');
  console.log(`\n${LEGEND}`);
}

main();
