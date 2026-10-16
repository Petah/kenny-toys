/**
 * The match-3 board with no Phaser: swapping, finding matches, making special gems, setting them
 * off, dropping gems into the gaps and refilling. Each swap returns its cascade as a list of
 * phases for the scene to animate. `scripts/check-board.ts` plays it with a bot.
 */

export type Special = 'none' | 'row' | 'col' | 'bomb' | 'rainbow';

export interface Gem {
  id: number;
  /** Colour/shape, 0 to kinds - 1; rainbow gems have no kind (-1). */
  kind: number;
  special: Special;
}

export interface Pos {
  x: number;
  y: number;
}

export interface Phase {
  /** Gems that go, and what set each one off. */
  cleared: { x: number; y: number; gem: Gem; by: 'match' | Special }[];
  /** Special gems made by this phase's matches (they stay on the board). */
  made: { x: number; y: number; gem: Gem }[];
  /** Specials that went off, for effects: where and what. */
  blasts: { x: number; y: number; special: Special; kind: number }[];
  /** Gems falling into gaps: from row to row in a column. New gems fall from above the board (negative rows). */
  falls: { gem: Gem; x: number; fromY: number; toY: number }[];
  points: number;
  /** 1 for the swap's own matches, then 2, 3… for each cascade after. */
  cascade: number;
}

export type SwapResult = { ok: false } | { ok: true; phases: Phase[] };

export const POINTS = { gem: 10, made: 30, special: 20 };

export class Board {
  cells: (Gem | null)[];
  private nextId = 1;
  private rand: () => number;
  readonly w: number;
  readonly h: number;
  readonly kinds: number;

  constructor(w: number, h: number, kinds: number, rand: () => number) {
    this.w = w;
    this.h = h;
    this.kinds = kinds;
    this.rand = rand;
    this.cells = new Array(w * h).fill(null);
    this.fill();
  }

