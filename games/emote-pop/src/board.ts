/**
 * The bubble wall, Phaser-free so scripts can play it too. Distances are in bubble diameters:
 * x runs 0..COLS across the field, y runs down from the ceiling. Rows alternate between COLS
 * cells and COLS - 1 cells shifted half a bubble right, like Puzzle Bobble.
 */

export const COLS = 8;
/** A bubble settling in this row (or pushed into it) ends the game. */
export const DEAD_ROW = 11;
export const ROWS = DEAD_ROW + 1;
/** Height of one row: hexagonal packing. */
export const ROW_H = Math.sqrt(3) / 2;
/** A flying bubble sticks once it's this close to a bubble's centre. Under 1, so it can slip into tight gaps. */
export const COLLIDE = 0.8;
/** Where shots leave from, in rows below the ceiling. */
export const LAUNCH_Y = ROWS * ROW_H + 1.1;
/** How far either side of straight up a shot can go, in radians. */
export const MAX_AIM = (75 * Math.PI) / 180;
/** Bombs clear every bubble whose centre is this close to where they land. */
export const BOMB_RADIUS = 1.75;

/** Emote kinds 0..5 match by kind; stones never match and only fall; a bomb blows up where it lands. */
export type Kind = number | 'stone' | 'bomb';
export const KINDS = 6;

export interface Bubble {
  kind: Kind;
  id: number;
}

export interface Cell {
  row: number;
  col: number;
}

export interface Row {
  /** Shifted half a bubble right, with one cell fewer. */
  odd: boolean;
  cells: (Bubble | null)[];
}

export interface Shot {
  /** Where the bubble travels, from the launcher via any wall bounces to where it sticks. */
  path: { x: number; y: number }[];
  cell: Cell;
  bounces: number;
}

export interface Result {
  /** Matched (or bombed) bubbles in the order they pop, nearest the landing first. */
  popped: { bubble: Bubble; cell: Cell; step: number }[];
  /** Bubbles cut loose from the ceiling. */
  dropped: { bubble: Bubble; cell: Cell }[];
}

export type Rng = () => number;

export class Board {
  rows: Row[] = [];
  private nextId = 1;
  private rng: Rng;

  constructor(rng: Rng = Math.random) {
    this.rng = rng;
    for (let r = 0; r < ROWS; r++) this.rows.push(emptyRow(r % 2 === 1));
  }

  /** A copy to try shots on. Bubbles are shared, so don't change them. */
  clone(): Board {
    const b = new Board(this.rng);
    b.rows = this.rows.map((r) => ({ odd: r.odd, cells: [...r.cells] }));
    b.nextId = this.nextId;
    return b;
  }

  make(kind: Kind): Bubble {
    return { kind, id: this.nextId++ };
  }

  /** A random emote out of the first `kinds`, or now and then a stone. */
  random(kinds: number, stones = 0): Bubble {
    if (stones > 0 && this.rng() < stones) return this.make('stone');
    return this.make(Math.floor(this.rng() * kinds));
  }

  /** Clears the wall and fills its top `rows` rows. */
  fill(rows: number, kinds: number, stones = 0) {
    this.rows = [];
    for (let r = 0; r < ROWS; r++) this.rows.push(emptyRow(r % 2 === 1));
    for (let r = rows - 1; r >= 0; r--) this.rows[r] = this.newRow(this.rows[r].odd, kinds, stones);
  }

  /** A full row. Each bubble has a fair chance of repeating a neighbour above or to its left, so walls have clumps to aim at. */
  private newRow(odd: boolean, kinds: number, stones: number, below?: Row): Row {
    const row = emptyRow(odd);
    row.cells = row.cells.map(() => this.random(kinds, stones));
    for (let c = 1; c < row.cells.length; c++) {
      const left = row.cells[c - 1]!;
      if (typeof left.kind === 'number' && this.rng() < 0.35) row.cells[c] = this.make(left.kind);
    }
    // A pushed-in row leans on the one it lands on top of, the same way.
    if (below) {
      row.cells.forEach((b, c) => {
        const under = below.cells[odd ? c : Math.min(c, below.cells.length - 1)];
        if (b && b.kind !== 'stone' && under && typeof under.kind === 'number' && this.rng() < 0.25) row.cells[c] = this.make(under.kind);
      });
    }
    return row;
  }

