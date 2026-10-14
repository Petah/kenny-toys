/**
 * Generates candidate levels and prints the most interesting ones as text, ready to paste
 * into src/levels.ts.
 *
 *   node games/sokoban/scripts/generate.ts <width> <height> <crates> [colors] [tries] [seed]
 *
 * Each candidate is a random room with every crate on a target, played backwards: the
 * player wanders and pulls crates off their targets. Reversing those pulls solves it, so
 * every candidate is solvable. The solver then finds the shortest solution, and candidates
 * are ranked by how many times that solution switches between crates and by its pushes.
 */
import { solve } from './check-levels.ts';
import { STEP, parseLevel, type Dir } from '../src/sokoban.ts';

const [width = 7, height = 7, nCrates = 3, nColors = 0, tries = 300, seed = Date.now() % 100000] = process.argv.slice(2).map(Number);

let s = seed;
const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const DIRS = Object.keys(STEP) as Dir[];

function room(): string[][] {
  // Interior floor with a few random wall stubs, framed by walls.
  const grid = Array.from({ length: height + 2 }, (_, y) =>
    Array.from({ length: width + 2 }, (_, x) => (x === 0 || y === 0 || x === width + 1 || y === height + 1 ? '#' : ' ')),
  );
  const stubs = Math.floor((width * height) / 5);
  for (let i = 0; i < stubs; i++) {
    const x = 1 + Math.floor(rand() * width);
    const y = 1 + Math.floor(rand() * height);
    grid[y][x] = '#';
    if (rand() < 0.5) {
      const [dx, dy] = STEP[pick(DIRS)];
      if (grid[y + dy]?.[x + dx] === ' ') grid[y + dy][x + dx] = '#';
    }
  }
  return grid;
}

function candidate(): string[] | null {
  const grid = room();
  const floor: [number, number][] = [];
  grid.forEach((row, y) => row.forEach((c, x) => c === ' ' && floor.push([x, y])));
  if (floor.length < nCrates * 3 + 4) return null;
  const at = (p: [number, number]) => `${p[0]},${p[1]}`;
  const targets = new Map<string, number>();
  while (targets.size < nCrates) {
    const pos = at(pick(floor));
    if (!targets.has(pos)) targets.set(pos, targets.size);
  }
  const crates = new Map(targets);
  let player = pick(floor);
  if (crates.has(at(player))) return null;
  const isFloor = (x: number, y: number) => grid[y]?.[x] === ' ';

  // Walk backwards: each step the player moves, and sometimes drags the crate behind them.
  for (let step = 0; step < 300; step++) {
    const dir = pick(DIRS);
    const [dx, dy] = STEP[dir];
    const next: [number, number] = [player[0] + dx, player[1] + dy];
    if (!isFloor(...next) || crates.has(at(next))) continue;
    const behind = at([player[0] - dx, player[1] - dy]);
    if (crates.has(behind) && rand() < 0.7) {
      const id = crates.get(behind)!;
      crates.delete(behind);
      crates.set(at(player), id);
    }
    player = next;
  }
  // Start every crate off the targets and the player off them too: the text format has no
  // way to write a coloured crate or player on a target, and a clean start reads better.
  if ([...crates.keys(), at(player)].some((pos) => targets.has(pos))) return null;

  const colorOf = (id: number) => (id < nColors ? 'rgb'[id] : '');
  const rows = grid.map((row) => [...row]);
  for (const [pos, id] of targets) {
    const [x, y] = pos.split(',').map(Number);
    rows[y][x] = colorOf(id).toUpperCase() || '.';
  }
  for (const [pos, id] of crates) {
    const [x, y] = pos.split(',').map(Number);
    rows[y][x] = colorOf(id) || '$';
  }
  rows[player[1]][player[0]] = '@';
  // Fill unreachable pockets with wall so they don't draw as stray floor.
  const board = parseLevel(rows.map((r) => r.join('')));
  return rows.map((row, y) => row.map((c, x) => (c === ' ' && !board.floor.has(y * board.width + x) ? '#' : c)).join(''));
}

/** Trims wall rows/columns that only touch other walls, so the level is as small as it can be drawn. */
function trim(rows: string[]): string[] {
  const board = parseLevel(rows);
  const inside = (x: number, y: number) => board.floor.has(y * board.width + x);
  const near = (x: number, y: number) => [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => inside(x + dx, y + dy)));
  const out = rows.map((row, y) => [...row].map((c, x) => (near(x, y) ? c : ' ')).join('').trimEnd());
  while (!out[0].trim()) out.shift();
  while (!out.at(-1)!.trim()) out.pop();
  const left = Math.min(...out.map((r) => r.search(/\S/)));
  return out.map((r) => r.slice(left));
}

const found: { rows: string[]; score: number; moves: number; pushes: number; switches: number }[] = [];
const seen = new Set<string>();
for (let i = 0; i < tries; i++) {
  const rows = candidate();
  if (!rows || seen.has(rows.join('\n'))) continue;
  seen.add(rows.join('\n'));
  const board = parseLevel(rows);
  const result = solve(board, 400_000);
  if (!result) continue;
  // Count how often the solution changes which crate it's pushing: the real measure of a tangle.
  let switches = 0;
  let last = -1;
  let player = board.player;
  const crates = board.crates.map((c) => c.pos);
  for (const dir of result.path) {
    const next = player + STEP[dir][0] + STEP[dir][1] * board.width;
    const hit = crates.indexOf(next);
    if (hit >= 0) {
      if (hit !== last) switches++;
      last = hit;
      crates[hit] = next + STEP[dir][0] + STEP[dir][1] * board.width;
    }
    player = next;
  }
  found.push({ rows: trim(rows), score: switches * 3 + result.pushes, moves: result.path.length, pushes: result.pushes, switches });
}

found.sort((a, b) => b.score - a.score);
console.log(`seed ${seed}: ${found.length} solvable of ${tries}`);
for (const f of found.slice(0, 4)) {
  console.log(`\nscore ${f.score}  moves ${f.moves}  pushes ${f.pushes}  switches ${f.switches}`);
  console.log(f.rows.map((r) => `      '${r}',`).join('\n'));
}
