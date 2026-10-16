/**
 * Plays every wave with bots that build and upgrade towers between waves, to pitch the
 * difficulty: a sensible bot should win with some lives lost, a lazy one (turrets only, never
 * upgrading) should lose partway.
 *
 *   node games/ufo-defense/scripts/check-waves.ts
 */
import { Defense, LIVES, TOWERS, WAVES, upgradeCost, type TowerKind } from '../src/defense.ts';

/** How much of the path each free tile can reach, for placing towers. */
function coverage(d: Defense, col: number, row: number, range: number) {
  let n = 0;
  for (let s = 0; s < d.route.length; s += 0.25) {
    const p = d.route.at(s);
    if (Math.hypot(p.x - col, p.z - row) <= range) n++;
  }
  return n;
}

function play(strategy: 'smart' | 'lazy') {
  const d = new Defense();
  console.log(`  map ${d.level.cols}×${d.level.rows}, path ${d.level.path.length} tiles (${d.route.length.toFixed(1)} long), ${d.level.free.length} tower spots`);
  const plan: TowerKind[] = strategy === 'lazy' ? ['turret'] : ['turret', 'cannon', 'turret', 'ballista', 'cannon', 'catapult'];
  let n = 0;
  const spend = () => {
    for (let guard = 0; guard < 50; guard++) {
      const kind = plan[n % plan.length];
      // Upgrade first once there are a few towers (smart only).
      if (strategy === 'smart' && d.towers.length >= 4) {
        const t = d.towers.filter((x) => x.level < 3).sort((a, b) => a.level - b.level)[0];
        if (t && d.coins >= upgradeCost(t.kind, t.level) && (d.coins < TOWERS[kind].cost * 1.5 || d.towers.length > 8)) {
          d.upgrade(t);
          continue;
        }
      }
      if (d.coins < TOWERS[kind].cost) return;
      const spots = d.level.free.filter((c) => d.canBuild(c.col, c.row));
      if (!spots.length) return;
      const best = spots.sort((a, b) => coverage(d, b.col, b.row, TOWERS[kind].range) - coverage(d, a.col, a.row, TOWERS[kind].range))[0];
      d.build(kind, best.col, best.row);
      n++;
    }
  };
  let t = 0;
  while (!d.ended && t < 3600) {
    if (!d.running) {
      spend();
      d.sendWave();
    }
    d.step(1 / 30);
    t += 1 / 30;
  }
  return { result: d.ended, wave: d.wave, lives: d.lives, towers: d.towers.length, levels: d.towers.reduce((s, x) => s + x.level, 0), score: d.score, minutes: (t / 60).toFixed(1) };
}

for (const s of ['smart', 'lazy'] as const) {
  console.log(s);
  console.log('  ', JSON.stringify(play(s)));
}
void LIVES;
void WAVES;
