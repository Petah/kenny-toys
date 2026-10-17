/**
 * Plays every level with a bot paddle and checks each one can be cleared: no power-ups, the
 * paddle chasing the ball at a human-ish top speed and hitting it off-centre by a random amount
 * so the angles vary. Prints the median and slowest clear time and how often the bot missed.
 *
 *   node games/brick-breaker/scripts/check-levels.ts [runs]
 */
import { BALL_R, CELL, PADDLE_Y, WIDTH, chain, moveBall, parseLevel, remaining, type Ball, type StepEvents } from '../src/field.ts';
import { LEVELS } from '../src/levels.ts';

const RUNS = Number(process.argv[2] ?? 30);
const DT = 1 / 120;
const LIMIT = 600;
const SPEED = 330;
const PADDLE_W = 4 * CELL;
const PADDLE_SPEED = 700;

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
for (const [i, def] of LEVELS.entries()) {
  const times: number[] = [];
  let misses = 0;
  let stuck = 0;
  for (let run = 0; run < RUNS; run++) {
    const rand = rng(run * 977 + i);
    const bricks = parseLevel(def.map);
    let paddle = WIDTH / 2;
    let aim = 0;
    let stale = 0;
    const a0 = (rand() - 0.5) * 0.8;
    let ball: Ball = { id: 1, x: paddle, y: PADDLE_Y - BALL_R, vx: Math.sin(a0) * SPEED, vy: -Math.cos(a0) * SPEED, stuck: false };
    let t = 0;
    while (remaining(bricks) > 0 && t < LIMIT) {
      t += DT;
      stale += DT;
      // Chase where the ball is, offset by the aim picked at the last bounce.
      const want = Math.max(PADDLE_W / 2, Math.min(WIDTH - PADDLE_W / 2, ball.x - aim));
      paddle += Math.max(-PADDLE_SPEED * DT, Math.min(PADDLE_SPEED * DT, want - paddle));
      const ev: StepEvents = { hits: [], walls: 0, paddle: [], lost: [], explode: [] };
      moveBall(ball, DT, bricks, { x: paddle, w: PADDLE_W }, ev);
      if (ev.paddle.length) aim = (rand() - 0.5) * PADDLE_W * 0.8;
      for (const h of ev.hits) if (h.broke) { chain(h.brick, bricks); stale = 0; }
      // Same anti-loop nudge as the game.
      if (ev.walls && stale > 12) {
        const a = Math.atan2(ball.vy, ball.vx) + (rand() - 0.5) * 0.5;
        ball.vx = Math.cos(a) * SPEED;
        ball.vy = Math.sin(a) * SPEED;
        if (Math.abs(ball.vy) < SPEED * 0.35) ball.vy = Math.sign(ball.vy || 1) * SPEED * 0.35;
      }
      if (stale > 30) stuck = Math.max(stuck, stale);
      if (ev.lost.length) {
        misses++;
        paddle = WIDTH / 2;
        ball = { id: 1, x: paddle, y: PADDLE_Y - BALL_R, vx: SPEED * 0.3, vy: -SPEED * 0.95, stuck: false };
      }
    }
    if (remaining(bricks) > 0) {
      failed = true;
      console.log(`✗ level ${i + 1} ${def.name}: run ${run} left ${remaining(bricks)} bricks after ${LIMIT}s: ${bricks.filter((k) => k.hp > 0).map((k) => `${k.x / CELL},${(k.y - 40) / 14}`).join(" ")}`);
    }
    times.push(t);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)];
  console.log(`${String(i + 1).padStart(2)} ${def.name.padEnd(14)} bricks ${String(remaining(parseLevel(def.map))).padStart(3)}  median ${med.toFixed(0).padStart(3)}s  slowest ${times[times.length - 1].toFixed(0).padStart(3)}s  misses/run ${(misses / RUNS).toFixed(1)}${stuck ? `  longest dry spell ${stuck.toFixed(0)}s` : ''}`);
}
if (failed) process.exit(1);
console.log('✓ every level cleared in every run');
