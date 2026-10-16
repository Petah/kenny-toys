/**
 * The railway as a grid of tiles, read from a little box-drawing map, and the paths trains
 * follow through it. No three.js, so the layout checker can run it in Node.
 *
 * Map glyphs: ─ │ ┌ ┐ └ ┘ are plain track, ├ ┤ ┬ ┴ are switches, T is the tunnel the trains
 * come out of and a–f are the sheds they go to. Anything else is empty ground. The track
 * always branches away from the tunnel, so it's a tree: every switch has one way in and two
 * ways out, and trains never meet head on.
 */

/** World units per tile: the kit's straight rail is 4 long and its small corner turns on radius 2. */
export const TILE = 4;

/** Sides of a tile: north is -z (away from the camera), east is +x. */
export type Dir = 0 | 1 | 2 | 3;
export const N: Dir = 0;
export const E: Dir = 1;
export const S: Dir = 2;
export const W: Dir = 3;
export const opposite = (d: Dir) => ((d + 2) % 4) as Dir;
const STEP: Record<Dir, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };

const GLYPHS: Record<string, Dir[]> = {
  '─': [E, W], '│': [N, S], '┌': [E, S], '┐': [S, W], '└': [N, E], '┘': [N, W],
  '├': [N, E, S], '┤': [N, S, W], '┬': [E, S, W], '┴': [N, E, W],
};

export interface Cell {
  col: number;
  row: number;
  kind: 'track' | 'switch' | 'tunnel' | 'station';
  /** The side trains come in by (for the tunnel, the side they come out of the hill). */
  entry: Dir;
  /** Where trains can leave: one side, or two for a switch. Sheds have none. */
  exits: Dir[];
  /** Which of a switch's exits is set. */
  set: number;
  /** For a shed, which one it is (0 for a, 1 for b…). */
  station: number;
  /** For a switch, its number counting from the tunnel, for the keyboard. */
  index: number;
}

export interface Layout {
  cols: number;
  rows: number;
  cells: Cell[];
  tunnel: Cell;
  switches: Cell[];
  stations: Cell[];
  at(col: number, row: number): Cell | undefined;
}

