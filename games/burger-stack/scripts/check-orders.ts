/**
 * Plays shifts with bots: a careful one that chases what the ticket needs and steps aside from
 * anything else about to land, and a sloppy one that only chases. Prints burgers served and
 * mistakes, to pitch the speed of the falling food.
 *
 *   node games/burger-stack/scripts/check-orders.ts [shifts]
 */
import { CATCH_R, HALF_W, Kitchen, LAYER } from '../src/kitchen.ts';

const SHIFTS = Number(process.argv[2] ?? 40);
/** The plate's top speed under the arrow keys (the mouse can go faster). */
const PLATE_SPEED = 13;
const DT = 1 / 120;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shift(seed: number, careful: boolean) {
  const k = new Kitchen(rng(seed));
  let x = 0;
  let wrong = 0;
  while (k.time > 0) {
    const top = k.height;
    // Time for each thing to reach the top of the stack.
    const eta = (i: { y: number; vy: number }) => (i.y - top) / -i.vy;
    const wanted = k.items.filter((i) => i.kind === k.needed && i.y > top).sort((a, b) => eta(a) - eta(b));
    // Go for the soonest one the plate can still get under.
    let target = x;
    for (const w of wanted) {
      if (Math.abs(w.x - x) - CATCH_R * 0.6 <= PLATE_SPEED * eta(w)) {
        target = w.x;
        break;
      }
    }
    if (careful) {
      // Something wrong about to land on the plate: dodge it, the short way.
      for (const b of k.items) {
        if (b.kind === k.needed || b.y < top || eta(b) > 0.45) continue;
        if (Math.abs(b.x - target) < CATCH_R + 0.3) target = b.x + (target >= b.x ? 1 : -1) * (CATCH_R + 0.5);
      }
    }
    target = Math.max(-HALF_W, Math.min(HALF_W, target));
    const step = PLATE_SPEED * DT;
    x += Math.max(-step, Math.min(step, target - x));
    for (const e of k.step(DT, x)) if (e.type === 'catch' && !e.right) wrong++;
  }
  return { served: k.served, wrong, cash: k.cash, time: k.elapsed };
}

for (const careful of [true, false]) {
  const runs = Array.from({ length: SHIFTS }, (_, i) => shift(i + 1, careful));
  const avg = (f: (r: (typeof runs)[0]) => number) => (runs.reduce((s, r) => s + f(r), 0) / runs.length).toFixed(1);
  const served = runs.map((r) => r.served).sort((a, b) => a - b);
  console.log(`${careful ? 'careful' : 'sloppy '} bot: served ${avg((r) => r.served)} (median ${served[served.length >> 1]}, ${served[0]}–${served[served.length - 1]}), wrong catches ${avg((r) => r.wrong)}, $${avg((r) => r.cash)}, shift ${avg((r) => r.time)}s`);
}
void LAYER;