  /** Pushes every row down one and fills a new top row. The bottom row falls off the board (it's empty unless the game's over). */
  push(kinds: number, stones = 0) {
    const top = this.rows[0];
    this.rows.unshift(this.newRow(!top.odd, kinds, stones, top));
    this.rows.pop();
  }

  at({ row, col }: Cell): Bubble | null {
    return this.rows[row]?.cells[col] ?? null;
  }

  valid({ row, col }: Cell) {
    const r = this.rows[row];
    return !!r && col >= 0 && col < r.cells.length;
  }

  /** Centre of a cell. */
  pos({ row, col }: Cell) {
    return { x: col + 0.5 + (this.rows[row]?.odd ? 0.5 : 0), y: 0.5 + row * ROW_H };
  }

  neighbours({ row, col }: Cell): Cell[] {
    const odd = this.rows[row]?.odd;
    const out: Cell[] = [
      { row, col: col - 1 },
      { row, col: col + 1 },
    ];
    for (const dr of [-1, 1]) {
      const r = row + dr;
      if (!this.rows[r]) continue;
      // An odd row sits right of the rows around it, so it touches the same column and the one right of it.
      if (odd) out.push({ row: r, col }, { row: r, col: col + 1 });
      else out.push({ row: r, col: col - 1 }, { row: r, col });
    }
    return out.filter((c) => this.valid(c));
  }

  *cells(): Generator<[Cell, Bubble]> {
    for (let row = 0; row < this.rows.length; row++) {
      const cells = this.rows[row].cells;
      for (let col = 0; col < cells.length; col++) {
        const b = cells[col];
        if (b) yield [{ row, col }, b];
      }
    }
  }

  get count() {
    let n = 0;
    for (const _ of this.cells()) n++;
    return n;
  }

  /** The emote kinds still on the wall, which are the only ones worth shooting. */
  kindsLeft(): number[] {
    const set = new Set<number>();
    for (const [, b] of this.cells()) if (typeof b.kind === 'number') set.add(b.kind);
    return [...set].sort((a, b) => a - b);
  }

  /** The lowest row with a bubble in it, or -1 for an empty wall. */
  lowest() {
    for (let r = this.rows.length - 1; r >= 0; r--) if (this.rows[r].cells.some(Boolean)) return r;
    return -1;
  }

  /**
   * Flies a bubble from the launcher at `angle` (0 = straight up, positive = right), bouncing off
   * the side walls, until it touches the ceiling or a bubble, and picks the cell it sticks in.
   * The aiming guide and the real shot both use this, so the guide never lies.
   */
  trace(angle: number, from = { x: COLS / 2, y: LAUNCH_Y }): Shot {
    let { x, y } = from;
    let dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const path = [{ x, y }];
    let bounces = 0;
    const step = 0.04;
    for (let i = 0; i < 5000; i++) {
      x += dx * step;
      y += dy * step;
      if (x < 0.5) {
        // Back up to the wall exactly, so the drawn path has a clean corner.
        const back = (0.5 - x) / Math.abs(dx);
        path.push({ x: 0.5, y: y - dy * back });
        x = 1 - x;
        dx = -dx;
        bounces++;
      } else if (x > COLS - 0.5) {
        const back = (x - (COLS - 0.5)) / Math.abs(dx);
        path.push({ x: COLS - 0.5, y: y - dy * back });
        x = 2 * (COLS - 0.5) - x;
        dx = -dx;
        bounces++;
      }
      if (y <= 0.5 || this.touches(x, y)) {
        y = Math.max(y, 0.5);
        const cell = this.snap(x, y);
        path.push(this.pos(cell));
        return { path, cell, bounces };
      }
    }
    throw new Error('shot never landed');
  }

  private touches(x: number, y: number) {
    const near = Math.round((y - 0.5) / ROW_H);
    for (let row = Math.max(0, near - 1); row <= Math.min(ROWS - 1, near + 1); row++) {
      const cells = this.rows[row].cells;
      for (let col = 0; col < cells.length; col++) {
        if (!cells[col]) continue;
        const p = this.pos({ row, col });
        if (Math.hypot(p.x - x, p.y - y) < COLLIDE) return true;
      }
    }
    return false;
  }

