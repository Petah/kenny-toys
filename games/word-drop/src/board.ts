/**
 * The well and its tiles, with no Phaser in it so scripts can play it too.
 *
 * Tiles stack in columns from the bottom. A word is a path through touching tiles (sideways,
 * up, down or diagonally), each used once. Clearing a word drops what was above it, and breaks
 * any stone touching it.
 */

export const COLS = 7;
export const ROWS = 9;
export const MIN_WORD = 3;
export const MAX_WORD = 9;

export type TileKind = 'letter' | 'double' | 'wild' | 'stone';

export interface Tile {
  id: number;
  kind: TileKind;
  /** 'A'-'Z'; '?' for a wildcard, '' for a stone. */
  letter: string;
}

export interface Cell {
  col: number;
  row: number;
}

/** Scrabble's letter values, which the pack prints on its tiles. */
export const VALUES: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

/** How many of each letter a Scrabble bag holds, used as drop odds. Q is rarer still, since it so rarely fits. */
const BAG: Record<string, number> = {
  E: 12, A: 9, I: 9, O: 8, N: 6, R: 6, T: 6, L: 4, S: 4, U: 4, D: 4, G: 3, B: 2, C: 2, M: 2,
  P: 2, F: 2, H: 2, V: 2, W: 2, Y: 2, K: 1, J: 1, X: 1, Q: 0.4, Z: 1,
};
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
/** Hard letters: a second copy on the board is much less likely. */
const RARE = new Set(['J', 'K', 'Q', 'V', 'X', 'Z']);

/** Word multiplier by length. */
export function lengthBonus(n: number) {
  return [0, 0, 0, 1, 1.5, 2, 3, 4, 5, 6][Math.min(n, MAX_WORD)];
}

export class Dictionary {
  private words: Set<string>;

  /** `text` is one lowercase word a line; lines starting with # are skipped. */
  constructor(text: string) {
    this.words = new Set(text.split('\n').filter((l) => l && !l.startsWith('#')));
  }

  get size() {
    return this.words.size;
  }

  /** Whether the letters spell a word, with each '?' standing for any letter. Returns the word it found. */
  match(letters: string): string | undefined {
    const lower = letters.toLowerCase();
    if (lower.length < MIN_WORD || lower.length > MAX_WORD) return undefined;
    const wild = lower.indexOf('?');
    if (wild < 0) return this.words.has(lower) ? lower : undefined;
    for (let c = 97; c <= 122; c++) {
      const found = this.match(lower.slice(0, wild) + String.fromCharCode(c) + lower.slice(wild + 1));
      if (found) return found;
    }
    return undefined;
  }

  /** Whether any word starts with these letters (wildcards allowed); used by the solver to prune. */
  hasPrefix(prefix: string) {
    if (!this.prefixes) {
      this.prefixes = new Set();
      for (const w of this.words) for (let i = 1; i <= w.length; i++) this.prefixes.add(w.slice(0, i));
    }
    const lower = prefix.toLowerCase();
    const wild = lower.indexOf('?');
    if (wild < 0) return this.prefixes.has(lower);
    for (let c = 97; c <= 122; c++) if (this.hasPrefix(lower.slice(0, wild) + String.fromCharCode(c) + lower.slice(wild + 1))) return true;
    return false;
  }

  private prefixes?: Set<string>;
}

export interface ClearResult {
  word: string;
  score: number;
  /** Stones broken because they touched the word. */
  stones: Tile[];
}

export class Well {
  /** columns[c][r]: r = 0 is the bottom. */
  columns: Tile[][] = Array.from({ length: COLS }, () => []);
  private nextId = 0;
  private rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  at(c: Cell): Tile | undefined {
    return this.columns[c.col]?.[c.row];
  }

  find(tile: Tile): Cell | undefined {
    for (let col = 0; col < COLS; col++) {
      const row = this.columns[col].indexOf(tile);
      if (row >= 0) return { col, row };
    }
    return undefined;
  }

  get tiles() {
    return this.columns.flat();
  }

  /** A fresh tile of the given kind; letters are drawn from the bag, nudged to keep vowels around a third. */
  make(kind: TileKind = 'letter'): Tile {
    if (kind === 'stone') return { id: this.nextId++, kind, letter: '' };
    if (kind === 'wild') return { id: this.nextId++, kind, letter: '?' };
    return { id: this.nextId++, kind, letter: this.drawLetter() };
  }

  private drawLetter() {
    const letters = this.tiles.filter((t) => t.kind !== 'stone' && t.kind !== 'wild');
    const vowels = letters.filter((t) => VOWELS.has(t.letter)).length;
    const share = letters.length ? vowels / letters.length : 0.4;
    // Lean towards whichever is short, so the well never goes all consonants or all vowels.
    const want = share < 0.3 ? 'vowel' : share > 0.5 ? 'consonant' : undefined;
    // Don't pile up copies of the same letter, or Qs without a U to go with them.
    const counts: Record<string, number> = {};
    for (const t of letters) counts[t.letter] = (counts[t.letter] ?? 0) + 1;
    const weights = Object.entries(BAG).map(([l, w]) => {
      let weight = w;
      if (want === 'vowel' && !VOWELS.has(l)) weight *= 0.15;
      if (want === 'consonant' && VOWELS.has(l)) weight *= 0.15;
      weight /= 1 + (counts[l] ?? 0) * (VOWELS.has(l) ? 0.3 : RARE.has(l) ? 4 : 0.8);
      if (l === 'Q' && !counts.U) weight = 0;
      return [l, weight] as const;
    });
    let roll = this.rand() * weights.reduce((s, [, w]) => s + w, 0);
    for (const [l, w] of weights) {
      roll -= w;
      if (roll <= 0) return l;
    }
    return 'E';
  }

