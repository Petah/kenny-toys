/**
 * Solves every level and checks its par against the shortest solution.
 *
 *   node games/sokoban/scripts/check-levels.ts            # check all levels
 *   node games/sokoban/scripts/check-levels.ts --paths    # also print each solution (u/d/l/r)
 *
 * The search is a plain breadth-first search over (player, crates), so it finds the fewest
 * moves. Crates of one colour are interchangeable, and squares a crate could never be pushed
 * home from are pruned. That's plenty for levels of this size.
 */
import { LEVELS } from '../src/levels.ts';
import { STEP, Sokoban, parseLevel, type Board, type Dir } from '../src/sokoban.ts';

const DIRS = Object.keys(STEP) as Dir[];

/** Squares a crate of each colour can still reach a matching target from, found by pulling back from the targets. */
function liveSquares(board: Board) {
  const game = new Sokoban(board);
  const live = new Map<string, Set<number>>();
  for (const color of new Set(board.crates.map((c) => c.color))) {
    const seen = new Set([...board.targets].filter(([, c]) => c === color).map(([pos]) => pos));
    const queue = [...seen];
    while (queue.length) {
      const pos = queue.pop()!;
      for (const dir of DIRS) {
        const from = game.neighbour(pos, dir);
        const player = from < 0 ? -1 : game.neighbour(from, dir);
        if (player < 0 || !board.floor.has(from) || !board.floor.has(player) || seen.has(from)) continue;
        seen.add(from);
        queue.push(from);
      }
    }
    live.set(color, seen);
  }
  return live;
}

export function solve(board: Board, limit = 3_000_000): { path: Dir[]; pushes: number; states: number } | null {
  const live = liveSquares(board);
  const colors = board.crates.map((c) => c.color);
  const key = (player: number, crates: number[]) => {
    const groups = new Map<string, number[]>();
    crates.forEach((pos, i) => groups.set(colors[i], [...(groups.get(colors[i]) ?? []), pos]));
    return `${player}|${[...groups].map(([c, ps]) => `${c}:${ps.sort((a, b) => a - b).join(',')}`).join(';')}`;
  };

  const start = new Sokoban(board);
  const parents = new Map<string, [string, Dir] | null>([[key(start.player, start.crates), null]]);
  const queue: [number, number[]][] = [[start.player, start.crates]];
  const probe = new Sokoban(board);
  for (let head = 0; head < queue.length; head++) {
    if (parents.size > limit) return null;
    const [player, crates] = queue[head];
    const here = key(player, crates);
    for (const dir of DIRS) {
      probe.player = player;
      probe.crates = [...crates];
      const result = probe.move(dir);
      if (result.kind === 'blocked') continue;
      if (result.kind === 'push' && !live.get(colors[result.crate])!.has(result.crateTo)) continue;
      const next = key(probe.player, probe.crates);
      if (parents.has(next)) continue;
      parents.set(next, [here, dir]);
      if (probe.solved) {
        const path: Dir[] = [];
        for (let at = next; parents.get(at); at = parents.get(at)![0]) path.unshift(parents.get(at)![1]);
        const replay = new Sokoban(board);
        path.forEach((d) => replay.move(d));
        return { path, pushes: replay.pushes, states: parents.size };
      }
      queue.push([probe.player, probe.crates]);
    }
  }
  return null;
}

if (import.meta.main) {
  const showPaths = process.argv.includes('--paths');
  let failed = false;
  LEVELS.forEach((level, i) => {
    const board = parseLevel(level.rows);
    const result = solve(board);
    const name = `${String(i + 1).padStart(2)}. ${level.name.padEnd(18)}`;
    if (!result) {
      failed = true;
      console.log(`${name} UNSOLVED`);
      return;
    }
    const ok = result.path.length === level.par;
    if (!ok) failed = true;
    console.log(
      `${name} ${board.crates.length} crates  ${String(result.path.length).padStart(3)} moves  ${String(result.pushes).padStart(3)} pushes  ` +
        `${String(result.states).padStart(8)} states  ${ok ? 'par ok' : `PAR IS ${level.par}, SHOULD BE ${result.path.length}`}`,
    );
    if (showPaths) console.log(`    ${result.path.map((d) => d[0]).join('')}`);
  });
  process.exit(failed ? 1 : 0);
}