/** Reads a map into tiles and works out which way trains run through each. Throws on a bad map. */
export function parseLayout(lines: string[]): Layout {
  const rows = lines.length;
  const cols = Math.max(...lines.map((l) => [...l].length));
  const grid = lines.map((l) => [...l]);
  const glyph = (c: number, r: number) => grid[r]?.[c] ?? ' ';
  const sidesOf = (c: number, r: number): Dir[] => {
    const g = glyph(c, r);
    if (GLYPHS[g]) return GLYPHS[g];
    if (g === 'T' || /[a-f]/.test(g)) {
      // Ends of the line connect to whichever neighbour points at them.
      return ([N, E, S, W] as Dir[]).filter((d) => {
        const [dc, dr] = STEP[d];
        return (GLYPHS[glyph(c + dc, r + dr)] ?? []).includes(opposite(d));
      });
    }
    return [];
  };

  let start: [number, number] | undefined;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (glyph(c, r) === 'T') start = [c, r];
  if (!start) throw new Error('no tunnel');

  const cells: Cell[] = [];
  const byPos = new Map<string, Cell>();
  const key = (c: number, r: number) => `${c},${r}`;
  const tunnelSides = sidesOf(...start);
  if (tunnelSides.length !== 1) throw new Error('the tunnel needs exactly one track leading out');
  // Walk the tree outwards from the tunnel.
  const queue: { c: number; r: number; entry: Dir }[] = [{ c: start[0], r: start[1], entry: tunnelSides[0] }];
  while (queue.length) {
    const { c, r, entry } = queue.shift()!;
    if (byPos.has(key(c, r))) throw new Error(`track loops back on itself at ${c},${r}`);
    const g = glyph(c, r);
    const sides = sidesOf(c, r);
    const isTunnel = g === 'T';
    const isStation = /[a-f]/.test(g);
    if (!isTunnel && !sides.includes(entry)) throw new Error(`track at ${c},${r} ('${g}') doesn't join the way in`);
    const exits = isTunnel ? [entry] : sides.filter((d) => d !== entry);
    if (isStation && exits.length) throw new Error(`shed ${g} at ${c},${r} has track running on`);
    const cell: Cell = {
      col: c, row: r,
      kind: isTunnel ? 'tunnel' : isStation ? 'station' : exits.length === 2 ? 'switch' : 'track',
      entry: isTunnel ? opposite(entry) : entry,
      exits, set: 0,
      station: isStation ? g.charCodeAt(0) - 97 : -1,
      index: -1,
    };
    if (!isTunnel && !isStation && exits.length !== 1 && exits.length !== 2) throw new Error(`dead end at ${c},${r}`);
    cells.push(cell);
    byPos.set(key(c, r), cell);
    for (const d of exits) {
      const [dc, dr] = STEP[d];
      const nc = c + dc;
      const nr = r + dr;
      if (!sidesOf(nc, nr).includes(opposite(d))) throw new Error(`track at ${c},${r} runs off into nothing`);
      queue.push({ c: nc, r: nr, entry: opposite(d) });
    }
  }
  // Every glyph on the map should be on the line.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const g = glyph(c, r);
      if ((GLYPHS[g] || /[a-f]/.test(g)) && !byPos.has(key(c, r))) throw new Error(`track at ${c},${r} isn't joined to the tunnel`);
    }
  }
  const stations = cells.filter((c) => c.kind === 'station').sort((a, b) => a.station - b.station);
  stations.forEach((s, i) => {
    if (s.station !== i) throw new Error(`sheds should be lettered a, b, c… in order (missing ${String.fromCharCode(97 + i)})`);
  });
  // Number switches left to right, then top to bottom, so the keys read across the screen.
  const switches = cells.filter((c) => c.kind === 'switch').sort((a, b) => a.col - b.col || a.row - b.row);
  switches.forEach((s, i) => (s.index = i));
  return { cols, rows, cells, tunnel: cells[0], switches, stations, at: (c, r) => byPos.get(key(c, r)) };
}

// ---- Paths ---------------------------------------------------------------------------------

/** One tile's worth of path, or a stretch beyond the map (into the hill or a shed). */
export interface Segment {
  /** The start point and the unit vectors along and across the way in. */
  x: number;
  z: number;
  /** For a straight piece: direction. For a turn: the corner it bends round, and the two radii. */
  turn: 0 | 1 | -1;
  dx: number;
  dz: number;
  length: number;
  /** The tile it crosses, and the track tile if it's on the map. */
  col: number;
  row: number;
  cell?: Cell;
  /** Exit side (for chaining the next segment). */
  exit: Dir;
}

/** Centre of a tile in world units. */
export const centre = (col: number, row: number) => ({ x: col * TILE, z: row * TILE });

/** Midpoint of a tile's side. */
function edge(col: number, row: number, d: Dir) {
  const [dc, dr] = STEP[d];
  const c = centre(col, row);
  return { x: c.x + (dc * TILE) / 2, z: c.z + (dr * TILE) / 2 };
}

/** The path across a tile from its entry side to an exit side. */
export function segmentFor(col: number, row: number, entry: Dir, exit: Dir, cell?: Cell): Segment {
  const a = edge(col, row, entry);
  const heading = opposite(entry);
  const [dx, dz] = STEP[heading];
  if (exit === heading) return { x: a.x, z: a.z, turn: 0, dx, dz, length: TILE, col, row, cell, exit };
  // A right turn is a quarter turn clockwise seen from above (north to east).
  const turn = exit === (heading + 1) % 4 ? 1 : -1;
  return { x: a.x, z: a.z, turn, dx, dz, length: (Math.PI / 2) * (TILE / 2), col, row, cell, exit };
}

