/**
 * Maze layouts, written as text and turned into pieces with pixel positions. No Phaser here,
 * so the level checker can run it under plain Node.
 *
 * Each level is a grid of 16 x 10 cells:
 *   .  floor          #  wall              L  locked wall (opens with the key)
 *   1 2 3 4  wall triangles, filled in the bottom-left, bottom-right, top-right, top-left corner
 *   S  start          G  goal              g  locked goal (opens with the key)
 *   o  trap hole      *  star              k  key
 *   R  spinning bar (keep the 3 x 3 around it clear)
 *   -  |  laser, horizontal or vertical, running between the walls at either end
 */

export const CELL = 64;
export const COLS = 16;
export const ROWS = 10;

export type Corner = 1 | 2 | 3 | 4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Maze {
  cols: number;
  rows: number;
  walls: Rect[];
  locked: Rect[];
  triangles: (Point & { corner: Corner })[];
  start: Point;
  goal: Point & { locked: boolean };
  holes: Point[];
  stars: Point[];
  key?: Point;
  spinners: Point[];
  lasers: { from: Point; to: Point; horizontal: boolean }[];
}

/**
 * The same level mirrored across its diagonal, for portrait screens. Rows become columns,
 * so triangles swap their bottom-left and top-right corners and lasers turn on their side.
 */
export function transpose(rows: readonly string[]): string[] {
  const swap: Record<string, string> = { '1': '3', '3': '1', '-': '|', '|': '-' };
  const width = Math.max(...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, x) => rows.map((row) => swap[row[x]] ?? row[x] ?? '#').join(''));
}

const centre = (x: number, y: number): Point => ({ x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 });

/** Merges runs of one character into as few rectangles as possible: rows first, then stacking equal rows. */
function mergeCells(grid: string[][], ch: string): Rect[] {
  const rects: Rect[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== ch) {
        x++;
        continue;
      }
      const start = x;
      while (row[x] === ch) x++;
      const above = rects.find((r) => r.x === start && r.w === x - start && r.y + r.h === y);
      if (above) above.h++;
      else rects.push({ x: start, y, w: x - start, h: 1 });
    }
  });
  return rects.map(({ x, y, w, h }) => ({ x: x * CELL, y: y * CELL, w: w * CELL, h: h * CELL }));
}

export function parseMaze(rows: readonly string[]): Maze {
  const grid = rows.map((r) => [...r]);
  const cols = Math.max(...rows.map((r) => r.length));
  const maze: Maze = {
    cols,
    rows: rows.length,
    walls: mergeCells(grid, '#'),
    locked: mergeCells(grid, 'L'),
    triangles: [],
    start: { x: 0, y: 0 },
    goal: { x: 0, y: 0, locked: false },
    holes: [],
    stars: [],
    spinners: [],
    lasers: [],
  };

  let starts = 0;
  let goals = 0;
  grid.forEach((row, y) =>
    row.forEach((ch, x) => {
      const at = centre(x, y);
      if (ch >= '1' && ch <= '4') maze.triangles.push({ ...at, corner: Number(ch) as Corner });
      else if (ch === 'S') (maze.start = at), starts++;
      else if (ch === 'G' || ch === 'g') (maze.goal = { ...at, locked: ch === 'g' }), goals++;
      else if (ch === 'o') maze.holes.push(at);
      else if (ch === '*') maze.stars.push(at);
      else if (ch === 'k') maze.key = at;
      else if (ch === 'R') maze.spinners.push(at);
      // A laser is drawn from the first cell of a run to the last, so only runs' starts are picked up here.
      else if (ch === '-' && row[x - 1] !== '-') {
        let end = x;
        while (row[end + 1] === '-') end++;
        maze.lasers.push({ from: { x: x * CELL, y: at.y }, to: { x: (end + 1) * CELL, y: at.y }, horizontal: true });
      } else if (ch === '|' && grid[y - 1]?.[x] !== '|') {
        let end = y;
        while (grid[end + 1]?.[x] === '|') end++;
        maze.lasers.push({ from: { x: at.x, y: y * CELL }, to: { x: at.x, y: (end + 1) * CELL }, horizontal: false });
      }
    }),
  );

  if (starts !== 1) throw new Error(`needs one start, has ${starts}`);
  if (goals !== 1) throw new Error(`needs one goal, has ${goals}`);
  const needsKey = maze.goal.locked || maze.locked.length > 0;
  if (needsKey !== Boolean(maze.key)) throw new Error(needsKey ? 'has locks but no key' : 'has a key but nothing locked');
  return maze;
}
