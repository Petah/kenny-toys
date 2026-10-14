/**
 * Sokoban rules with no Phaser in sight, so the level checker can run them under plain Node.
 *
 * Levels are written in the usual Sokoban text format, plus colours:
 *   #  wall          @  player         $  crate         .  target
 *   *  crate on target                  +  player on target
 *   r g b  coloured crates, which only count on   R G B  targets of the same colour.
 * Spaces inside the walls are floor. Anything the player can't reach is left blank.
 */

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Color = 'plain' | 'red' | 'green' | 'blue';

export const STEP: Record<Dir, readonly [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const CRATE: Record<string, Color> = { $: 'plain', '*': 'plain', r: 'red', g: 'green', b: 'blue' };
const TARGET: Record<string, Color> = { '.': 'plain', '*': 'plain', '+': 'plain', R: 'red', G: 'green', B: 'blue' };

export interface Board {
  width: number;
  height: number;
  walls: Set<number>;
  /** Floor the player can reach, flood-filled from the start. Walls and outside stay out. */
  floor: Set<number>;
  targets: Map<number, Color>;
  crates: { pos: number; color: Color }[];
  player: number;
}

export function parseLevel(rows: readonly string[]): Board {
  const width = Math.max(...rows.map((r) => r.length));
  const height = rows.length;
  const walls = new Set<number>();
  const targets = new Map<number, Color>();
  const crates: Board['crates'] = [];
  let player = -1;
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const pos = y * width + x;
      if (ch === '#') walls.add(pos);
      if (ch in CRATE) crates.push({ pos, color: CRATE[ch] });
      if (ch in TARGET) targets.set(pos, TARGET[ch]);
      if (ch === '@' || ch === '+') player = pos;
    });
  });
  if (player < 0) throw new Error('level has no player');

  const floor = new Set<number>([player]);
  const queue = [player];
  while (queue.length) {
    const pos = queue.pop()!;
    for (const [dx, dy] of Object.values(STEP)) {
      const x = (pos % width) + dx;
      const y = Math.floor(pos / width) + dy;
      const next = y * width + x;
      if (x < 0 || y < 0 || x >= width || y >= height || walls.has(next) || floor.has(next)) continue;
      floor.add(next);
      queue.push(next);
    }
  }

  for (const color of ['plain', 'red', 'green', 'blue'] as const) {
    const nCrates = crates.filter((c) => c.color === color).length;
    const nTargets = [...targets.values()].filter((c) => c === color).length;
    if (nCrates !== nTargets) throw new Error(`${nCrates} ${color} crates but ${nTargets} ${color} targets`);
  }
  return { width, height, walls, floor, targets, crates, player };
}

export type MoveResult =
  | { kind: 'blocked'; dir: Dir; crate?: number }
  | { kind: 'walk'; dir: Dir; from: number; to: number }
  | { kind: 'push'; dir: Dir; from: number; to: number; crate: number; crateTo: number };

interface Snapshot {
  player: number;
  crates: number[];
  pushes: number;
}

/** One play-through of a level: positions, counters and undo history. */
export class Sokoban {
  readonly board: Board;
  player: number;
  /** Crate positions, indexed like board.crates (so each crate keeps its colour and sprite). */
  crates: number[];
  moves = 0;
  pushes = 0;
  private history: Snapshot[] = [];

  constructor(board: Board) {
    this.board = board;
    this.player = board.player;
    this.crates = board.crates.map((c) => c.pos);
  }

  get canUndo() {
    return this.history.length > 0;
  }

  /** Index of the crate at a position, or -1. */
  crateAt(pos: number) {
    return this.crates.indexOf(pos);
  }

  /** The cell one step from `pos`, or -1 off the edge. */
  neighbour(pos: number, dir: Dir) {
    const { width, height } = this.board;
    const x = (pos % width) + STEP[dir][0];
    const y = Math.floor(pos / width) + STEP[dir][1];
    return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
  }

  isOpen(pos: number) {
    return pos >= 0 && this.board.floor.has(pos) && this.crateAt(pos) < 0;
  }

  /** Is crate `i` sitting on a target of its own colour? */
  isHome(i: number) {
    return this.board.targets.get(this.crates[i]) === this.board.crates[i].color;
  }

  get solved() {
    return this.crates.every((_, i) => this.isHome(i));
  }

  move(dir: Dir): MoveResult {
    const to = this.neighbour(this.player, dir);
    if (to < 0 || !this.board.floor.has(to)) return { kind: 'blocked', dir };
    const crate = this.crateAt(to);
    if (crate < 0) {
      this.remember();
      const from = this.player;
      this.player = to;
      this.moves++;
      return { kind: 'walk', dir, from, to };
    }
    const crateTo = this.neighbour(to, dir);
    if (!this.isOpen(crateTo)) return { kind: 'blocked', dir, crate };
    this.remember();
    const from = this.player;
    this.player = to;
    this.crates[crate] = crateTo;
    this.moves++;
    this.pushes++;
    return { kind: 'push', dir, from, to, crate, crateTo };
  }

  undo() {
    const last = this.history.pop();
    if (!last) return false;
    this.player = last.player;
    this.crates = last.crates;
    this.pushes = last.pushes;
    this.moves--;
    return true;
  }

  /** Shortest walk to `goal` that doesn't push anything, as a list of steps; null if there's none. */
  pathTo(goal: number): Dir[] | null {
    if (goal === this.player) return [];
    if (!this.isOpen(goal)) return null;
    const cameFrom = new Map<number, [number, Dir]>();
    const queue = [this.player];
    for (let head = 0; head < queue.length; head++) {
      const pos = queue[head];
      for (const dir of Object.keys(STEP) as Dir[]) {
        const next = this.neighbour(pos, dir);
        if (next === this.player || cameFrom.has(next) || !this.isOpen(next)) continue;
        cameFrom.set(next, [pos, dir]);
        if (next === goal) {
          const path: Dir[] = [];
          for (let at = goal; at !== this.player; at = cameFrom.get(at)![0]) path.unshift(cameFrom.get(at)![1]);
          return path;
        }
        queue.push(next);
      }
    }
    return null;
  }

  private remember() {
    this.history.push({ player: this.player, crates: [...this.crates], pushes: this.pushes });
  }
}
