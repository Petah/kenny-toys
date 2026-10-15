/**
 * The table's pieces and how they topple, with no Phaser in it so scripts can run it too.
 *
 * Everything is seen from above. A standing domino is a thin slab across its line; as it tips
 * forward its footprint grows from its thickness to its full length (the scene draws the tile
 * foreshortened to match). It's an inverted pendulum about its front edge, and anything standing
 * under its footprint as it sweeps forward gets knocked on with the same swing.
 */

/** Domino length, width and thickness, in world units. */
export const L = 56;
export const W = 28;
export const T = 9;
/** Gap between dominoes laid along a stroke, centre to centre. */
export const SPACING = 30;

export const PAWN_R = 15;
/** How far a pawn's footprint reaches once it's knocked flat. */
const PAWN_L = 54;
export const DIE_R = 24;
export const CHIP_R = 15;

/** Tip-over acceleration, in rad/s² at a right angle; small enough to watch the wave go. */
const GRAVITY = 60;
const PUSH = 3.2;
/** A knocked piece starts with some of the knocker's swing, but never less than this. */
const MIN_KNOCK = 2.4;
const KNOCK_SHARE = 0.75;
/** A knock only counts within this many units of the striker's centre line, either side. */
const REACH = W * 0.6;
/**
 * A falling domino knocks things a little past its own length, as if it skids on landing, so
 * one missing domino where a line crosses another doesn't break it. A die leaves a wider gap.
 */
const SKID = 1.1;
/** A domino hit more side-on than this (the cosine between the push and its facing) slides rather than topples, so waves pass over crossings. */
const SIDE_ON = 0.7;
const STEP = 1 / 240;
const FLAT = Math.PI / 2;

export type PieceKind = 'domino' | 'pawn';
export type PieceState = 'standing' | 'falling' | 'down';

export interface Piece {
  id: number;
  kind: PieceKind;
  x: number;
  y: number;
  /** Unit vector across the slab: the way a domino falls when pushed from behind. */
  dx: number;
  dy: number;
  /** +1 falls along (dx, dy), -1 the other way. Set when it starts falling. */
  sign: 1 | -1;
  /** How far it has tipped: 0 standing, π/2 flat. */
  phi: number;
  omega: number;
  state: PieceState;
  /** Which stroke laid it; -1 for pieces the round set out. */
  stroke: number;
  /** Order it started falling in, from 0; -1 while standing. */
  order: number;
  /** Domino face index (0-27) or pawn colour index. */
  face: number;
}

export interface Chip {
  x: number;
  y: number;
  taken: boolean;
}

export interface Die {
  x: number;
  y: number;
  angle: number;
  face: number;
}

/** What happened during one call to step(). */
export interface StepEvents {
  started: Piece[];
  landed: Piece[];
  chips: Chip[];
}

export class Table {
  pieces: Piece[] = [];
  chips: Chip[] = [];
  dice: Die[] = [];
  private nextId = 0;
  private fallen = 0;
  private acc = 0;

  addDomino(x: number, y: number, dx: number, dy: number, stroke: number, face: number): Piece {
    return this.add({ kind: 'domino', x, y, dx, dy, stroke, face });
  }

  addPawn(x: number, y: number, face: number): Piece {
    return this.add({ kind: 'pawn', x, y, dx: 0, dy: 1, stroke: -1, face });
  }

  private add(p: Pick<Piece, 'kind' | 'x' | 'y' | 'dx' | 'dy' | 'stroke' | 'face'>): Piece {
    const piece: Piece = { ...p, id: this.nextId++, sign: 1, phi: 0, omega: 0, state: 'standing', order: -1 };
    this.pieces.push(piece);
    return piece;
  }

  remove(pieces: Piece[]) {
    const gone = new Set(pieces);
    this.pieces = this.pieces.filter((p) => !gone.has(p));
  }

  get dominoes() {
    return this.pieces.filter((p) => p.kind === 'domino');
  }

  get pawns() {
    return this.pieces.filter((p) => p.kind === 'pawn');
  }

  /** True while anything is still mid-fall. */
  get moving() {
    return this.pieces.some((p) => p.state === 'falling');
  }

  /** Whether a new domino could stand at (x, y) without overlapping a piece, a die or the table edge. */
  canPlace(x: number, y: number, width: number, height: number): boolean {
    const edge = W / 2 + 4;
    if (x < edge || y < edge || x > width - edge || y > height - edge) return false;
    for (const d of this.dice) if (Math.hypot(d.x - x, d.y - y) < DIE_R + W / 2) return false;
    for (const p of this.pieces) {
      const gap = p.kind === 'pawn' ? PAWN_R + W / 2 - 2 : SPACING * 0.5;
      if (Math.hypot(p.x - x, p.y - y) < gap) return false;
    }
    return true;
  }

