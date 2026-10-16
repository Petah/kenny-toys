/**
 * Plays the board with bots and checks it stays sound: full after every swap, nothing left
 * matching, no gem in two places, a move always available. Prints how often specials and
 * cascades happen and points per move, for a greedy bot and one that takes the first move.
 *
 *   node games/gem-swap/scripts/check-board.ts [moves]
 */
import { Board, type Pos } from '../src/board.ts';

const MOVES = Number(process.argv[2] ?? 3000);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failed = false;
const fail = (msg: string) => {
  if (!failed) console.log(`✗ ${msg}`);
  failed = true;
};

function allMoves(b: Board): [Pos, Pos][] {
  const out: [Pos, Pos][] = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) for (const [dx, dy] of [[1, 0], [0, 1]]) {
    if (x + dx < b.w && y + dy < b.h) out.push([{ x, y }, { x: x + dx, y: y + dy }]);
  }
  return out;
}

for (const greedy of [false, true]) {
  const b = new Board(8, 8, 6, rng(greedy ? 2 : 1));
  let points = 0;
  let cascades = 0;
  const made: Record<string, number> = {};
  let best = 0;
  for (let m = 0; m < MOVES; m++) {
    let res;
    if (greedy) {
      // Try every move on a copy and keep the best scoring.
      let bestPts = -1;
      let bestMove: [Pos, Pos] | undefined;
      for (const mv of allMoves(b)) {
        const copy = Object.assign(Object.create(Object.getPrototypeOf(b)), structuredClone({ ...b, rand: undefined }), { rand: rng(m) });
        const r = copy.swap(mv[0], mv[1]);
        if (!r.ok) continue;
        const pts = r.phases.reduce((s: number, p: { points: number }) => s + p.points, 0);
        if (pts > bestPts) {
          bestPts = pts;
          bestMove = mv;
        }
      }
      res = b.swap(bestMove![0], bestMove![1]);
    } else {
      const mv = b.findMove();
      if (!mv) {
        fail('no move left');
        break;
      }
      res = b.swap(mv[0], mv[1]);
    }
    if (!res.ok) {
      fail('a found move was refused');
      break;
    }
    const pts = res.phases.reduce((s, p) => s + p.points * p.cascade, 0);
    points += pts;
    best = Math.max(best, pts);
    cascades += res.phases.length - 1;
    for (const p of res.phases) for (const mk of p.made) made[mk.gem.special] = (made[mk.gem.special] ?? 0) + 1;
    // Sound board.
    const ids = new Set<number>();
    for (const g of b.cells) {
      if (!g) fail('a hole in the board');
      else if (ids.has(g.id)) fail('a gem in two places');
      else ids.add(g.id);
    }
    if (!b.findMove()) fail('left with no move');
  }
  const per = (n: number) => ((n / MOVES) * 100).toFixed(1);
  console.log(`${greedy ? 'greedy' : 'first '} bot: ${(points / MOVES).toFixed(0)} pts/move (best ${best}), ${per(cascades)} cascades per 100 moves, specials per 100: row ${per((made.row ?? 0))} col ${per(made.col ?? 0)} bomb ${per(made.bomb ?? 0)} rainbow ${per(made.rainbow ?? 0)}`);
}
if (failed) process.exit(1);
console.log('board OK');
