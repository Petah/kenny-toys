/**
 * Plays generated rounds the simplest way a player might: one smooth line from the start domino
 * through each pawn in turn, nearest first. That route often doubles back past pawns and crosses
 * itself, which a player looking at the table would avoid, so it doesn't have to clear every round.
 * It fails if too few clear within their budget: 85% of the first three rounds, 55% after that.
 *
 *   node games/domino-chain/scripts/check-rounds.ts             seeds 1-100, rounds 1-10, three table shapes
 *   node games/domino-chain/scripts/check-rounds.ts --seeds 20  fewer seeds
 *   node games/domino-chain/scripts/check-rounds.ts --verbose   say why each failure stopped short
 *   DUMP=1 ... --verbose                                        and list the dominoes round where it stopped
 */
import { Stroke, Table, type Piece } from '../src/chain.ts';
import { setRound } from '../src/rounds.ts';

const args = process.argv.slice(2);
const seeds = Number(args[args.indexOf('--seeds') + 1]) || 100;
const verbose = args.includes('--verbose');
const SHAPES = [
  { name: 'landscape', w: 960, h: 600 },
  { name: 'portrait', w: 600, h: 960 },
  { name: 'phone', w: 420, h: 672 },
];

interface Result {
  cleared: boolean;
  laid: number;
  budget: number;
  why?: string;
}

function play(seed: number, n: number, w: number, h: number): Result {
  const table = new Table();
  const round = setRound(table, n, w, h, seed);
  const start = table.pieces.find((p) => p.stroke < 0)!;
  let laid = 0;
  const stroke = new Stroke({ table, id: 0, x: start.x, y: start.y, from: start, turnFrom: 'face', width: w, height: h, face: () => 0, budget: () => round.budget - laid });
  const left = [...table.pawns];
  let at = { x: start.x, y: start.y };
  const path = [at];
  while (left.length) {
    left.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
    at = left.shift()!;
    path.push(at);
  }
  for (const p of smooth(path, table)) laid += stroke.to(p.x, p.y).length;
  table.push(start);
  for (let t = 0; t < 60 && table.moving; t += 1 / 60) table.step(1 / 60);
  const standing = table.pawns.filter((p) => p.state === 'standing');
  const cleared = !standing.length;
  return { cleared, laid, budget: round.budget, why: cleared ? undefined : describe(table, standing[0]) };
}

/**
 * Turns the waypoints into the kind of line a player draws: a Catmull-Rom curve through every
 * pawn, pushed clear of any die, sampled every 2 units or so.
 */
function smooth(points: { x: number; y: number }[], table: Table) {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      let x = cr(p0.x, p1.x, p2.x, p3.x);
      let y = cr(p0.y, p1.y, p2.y, p3.y);
      for (const d of table.dice) {
        const dist = Math.hypot(x - d.x, y - d.y);
        if (dist < 50) {
          x = d.x + ((x - d.x) / (dist || 1)) * 50;
          y = d.y + ((y - d.y) / (dist || 1)) * 50;
        }
      }
      out.push({ x, y });
    }
  }
  return out;
}

/** Why the wave stopped: what's around the first domino in laying order that stayed up. */
function describe(table: Table, pawn: Piece) {
  const line = table.dominoes.sort((a, b) => a.id - b.id);
  const i = line.findIndex((p) => p.state === 'standing');
  if (i < 0) return 'every domino fell but a pawn was missed';
  const stuck = line[i];
  const prev = line[i - 1];
  const gap = prev ? Math.hypot(stuck.x - prev.x, stuck.y - prev.y) : 0;
  const turn = prev ? (Math.acos(Math.max(-1, Math.min(1, stuck.dx * prev.dx + stuck.dy * prev.dy))) * 180) / Math.PI : 0;
  const die = table.dice.some((d) => Math.hypot(d.x - stuck.x, d.y - stuck.y) < 90);
  const crossing = line.some((d) => Math.abs(d.id - stuck.id) > 3 && Math.hypot(d.x - stuck.x, d.y - stuck.y) < 45);
  const pawnNear = table.pawns.some((q) => Math.hypot(q.x - stuck.x, q.y - stuck.y) < 60);
  const kind = die ? 'die' : crossing ? 'crossing' : pawnNear ? 'pawn' : turn > 30 ? 'bend' : 'other';
  if (process.env.DUMP) {
    for (const d of line.filter((d) => Math.hypot(d.x - stuck.x, d.y - stuck.y) < 70)) {
      console.log(`    #${d.id} ${d.state} sign ${d.sign} order ${d.order} at ${(d.x - stuck.x).toFixed(1)},${(d.y - stuck.y).toFixed(1)} dir ${d.dx.toFixed(2)},${d.dy.toFixed(2)}`);
    }
  }
  return `${kind}: stuck #${stuck.id} gap ${gap.toFixed(0)} turn ${turn.toFixed(0)}° (missed pawn at ${pawn.x.toFixed(0)},${pawn.y.toFixed(0)})`;
}

let failed = false;
for (const shape of SHAPES) {
  for (let n = 1; n <= 10; n++) {
    let clears = 0;
    let used = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const r = play(seed, n, shape.w, shape.h);
      if (r.cleared) clears++;
      else if (verbose) console.log(`  ${shape.name} round ${n} seed ${seed}: ${r.why} (laid ${r.laid}/${r.budget})`);
      used += r.laid / r.budget;
    }
    const rate = clears / seeds;
    const ok = rate >= (n <= 3 ? 0.85 : 0.55);
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${shape.name.padEnd(9)} round ${String(n).padStart(2)}: ${(rate * 100).toFixed(0).padStart(3)}% cleared by one nearest-first line, using ${((used / seeds) * 100).toFixed(0)}% of the budget`);
  }
}
process.exit(failed ? 1 : 0);