/** Position and heading (as a unit vector) a distance `s` into a segment. */
export function sample(seg: Segment, s: number) {
  if (seg.turn === 0) return { x: seg.x + seg.dx * s, z: seg.z + seg.dz * s, hx: seg.dx, hz: seg.dz };
  const r = TILE / 2;
  // The side vector, pointing to the inside of the turn.
  const sx = -seg.dz * seg.turn;
  const sz = seg.dx * seg.turn;
  const cx = seg.x + sx * r;
  const cz = seg.z + sz * r;
  const a = s / r;
  // From the centre, start at -side and swing towards +heading.
  const px = cx - sx * r * Math.cos(a) + seg.dx * r * Math.sin(a);
  const pz = cz - sz * r * Math.cos(a) + seg.dz * r * Math.sin(a);
  const hx = seg.dx * Math.cos(a) + sx * Math.sin(a);
  const hz = seg.dz * Math.cos(a) + sz * Math.sin(a);
  return { x: px, z: pz, hx, hz };
}

/** The tile a side leads into. */
export function neighbour(col: number, row: number, d: Dir) {
  const [dc, dr] = STEP[d];
  return { col: col + dc, row: row + dr };
}

/**
 * The route one train has committed to: segments are added as its front reaches each tile, so a
 * switch counts the way it's set when the train gets there. Distances run from the start of the
 * lead-in inside the hill.
 */
export class Route {
  segs: Segment[] = [];
  /** Distance from the start of the route to the start of each segment. */
  starts: number[] = [];
  length = 0;
  /** Where the train leaves the hill, and where it reaches its shed's door (once known). */
  mouth: number;
  door = Infinity;
  station = -1;

  private layout: Layout;

  constructor(layout: Layout, leadIn: number) {
    this.layout = layout;
    const t = layout.tunnel;
    // Straight track inside the hill, behind the tunnel tile.
    for (let i = leadIn; i >= 1; i--) {
      const p = neighbour(t.col, t.row, t.entry);
      const back = { col: t.col + (p.col - t.col) * i, row: t.row + (p.row - t.row) * i };
      this.push(segmentFor(back.col, back.row, t.entry, opposite(t.entry)));
    }
    this.mouth = this.length;
    this.push(segmentFor(t.col, t.row, t.entry, t.exits[0], t));
  }

  private push(seg: Segment) {
    this.starts.push(this.length);
    this.segs.push(seg);
    this.length += seg.length;
  }

  /** Adds tiles until the route reaches `s`, reading switches as it goes. */
  extendTo(s: number) {
    while (this.length < s) {
      const last = this.segs[this.segs.length - 1];
      const at = neighbour(last.col, last.row, last.exit);
      // Past the shed door the train carries straight on, out of sight.
      if (!last.cell) {
        this.push(segmentFor(at.col, at.row, opposite(last.exit), last.exit));
        continue;
      }
      const cell = this.layout.at(at.col, at.row);
      if (!cell) throw new Error('route ran off the track');
      if (cell.kind === 'station') {
        this.station = cell.station;
        this.door = this.length;
        // Inside the shed the train runs straight on, with no cell, so it keeps going.
        this.push(segmentFor(cell.col, cell.row, cell.entry, opposite(cell.entry)));
        continue;
      }
      const exit = cell.exits[cell.kind === 'switch' ? cell.set : 0];
      this.push(segmentFor(cell.col, cell.row, cell.entry, exit, cell));
    }
  }

  /** Position and heading `s` along the route. */
  at(s: number) {
    this.extendTo(s + 0.001);
    let i = this.segs.length - 1;
    while (i > 0 && this.starts[i] > s) i--;
    return sample(this.segs[i], Math.max(0, s - this.starts[i]));
  }

  /** The switch tiles a stretch of the route covers. */
  cellsBetween(from: number, to: number) {
    const out: Cell[] = [];
    for (let i = 0; i < this.segs.length; i++) {
      const a = this.starts[i];
      const b = a + this.segs[i].length;
      const cell = this.segs[i].cell;
      if (cell && b > from && a < to) out.push(cell);
    }
    return out;
  }
}
