/**
 * Runs raids with a bot captain (sail at the nearest navy ship or loot, turn side-on and fire
 * when in range) to check the sea is fair: islands don't overlap, navy ships can hurt you but
 * a sensible captain survives a while and sinks a few.
 *
 *   node games/pirate-cove/scripts/check-sea.ts [runs]
 */
import { ROUND, Sea, type Side } from '../src/sea.ts';

const RUNS = Number(process.argv[2] ?? 30);
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

let failed = false;
const causes = { navy: 0, fort: 0, bump: 0 };
const results: { gold: number; sunk: number; survived: number; hp: number }[] = [];
for (let run = 1; run <= RUNS; run++) {
  const sea = new Sea(rng(run));
  for (const a of sea.islands) for (const b of sea.islands) if (a !== b && Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r) failed = true;
  const p = sea.player;
  let t = 0;
  while (!sea.over && t < ROUND + 5) {
    // Pick up repairs when hurt.
    const repair = p.hp < 14 ? sea.loot.find((l) => l.kind === 'repair' && Math.hypot(l.x - p.x, l.z - p.z) < 60) : undefined;
    const enemies = repair ? [] : sea.ships.filter((s) => s !== p && s.sinking === undefined);
    if (repair) {
      p.sail = 1;
      p.turn = Math.max(-1, Math.min(1, wrap(Math.atan2(repair.x - p.x, repair.z - p.z) - p.heading) * 2));
    }
    const target = enemies.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    let want = p.heading;
    if (target) {
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz);
      const bearing = Math.atan2(dx, dz);
      want = d > 30 ? bearing : bearing + Math.PI / 2;
      p.sail = d > 30 ? 1 : 0.6;
      for (const side of ['left', 'right'] as Side[]) {
        const dir = Sea.sideDir(p, side);
        if ((dx * dir.x + dz * dir.z) / d > 0.85 && d < 38) sea.fire(p, side);
      }
    }
    if (!repair) p.turn = Math.max(-1, Math.min(1, wrap(want - p.heading) * 2));
    for (const e of sea.step(1 / 30)) {
      if (e.type === 'hit' && e.ship === p) causes[e.ball.owner === -1 ? 'fort' : 'navy']++;
      if (e.type === 'bump' && e.ship === p) causes.bump++;
    }
    t += 1 / 30;
  }
  results.push({ gold: sea.gold, sunk: sea.sunk, survived: ROUND - sea.time, hp: Math.max(0, p.hp) });
}
const avg = (f: (r: (typeof results)[0]) => number) => (results.reduce((s, r) => s + f(r), 0) / results.length).toFixed(1);
console.log(`bot captain: gold ${avg((r) => r.gold)}, sunk ${avg((r) => r.sunk)}, lasted ${avg((r) => r.survived)}s of ${ROUND}, hull left ${avg((r) => r.hp)}, survived ${results.filter((r) => r.hp > 0).length}/${results.length}`);
console.log('damage taken from:', JSON.stringify(causes));
if (failed) {
  console.log('✗ islands overlap');
  process.exit(1);
}