  /** The empty cell nearest a point that's held up by the ceiling or a bubble. */
  snap(x: number, y: number): Cell {
    const near = Math.round((y - 0.5) / ROW_H);
    let best: Cell | undefined;
    let bestD = Infinity;
    for (let row = Math.max(0, near - 1); row <= Math.min(ROWS - 1, near + 1); row++) {
      for (let col = 0; col < this.rows[row].cells.length; col++) {
        const cell = { row, col };
        if (this.at(cell)) continue;
        if (row > 0 && !this.neighbours(cell).some((n) => this.at(n))) continue;
        const p = this.pos(cell);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = cell;
        }
      }
    }
    if (!best) throw new Error(`nowhere to stick at ${x.toFixed(2)},${y.toFixed(2)}`);
    return best;
  }

  /** Sticks a bubble in a cell and pops whatever it sets off. */
  place(cell: Cell, bubble: Bubble): Result {
    this.rows[cell.row].cells[cell.col] = bubble;
    const popped: Result['popped'] = [];
    if (bubble.kind === 'bomb') {
      const at = this.pos(cell);
      for (const [c, b] of this.cells()) {
        const p = this.pos(c);
        const d = Math.hypot(p.x - at.x, p.y - at.y);
        if (d <= BOMB_RADIUS) popped.push({ bubble: b, cell: c, step: Math.round(d) });
      }
    } else {
      const group = this.group(cell);
      if (group.length >= 3) popped.push(...group);
    }
    for (const p of popped) this.rows[p.cell.row].cells[p.cell.col] = null;
    const dropped = popped.length ? this.loose() : [];
    for (const d of dropped) this.rows[d.cell.row].cells[d.cell.col] = null;
    popped.sort((a, b) => a.step - b.step);
    return { popped, dropped };
  }

  /** The bubbles of the same kind joined to a cell, with how many steps each is from it. */
  group(start: Cell) {
    const kind = this.at(start)?.kind;
    if (typeof kind !== 'number') return [];
    const out: Result['popped'] = [];
    const seen = new Set([key(start)]);
    let frontier = [start];
    for (let step = 0; frontier.length; step++) {
      const next: Cell[] = [];
      for (const c of frontier) {
        out.push({ bubble: this.at(c)!, cell: c, step });
        for (const n of this.neighbours(c)) {
          if (seen.has(key(n)) || this.at(n)?.kind !== kind) continue;
          seen.add(key(n));
          next.push(n);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Bubbles no longer connected to the ceiling. */
  loose(): Result['dropped'] {
    const held = new Set<string>();
    let frontier: Cell[] = [];
    this.rows[0].cells.forEach((b, col) => {
      if (b) {
        held.add(key({ row: 0, col }));
        frontier.push({ row: 0, col });
      }
    });
    while (frontier.length) {
      const next: Cell[] = [];
      for (const c of frontier) {
        for (const n of this.neighbours(c)) {
          if (held.has(key(n)) || !this.at(n)) continue;
          held.add(key(n));
          next.push(n);
        }
      }
      frontier = next;
    }
    const out: Result['dropped'] = [];
    for (const [cell, bubble] of this.cells()) if (!held.has(key(cell))) out.push({ bubble, cell });
    return out;
  }
}

function emptyRow(odd: boolean): Row {
  return { odd, cells: new Array<Bubble | null>(odd ? COLS - 1 : COLS).fill(null) };
}

const key = (c: Cell) => `${c.row},${c.col}`;

/** Points for a shot: 10 a popped bubble, and dropped ones are worth more the more fall together. */
export function scoreFor(popped: number, dropped: number) {
  return popped * 10 + dropped * (dropped + 1) * 10;
}

/** A small seeded random number generator (mulberry32), for repeatable tests. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Level {
  /** Emote kinds in play. */
  kinds: number;
  /** Rows the wall starts with. */
  rows: number;
  /** Shots that pop nothing before the wall pushes down a row. */
  misses: number;
  /** Chance each new bubble is a stone. */
  stones: number;
}

/** Each cleared wall brings the next level: more kinds, a deeper wall, less patience, then stones. */
export function level(n: number): Level {
  return {
    kinds: Math.min(KINDS, 3 + n),
    rows: Math.min(7, 4 + n),
    misses: Math.max(3, 8 - n),
    stones: n >= 4 ? Math.min(0.12, 0.04 * (n - 3)) : 0,
  };
}

/** A shot that drops at least this many bubbles earns a bomb. */
export const BOMB_DROP = 6;