  /** Whether a tile dropped into this column would fit. */
  hasRoom(col: number) {
    return this.columns[col].length < ROWS;
  }

  /** Puts a tile on top of a column and returns where it landed. */
  drop(col: number, tile: Tile): Cell {
    this.columns[col].push(tile);
    return { col, row: this.columns[col].length - 1 };
  }

  /** Fills the bottom `rows` rows with letters. */
  fill(rows: number) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) this.drop(c, this.make());
  }

  /** The letters a path spells, '?' for wildcards. */
  spell(path: Cell[]) {
    return path.map((c) => this.at(c)?.letter ?? '').join('');
  }

  /** Whether `next` can extend `path`: a letter tile touching the last one, not used yet. */
  canExtend(path: Cell[], next: Cell) {
    const t = this.at(next);
    if (!t || t.kind === 'stone') return false;
    if (path.some((c) => c.col === next.col && c.row === next.row)) return false;
    const last = path.at(-1);
    return !last || (Math.abs(last.col - next.col) <= 1 && Math.abs(last.row - next.row) <= 1);
  }

  /** What a path would score if it's a word: letter values × the length bonus, doubled per red tile. */
  score(path: Cell[]) {
    const tiles = path.map((c) => this.at(c)!);
    const base = tiles.reduce((s, t) => s + (VALUES[t.letter] ?? 0), 0);
    const doubles = tiles.filter((t) => t.kind === 'double').length;
    return Math.round(base * lengthBonus(path.length) * 2 ** doubles) * 10;
  }

  /** Takes a word's tiles out, breaks any stone touching them, and lets everything above fall. */
  clear(path: Cell[], word: string): ClearResult {
    const score = this.score(path);
    const used = new Set(path.map((c) => this.at(c)!));
    const stones = new Set<Tile>();
    for (const c of path) {
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const t = this.at({ col: c.col + dc, row: c.row + dr });
          if (t?.kind === 'stone') stones.add(t);
        }
      }
    }
    this.columns = this.columns.map((col) => col.filter((t) => !used.has(t) && !stones.has(t)));
    return { word, score, stones: [...stones] };
  }

  /** Mixes the letters into new places, keeping every tile's column height. Stones stay put. */
  shuffle() {
    const cells: Cell[] = [];
    for (let col = 0; col < COLS; col++) this.columns[col].forEach((t, row) => t.kind !== 'stone' && cells.push({ col, row }));
    const tiles = cells.map((c) => this.at(c)!);
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    cells.forEach((c, i) => (this.columns[c.col][c.row] = tiles[i]));
  }

  /**
   * A path that spells `word` (wildcards fill in for any letter), preferring one that starts
   * with `along`, so typing extends what's already picked. Undefined if there's none.
   */
  pathFor(word: string, along: Cell[] = []): Cell[] | undefined {
    const target = word.toUpperCase();
    const prefix = along.slice(0, target.length).filter((c, i) => {
      const t = this.at(c);
      return t && (t.letter === target[i] || t.kind === 'wild');
    });
    const tries = prefix.length === along.length || prefix.length === target.length ? [prefix, []] : [[]];
    for (const start of tries) {
      const found = this.search(target, [...start]);
      if (found) return found;
    }
    return undefined;
  }

  private search(target: string, path: Cell[]): Cell[] | undefined {
    if (path.length === target.length) return path;
    const want = target[path.length];
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < this.columns[col].length; row++) {
        const t = this.columns[col][row];
        const cell = { col, row };
        if ((t.letter !== want && t.kind !== 'wild') || !this.canExtend(path, cell)) continue;
        const found = this.search(target, [...path, cell]);
        if (found) return found;
      }
    }
    return undefined;
  }

  /** Every word on the board (one path each), longest first. For checks and tests. */
  words(dict: Dictionary, limit = Infinity): { word: string; path: Cell[] }[] {
    const found = new Map<string, Cell[]>();
    const walk = (path: Cell[]) => {
      if (found.size >= limit) return;
      const letters = this.spell(path);
      if (path.length >= MIN_WORD) {
        const w = dict.match(letters);
        if (w && !found.has(w)) found.set(w, path);
      }
      if (path.length >= MAX_WORD || !dict.hasPrefix(letters)) return;
      const last = path.at(-1)!;
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const next = { col: last.col + dc, row: last.row + dr };
          if (this.canExtend(path, next)) walk([...path, next]);
        }
      }
    };
    for (let col = 0; col < COLS; col++) for (let row = 0; row < this.columns[col].length; row++) if (this.canExtend([], { col, row })) walk([{ col, row }]);
    return [...found].map(([word, path]) => ({ word, path })).sort((a, b) => b.word.length - a.word.length);
  }
}