  at(x: number, y: number): Gem | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.cells[y * this.w + x];
  }

  private set(x: number, y: number, g: Gem | null) {
    this.cells[y * this.w + x] = g;
  }

  private gem(kind: number, special: Special = 'none'): Gem {
    return { id: this.nextId++, kind, special };
  }

  /** A fresh board with no matches already on it and at least one move. */
  fill() {
    do {
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          let k: number;
          do k = Math.floor(this.rand() * this.kinds);
          while (
            (x >= 2 && this.at(x - 1, y)?.kind === k && this.at(x - 2, y)?.kind === k) ||
            (y >= 2 && this.at(x, y - 1)?.kind === k && this.at(x, y - 2)?.kind === k)
          );
          this.set(x, y, this.gem(k));
        }
      }
    } while (!this.findMove());
  }

  /** Mixes the gems up (keeping specials) until there's a move and nothing matches yet. */
  shuffle() {
    const gems = this.cells.filter((g): g is Gem => !!g);
    for (let tries = 0; tries < 200; tries++) {
      for (let i = gems.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [gems[i], gems[j]] = [gems[j], gems[i]];
      }
      gems.forEach((g, i) => (this.cells[i] = g));
      if (!this.runs().length && this.findMove()) return;
    }
    this.fill();
  }

  /** Runs of three or more of a kind in a row or column. */
  private runs() {
    const out: { cells: Pos[]; dir: 'h' | 'v' }[] = [];
    for (const dir of ['h', 'v'] as const) {
      const outer = dir === 'h' ? this.h : this.w;
      const inner = dir === 'h' ? this.w : this.h;
      for (let o = 0; o < outer; o++) {
        let start = 0;
        for (let i = 1; i <= inner; i++) {
          const a = dir === 'h' ? this.at(start, o) : this.at(o, start);
          const b = i < inner ? (dir === 'h' ? this.at(i, o) : this.at(o, i)) : null;
          if (b && a && a.kind >= 0 && b.kind === a.kind) continue;
          if (i - start >= 3 && a && a.kind >= 0) {
            const cells: Pos[] = [];
            for (let k = start; k < i; k++) cells.push(dir === 'h' ? { x: k, y: o } : { x: o, y: k });
            out.push({ cells, dir });
          }
          start = i;
        }
      }
    }
    return out;
  }

  /** Would swapping these two make a match (or use a rainbow)? */
  private swapWorks(a: Pos, b: Pos) {
    const ga = this.at(a.x, a.y);
    const gb = this.at(b.x, b.y);
    if (!ga || !gb) return false;
    if (ga.special === 'rainbow' || gb.special === 'rainbow') return true;
    this.set(a.x, a.y, gb);
    this.set(b.x, b.y, ga);
    const ok = this.runs().length > 0;
    this.set(a.x, a.y, ga);
    this.set(b.x, b.y, gb);
    return ok;
  }

  /** A swap that works, for hints (and to know when to shuffle). */
  findMove(): [Pos, Pos] | undefined {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const a = { x, y };
          const b = { x: x + dx, y: y + dy };
          if (b.x < this.w && b.y < this.h && this.swapWorks(a, b)) return [a, b];
        }
      }
    }
    return undefined;
  }

  /** Swaps two neighbours. If it makes no match, nothing changes. */
  swap(a: Pos, b: Pos): SwapResult {
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return { ok: false };
    if (!this.swapWorks(a, b)) return { ok: false };
    const ga = this.at(a.x, a.y)!;
    const gb = this.at(b.x, b.y)!;
    this.set(a.x, a.y, gb);
    this.set(b.x, b.y, ga);
    const phases: Phase[] = [];
    // A rainbow swapped with anything clears every gem of that kind (two rainbows: the lot).
    const rainbow = ga.special === 'rainbow' ? { r: b, other: gb } : gb.special === 'rainbow' ? { r: a, other: ga } : undefined;
    if (rainbow) {
      const phase = this.emptyPhase(1);
      const targets: Pos[] = [];
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          const g = this.at(x, y)!;
          if (rainbow.other.special === 'rainbow' || g.kind === rainbow.other.kind) targets.push({ x, y });
        }
      }
      phase.blasts.push({ ...rainbow.r, special: 'rainbow', kind: rainbow.other.kind });
      this.clearCells([rainbow.r, ...targets], phase, 'rainbow');
      this.settle(phase);
      phases.push(phase);
    }
    let cascade = phases.length + 1;
    for (;;) {
      const phase = this.matchPhase(cascade, cascade === 1 ? [a, b] : []);
      if (!phase) break;
      phases.push(phase);
      cascade++;
    }
    if (!this.findMove()) this.shuffle();
    return { ok: true, phases };
  }

  private emptyPhase(cascade: number): Phase {
    return { cleared: [], made: [], blasts: [], falls: [], points: 0, cascade };
  }

  /** Clears the board's current matches (making specials), sets off specials caught up in it, and refills. */
  private matchPhase(cascade: number, swapped: Pos[]): Phase | undefined {
    const runs = this.runs();
    if (!runs.length) return undefined;
    const phase = this.emptyPhase(cascade);
    // Join runs that share a cell (L and T shapes).
    const groups: { cells: Pos[]; runs: typeof runs }[] = [];
    for (const run of runs) {
      const hit = groups.filter((g) => g.cells.some((c) => run.cells.some((r) => r.x === c.x && r.y === c.y)));
      const merged = { cells: [...run.cells], runs: [run] };
      for (const g of hit) {
        for (const c of g.cells) if (!merged.cells.some((m) => m.x === c.x && m.y === c.y)) merged.cells.push(c);
        merged.runs.push(...g.runs);
        groups.splice(groups.indexOf(g), 1);
      }
      groups.push(merged);
    }
    const keep = new Set<string>();
    const makes: { pos: Pos; gem: Gem }[] = [];
    for (const g of groups) {
      const longest = Math.max(...g.runs.map((r) => r.cells.length));
      const kind = this.at(g.cells[0].x, g.cells[0].y)!.kind;
      let special: Special = 'none';
      if (longest >= 5) special = 'rainbow';
      else if (g.runs.some((r) => r.dir === 'h') && g.runs.some((r) => r.dir === 'v')) special = 'bomb';
      else if (longest === 4) special = g.runs[0].dir === 'h' ? 'row' : 'col';
      if (special === 'none') continue;
      // The new special goes where the player swapped, if that's in the group, else in its middle.
      const pos = g.cells.find((c) => swapped.some((s) => s.x === c.x && s.y === c.y)) ?? g.cells[Math.floor(g.cells.length / 2)];
      keep.add(`${pos.x},${pos.y}`);
      makes.push({ pos, gem: this.gem(special === 'rainbow' ? -1 : kind, special) });
      phase.points += POINTS.made;
    }
    const toClear: Pos[] = [];
    for (const g of groups) for (const c of g.cells) if (!keep.has(`${c.x},${c.y}`)) toClear.push(c);
    // The gem sitting where a special is made goes too (it's become the special).
    for (const m of makes) {
      const old = this.at(m.pos.x, m.pos.y);
      if (old) phase.cleared.push({ ...m.pos, gem: old, by: 'match' });
    }
    this.clearCells(toClear, phase, 'match', keep);
    for (const m of makes) {
      this.set(m.pos.x, m.pos.y, m.gem);
      phase.made.push({ ...m.pos, gem: m.gem });
    }
    this.settle(phase);
    return phase;
  }

  /** Removes gems, setting off any specials among them (which may clear more). */
  private clearCells(cells: Pos[], phase: Phase, by: 'match' | Special, keep = new Set<string>()) {
    const queue = cells.map((c) => ({ ...c, by }));
    const done = new Set<string>(keep);
    while (queue.length) {
      const c = queue.shift()!;
      const key = `${c.x},${c.y}`;
      if (done.has(key)) continue;
      done.add(key);
      const gem = this.at(c.x, c.y);
      if (!gem) continue;
      this.set(c.x, c.y, null);
      phase.cleared.push({ x: c.x, y: c.y, gem, by: c.by });
      phase.points += POINTS.gem;
      if (gem.special === 'none') continue;
      // A special caught in a clear goes off.
      phase.points += POINTS.special;
      phase.blasts.push({ x: c.x, y: c.y, special: gem.special, kind: gem.kind });
      const add = (x: number, y: number) => {
        if (x >= 0 && y >= 0 && x < this.w && y < this.h) queue.push({ x, y, by: gem.special });
      };
      if (gem.special === 'row') for (let x = 0; x < this.w; x++) add(x, c.y);
      else if (gem.special === 'col') for (let y = 0; y < this.h; y++) add(c.x, y);
      else if (gem.special === 'bomb') for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(c.x + dx, c.y + dy);
      else if (gem.special === 'rainbow') {
        // Caught in a blast, a rainbow takes the most common kind with it.
        const count = new Array(this.kinds).fill(0);
        for (const g of this.cells) if (g && g.kind >= 0) count[g.kind]++;
        const kind = count.indexOf(Math.max(...count));
        for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.at(x, y)?.kind === kind) add(x, y);
      }
    }
  }

  /** Drops gems into the gaps and fills each column from above. */
  private settle(phase: Phase) {
    for (let x = 0; x < this.w; x++) {
      let write = this.h - 1;
      for (let y = this.h - 1; y >= 0; y--) {
        const g = this.at(x, y);
        if (!g) continue;
        if (write !== y) {
          this.set(x, write, g);
          this.set(x, y, null);
          phase.falls.push({ gem: g, x, fromY: y, toY: write });
        }
        write--;
      }
      // New gems, stacked above the board in the order they'll land.
      for (let y = write, n = 1; y >= 0; y--, n++) {
        const g = this.gem(Math.floor(this.rand() * this.kinds));
        this.set(x, y, g);
        phase.falls.push({ gem: g, x, fromY: -n, toY: y });
      }
    }
  }
}
