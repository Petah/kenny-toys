/**
 * Plays whole runs with a bot to check the levels are pitched right: it tries every angle a
 * degree apart, takes the shot that pops and drops the most (preferring ones that at least
 * touch their own kind), then misses its aim by a degree or two the way a person would.
 * Reports how far runs get, how long they last and what they score.
 *
 *   node games/emote-pop/scripts/check-board.ts [runs]
 */
import { BOMB_DROP, Board, DEAD_ROW, MAX_AIM, level, scoreFor, seeded, type Kind } from '../src/board.ts';

const RUNS = Number(process.argv[2] ?? 100);
const SLOP = (1.5 * Math.PI) / 180;

function pickKind(board: Board, rng: () => number): Kind {
  const left = board.kindsLeft();
  return left.length ? left[Math.floor(rng() * left.length)] : 0;
}

/** How good a shot looks: pops and drops count most, then landing next to its own kind. */
function rate(board: Board, angle: number, kind: Kind) {
  const trial = board.clone();
  const shot = trial.trace(angle);
  const r = trial.place(shot.cell, trial.make(kind));
  let near = 0;
  for (const n of trial.neighbours(shot.cell)) if (trial.at(n)?.kind === kind) near++;
  return r.popped.length * 10 + r.dropped.length * 12 + near * 3 - shot.cell.row * 0.2;
}

function best(board: Board, kind: Kind) {
  let top = -Infinity;
  let angle = 0;
  for (let deg = -75; deg <= 75; deg++) {
    const a = (deg * Math.PI) / 180;
    const s = rate(board, a, kind);
    if (s > top) {
      top = s;
      angle = a;
    }
  }
  return angle;
}

interface Run {
  levels: number;
  shots: number;
  score: number;
  pushes: number;
  bombs: number;
}

function play(seed: number): Run {
  const rng = seeded(seed);
  const board = new Board(rng);
  let n = 1;
  let rules = level(n);
  board.fill(rules.rows, rules.kinds, rules.stones);
  let misses = rules.misses;
  let current: Kind = pickKind(board, rng);
  let next: Kind = pickKind(board, rng);
  const run: Run = { levels: 1, shots: 0, score: 0, pushes: 0, bombs: 0 };
  while (run.shots < 2000) {
    const aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, best(board, current) + (rng() * 2 - 1) * SLOP));
    const shot = board.trace(aim);
    const r = board.place(shot.cell, board.make(current));
    run.shots++;
    run.score += scoreFor(r.popped.length, r.dropped.length);
    if (board.lowest() >= DEAD_ROW) break;
    if (!r.popped.length && --misses <= 0) {
      board.push(rules.kinds, rules.stones);
      run.pushes++;
      misses = rules.misses;
      if (board.lowest() >= DEAD_ROW) break;
    }
    if (board.count === 0) {
      run.score += 1000 * n;
      rules = level(++n);
      run.levels = n;
      board.fill(rules.rows, rules.kinds, rules.stones);
      misses = rules.misses;
      next = pickKind(board, rng);
    }
    current = next;
    next = pickKind(board, rng);
    // Kinds that have gone from the wall are swapped for ones still there.
    const left = board.kindsLeft();
    if (typeof current === 'number' && !left.includes(current)) current = pickKind(board, rng);
    if (r.dropped.length >= BOMB_DROP) {
      current = 'bomb';
      run.bombs++;
    }
  }
  return run;
}

const runs: Run[] = [];
const t0 = performance.now();
for (let seed = 1; seed <= RUNS; seed++) runs.push(play(seed));
const ms = performance.now() - t0;

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
const line = (name: string, xs: number[]) => console.log(`${name.padEnd(8)} min ${pct(xs, 0)}  p25 ${pct(xs, 0.25)}  median ${pct(xs, 0.5)}  p75 ${pct(xs, 0.75)}  max ${pct(xs, 1)}`);
console.log(`${RUNS} bot runs in ${(ms / 1000).toFixed(1)}s`);
line('level', runs.map((r) => r.levels));
line('shots', runs.map((r) => r.shots));
line('score', runs.map((r) => r.score));
line('pushes', runs.map((r) => r.pushes));
line('bombs', runs.map((r) => r.bombs));