  /** Tips a standing piece over, as if flicked from behind (sign 1) or in front (-1). */
  push(p: Piece, sign: 1 | -1 = 1, omega = PUSH) {
    if (p.state !== 'standing') return;
    p.state = 'falling';
    p.sign = sign;
    p.omega = omega;
    p.phi = 0.02;
    p.order = this.fallen++;
  }

  /** Stands everything back up, for another go at the same layout. */
  reset() {
    for (const p of this.pieces) {
      p.state = 'standing';
      p.phi = 0;
      p.omega = 0;
      p.sign = 1;
      p.order = -1;
    }
    for (const c of this.chips) c.taken = false;
    this.fallen = 0;
    this.acc = 0;
  }

  /** How far a piece's footprint reaches forward from its back edge right now. */
  reach(p: Piece) {
    return T * Math.cos(p.phi) + this.fullReach(p) * Math.sin(p.phi);
  }

  /** The direction a piece is falling (or would fall). */
  fallDir(p: Piece) {
    return { x: p.dx * p.sign, y: p.dy * p.sign };
  }

  /** Which way a knocked pawn falls: at the nearest standing domino in reach, or on along f. */
  private onward(pawn: Piece, striker: Piece, f: { x: number; y: number }) {
    let best: Piece | undefined;
    let bestDist = PAWN_L;
    for (const d of this.pieces) {
      if (d.kind !== 'domino' || d.state !== 'standing') continue;
      // The striker will knock its own next domino over anyway; the pawn passes the wave elsewhere.
      if (this.hits(striker, f, d, this.fullReach(striker))) continue;
      const rx = d.x - pawn.x;
      const ry = d.y - pawn.y;
      const dist = Math.hypot(rx, ry);
      if (dist < bestDist) {
        best = d;
        bestDist = dist;
      }
    }
    if (!best) return f;
    const dist = Math.hypot(best.x - pawn.x, best.y - pawn.y);
    return { x: (best.x - pawn.x) / dist, y: (best.y - pawn.y) / dist };
  }

  /**
   * Whether p, falling along f with its footprint reaching `reach` from its back edge, knocks q
   * over. A domino it catches side-on slides instead, so waves pass over crossings.
   */
  private hits(p: Piece, f: { x: number; y: number }, q: Piece, reach: number) {
    const rx = q.x - (p.x - (f.x * T) / 2);
    const ry = q.y - (p.y - (f.y * T) / 2);
    const along = rx * f.x + ry * f.y;
    const side = Math.abs(rx * -f.y + ry * f.x);
    const near = q.kind === 'pawn' ? PAWN_R * 0.7 : T / 2;
    const wide = q.kind === 'pawn' ? REACH + PAWN_R : REACH;
    if (along <= T || along - near > reach * SKID || side > wide) return false;
    return p.kind === 'pawn' || q.kind === 'pawn' || Math.abs(q.dx * f.x + q.dy * f.y) >= SIDE_ON;
  }

  /** How far p's footprint reaches once it's flat. */
  private fullReach(p: Piece) {
    return p.kind === 'pawn' ? PAWN_L : L;
  }

  /**
   * Whether a, falling the way it faces, would pass the wave on to b: by knocking it, or by
   * knocking a pawn that can reach it. Used to warn about broken links while drawing.
   */
  carries(a: Piece, b: Piece): boolean {
    const f = { x: a.dx, y: a.dy };
    if (this.hits(a, f, b, this.fullReach(a))) return true;
    return this.pieces.some((q) => q.kind === 'pawn' && this.hits(a, f, q, this.fullReach(a)) && Math.hypot(q.x - b.x, q.y - b.y) <= PAWN_L);
  }

