/**
 * Holes are written as a grid of tiles, one token per cell, separated by spaces:
 *
 *   <code><turns>[^<level>]     e.g.  S2   |0   R0^2   .
 *
 * `code` picks a tile from TILES, `turns` is how many quarter turns clockwise (seen from above,
 * north up) and `level` raises the tile by that many RISE steps, for tiles past a ramp. A lone
 * `.` is an empty cell. North is up the page, which is -z in the world; one cell is one unit.
 *
 * No three.js or Rapier here, so the hole checker can use it under Node.
 */

export type Side = 0 | 1 | 2 | 3; // north, east, south, west
const NAMES = ['north', 'east', 'south', 'west'];

export interface TileDef {
  model: string;
  /** Sides with no wall, unturned. */
  open: Side[];
  /** How much higher the south edge is than the north edge, for ramps. */
  rise?: number;
  /** Has a cup at its centre. */
  cup?: boolean;
  /** The tee: where each hole starts. */
  tee?: boolean;
  /** Collision leaves these nodes out (they're decoration above the ball). */
  skipNodes?: string[];
}

/** One step of height, in world units. Ramps rise 2, 5 or 10 steps. */
export const RISE = 0.05;
/** Top of every tile's floor, above the tile's own origin. */
export const FLOOR = 0.063;

export const TILES: Record<string, TileDef> = {
  S: { model: 'start', open: [0], tee: true },
  H: { model: 'hole-round', open: [0], cup: true },
  O: { model: 'hole-open', open: [0, 1, 2, 3], cup: true },
  '|': { model: 'straight', open: [0, 2] },
  L: { model: 'corner', open: [0, 3] },
  C: { model: 'round-corner-a', open: [0, 3] },
  E: { model: 'end', open: [0] },
  T: { model: 'split-t', open: [0, 1, 3] },
  _: { model: 'open', open: [0, 1, 2, 3] },
  s: { model: 'side', open: [0, 2, 3] },
  W: { model: 'walls-to-open', open: [0, 1, 2, 3] },
  B: { model: 'bump-walls', open: [0, 2] },
  b: { model: 'bump', open: [0, 1, 2, 3] },
  h: { model: 'hill-round', open: [0, 2] },
  x: { model: 'crest', open: [0, 2] },
  g: { model: 'gap', open: [0, 2] },
  o: { model: 'obstacle-block', open: [0, 2] },
  d: { model: 'obstacle-diamond', open: [0, 1, 2, 3] },
  n: { model: 'narrow-round', open: [0, 2] },
  N: { model: 'narrow-block', open: [0, 2] },
  u: { model: 'tunnel-wide', open: [0, 2] },
  c: { model: 'castle', open: [0, 2] },
  w: { model: 'windmill', open: [0, 2], skipNodes: ['blades'] },
  '/': { model: 'ramp-low', open: [0, 2], rise: 2 },
  r: { model: 'ramp-medium', open: [0, 2], rise: 5 },
  R: { model: 'ramp', open: [0, 2], rise: 10 },
};

export interface Placement {
  code: string;
  def: TileDef;
  col: number;
  row: number;
  turns: number;
  level: number;
  /** World position of the tile's origin. */
  x: number;
  y: number;
  z: number;
  /** three.js rotation about y for `turns` quarter turns clockwise. */
  angle: number;
}

export interface Course {
  tiles: Placement[];
  tee: Placement;
  cup: Placement;
  cols: number;
  rows: number;
}

/** The world side an unturned side faces after `turns` clockwise quarter turns. */
export const turnSide = (side: Side, turns: number) => ((side + turns) % 4) as Side;

export function parseCourse(rows: readonly string[]): Course {
  const tiles: Placement[] = [];
  rows.forEach((line, row) =>
    line
      .trim()
      .split(/\s+/)
      .forEach((token, col) => {
        if (token === '.') return;
        const m = /^(.)([0-3])(?:\^(\d+))?$/.exec(token);
        if (!m || !TILES[m[1]]) throw new Error(`bad tile "${token}" at row ${row + 1}, column ${col + 1}`);
        const turns = Number(m[2]);
        const level = Number(m[3] ?? 0);
        // three.js turns +y anticlockwise seen from above, so clockwise is negative.
        tiles.push({ code: m[1], def: TILES[m[1]], col, row, turns, level, x: col, y: level * RISE, z: row, angle: (-turns * Math.PI) / 2 });
      }),
  );
  const tees = tiles.filter((t) => t.def.tee);
  const cups = tiles.filter((t) => t.def.cup);
  if (tees.length !== 1) throw new Error(`needs one tee, has ${tees.length}`);
  if (cups.length !== 1) throw new Error(`needs one cup, has ${cups.length}`);
  return { tiles, tee: tees[0], cup: cups[0], cols: Math.max(...tiles.map((t) => t.col)) + 1, rows: rows.length };
}

const STEP: Record<Side, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };

/** Floor height along one world side of a tile, accounting for ramps. */
function edgeLevel(t: Placement, side: Side) {
  const rise = t.def.rise ?? 0;
  // Unturned, a ramp is low on its north edge and high on its south.
  const south = turnSide(2, t.turns);
  const north = turnSide(0, t.turns);
  return t.level + (side === south ? rise : side === north ? 0 : rise / 2);
}

/** Problems with a layout: open sides facing nothing or a wall, steps in the floor, and no way from tee to cup. */
export function checkCourse(course: Course): string[] {
  const at = new Map(course.tiles.map((t) => [`${t.col},${t.row}`, t]));
  const open = (t: Placement) => new Set(t.def.open.map((s) => turnSide(s, t.turns)));
  const problems: string[] = [];
  for (const t of course.tiles) {
    for (const side of open(t)) {
      const [dx, dy] = STEP[side];
      const n = at.get(`${t.col + dx},${t.row + dy}`);
      const where = `${t.code}${t.turns} at row ${t.row + 1}, column ${t.col + 1}`;
      if (!n) {
        problems.push(`${where} is open to the ${NAMES[side]} with nothing there`);
        continue;
      }
      const back = ((side + 2) % 4) as Side;
      if (!open(n).has(back)) problems.push(`${where} is open to the ${NAMES[side]} into a wall`);
      else if (edgeLevel(t, side) !== edgeLevel(n, back)) problems.push(`${where} meets its ${NAMES[side]} neighbour at a different height`);
    }
  }
  // Walk from tee to cup through open sides.
  const seen = new Set([course.tee]);
  const queue = [course.tee];
  while (queue.length) {
    const t = queue.pop()!;
    for (const side of open(t)) {
      const [dx, dy] = STEP[side];
      const n = at.get(`${t.col + dx},${t.row + dy}`);
      if (n && !seen.has(n) && open(n).has(((side + 2) % 4) as Side)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  if (!seen.has(course.cup)) problems.push("the cup can't be reached from the tee");
  return problems;
}