  /** Advances the table by `dt` seconds in fixed steps, so the wave runs the same at any frame rate. */
  step(dt: number): StepEvents {
    const events: StepEvents = { started: [], landed: [], chips: [] };
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.tick(events);
    }
    return events;
  }

  private tick(events: StepEvents) {
    const falling = this.pieces.filter((p) => p.state === 'falling');
    for (const p of falling) {
      p.omega += GRAVITY * Math.sin(p.phi) * STEP;
      p.phi += p.omega * STEP;
      if (p.phi >= FLAT) {
        p.phi = FLAT;
        p.state = 'down';
        events.landed.push(p);
      }
      this.knock(p, events);
    }
  }

  /** Knocks over whatever stands under p's footprint, and picks up chips it lands on. */
  private knock(p: Piece, events: StepEvents) {
    const f = this.fallDir(p);
    const half = T / 2;
    const bx = p.x - f.x * half;
    const by = p.y - f.y * half;
    const reach = this.reach(p);
    for (const q of this.pieces) {
      if (q.state !== 'standing' || !this.hits(p, f, q, reach)) continue;
      // A domino falls whichever way it was hit from. A pawn topples towards the nearest standing
      // domino it can reach, whichever way that is, so a line can turn any corner at a pawn.
      if (q.kind === 'pawn') {
        const to = this.onward(q, p, f);
        q.dx = to.x;
        q.dy = to.y;
      }
      const sign = q.kind === 'pawn' || q.dx * f.x + q.dy * f.y >= 0 ? 1 : -1;
      this.push(q, sign, Math.max(MIN_KNOCK, p.omega * KNOCK_SHARE));
      events.started.push(q);
    }
    if (p.state !== 'down') return;
    for (const c of this.chips) {
      if (c.taken) continue;
      const rx = c.x - bx;
      const ry = c.y - by;
      const along = rx * f.x + ry * f.y;
      const side = Math.abs(rx * -f.y + ry * f.x);
      if (along > -CHIP_R && along < reach + CHIP_R * 0.5 && side < W / 2 + CHIP_R * 0.6) {
        c.taken = true;
        events.chips.push(c);
      }
    }
  }
}

/**
 * Lays dominoes along a drawn stroke, one every SPACING units, with each one turned to
 * face along the line. Pass every pointer position; it returns the dominoes it placed.
 */
export interface StrokeOptions {
  table: Table;
  id: number;
  x: number;
  y: number;
  /** An existing domino to carry on from, if the stroke started on one. */
  from?: Piece;
  width: number;
  height: number;
  /** Picks the face for each new domino. */
  face: () => number;
  /** How many dominoes are left to lay. */
  budget: () => number;
  /**
   * How `from` turns to meet the stroke: 'face' points it straight at the first new domino (the
   * start domino, before anything follows it), 'bend' turns it halfway, like any domino in a
   * stroke (the end of an earlier stroke). Left out, a domino mid-line keeps its facing.
   */
  turnFrom?: 'face' | 'bend';
}

export class Stroke {
  readonly id: number;
  /** The existing domino it carried on from, if any. */
  readonly from?: Piece;
  private opts: StrokeOptions;
  private last?: Piece;
  private lastX: number;
  private lastY: number;
  /** Placed dominoes in this stroke, in order. */
  laid: Piece[] = [];

  constructor(opts: StrokeOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.from = opts.from;
    this.last = opts.from;
    this.lastX = opts.from?.x ?? opts.x;
    this.lastY = opts.from?.y ?? opts.y;
  }

  /** Extends the stroke towards (x, y). */
  to(x: number, y: number): Piece[] {
    const placed: Piece[] = [];
    for (let guard = 0; guard < 100; guard++) {
      const ddx = x - this.lastX;
      const ddy = y - this.lastY;
      const dist = Math.hypot(ddx, ddy);
      // A brand-new stroke drops its first domino where it started, once it knows which way it faces.
      const first = !this.last && this.laid.length === 0;
      const need = first ? SPACING * 0.5 : SPACING;
      if (dist < need) break;
      const ux = ddx / dist;
      const uy = ddy / dist;
      const px = first ? this.lastX : this.lastX + ux * SPACING;
      const py = first ? this.lastY : this.lastY + uy * SPACING;
      if (this.opts.budget() <= 0) break;
      if (!this.opts.table.canPlace(px, py, this.opts.width, this.opts.height)) {
        // Blocked: creep on along the line in short steps, so the next domino stands as close
        // past the obstacle as it can. Past a die or the edge that's a gap the wave won't cross;
        // past a pawn, the pawn carries it.
        if (first) break;
        this.lastX += ux * SPACING * 0.125;
        this.lastY += uy * SPACING * 0.125;
        this.last = undefined;
        continue;
      }
      const d = this.opts.table.addDomino(px, py, ux, uy, this.id, this.opts.face());
      // Turn the one before to sit between its two neighbours, so curves read smoothly.
      const prev = this.laid.at(-1);
      const from = this.opts.from;
      if (!prev && from && this.last === from && this.opts.turnFrom) {
        const ax = this.opts.turnFrom === 'face' ? ux : from.dx + ux;
        const ay = this.opts.turnFrom === 'face' ? uy : from.dy + uy;
        const len = Math.hypot(ax, ay);
        if (len > 0.2) {
          from.dx = ax / len;
          from.dy = ay / len;
        }
      }
      if (prev && this.last === prev) {
        const ax = prev.dx + ux;
        const ay = prev.dy + uy;
        const len = Math.hypot(ax, ay);
        if (len > 0.2) {
          prev.dx = ax / len;
          prev.dy = ay / len;
        }
      }
      this.laid.push(d);
      placed.push(d);
      this.last = d;
      this.lastX = px;
      this.lastY = py;
    }
    return placed;
  }
}
