/**
 * Generates long skies from many seeds and checks the way up never asks for more than a
 * plain bounce can reach, that nothing overlaps the platform on the way, and prints how the
 * mix of islands, items and critters changes with height.
 *
 *   node games/sky-jumper/scripts/check-climb.ts [seeds]
 */
import { JUMP_HEIGHT, MAX_GAP, Sky, UNITS_PER_POINT, WIDTH, widthOf, type PlatformSpec } from '../src/world.ts';

const SEEDS = Number(process.argv[2] ?? 200);
const TOP = 5000 * UNITS_PER_POINT;
let failed = false;
const bands = new Map<number, Record<string, number>>();
let worstGap = 0;

for (let seed = 1; seed <= SEEDS; seed++) {
  const sky = new Sky(seed);
  let last = 0;
  const rows: PlatformSpec[][] = [];
  while (-sky.top < TOP) {
    const { platforms, enemies } = sky.next();
    const path = platforms.find((p) => p.path)!;
    const gap = last - path.y;
    worstGap = Math.max(worstGap, gap);
    if (gap > MAX_GAP + 0.01) {
      failed = true;
      console.log(`seed ${seed}: gap of ${gap.toFixed(0)} at ${(-path.y / UNITS_PER_POINT).toFixed(0)}`);
    }
    const w = widthOf(path);
    if (path.x - w / 2 < 0 || path.x + w / 2 > WIDTH) {
      failed = true;
      console.log(`seed ${seed}: platform off the side at x=${path.x.toFixed(0)}`);
    }
    // Other islands at the same height mustn't sit on top of the one on the way.
    for (const p of platforms) {
      if (p === path || Math.abs(p.y - path.y) > 30) continue;
      if (Math.abs(p.x - path.x) < (widthOf(p) + w) / 2) {
        failed = true;
        console.log(`seed ${seed}: islands overlap at ${(-path.y / UNITS_PER_POINT).toFixed(0)}`);
      }
    }
    const band = Math.floor(-path.y / UNITS_PER_POINT / 1000) * 1000;
    const b = bands.get(band) ?? {};
    b.rows = (b.rows ?? 0) + 1;
    b.gap = (b.gap ?? 0) + gap;
    for (const p of platforms) b[p.kind] = (b[p.kind] ?? 0) + 1;
    for (const p of platforms) if (p.item) b[p.item] = (b[p.item] ?? 0) + 1;
    for (const e of enemies) b[e.kind] = (b[e.kind] ?? 0) + 1;
    bands.set(band, b);
    rows.push(platforms);
    last = path.y;
  }
}

console.log(`plain bounce ${JUMP_HEIGHT.toFixed(0)} high, biggest gap ${worstGap.toFixed(0)} (allowed ${MAX_GAP})`);
console.log('per 1000 points, averaged over seeds:');
for (const [band, b] of [...bands].sort((x, y) => x[0] - y[0])) {
  const per = (k: string) => ((b[k] ?? 0) / SEEDS).toFixed(1).padStart(5);
  console.log(`  ${String(band).padStart(4)}+  gap ${(b.gap / b.rows).toFixed(0)}  moving${per('moving')} cloud${per('cloud')} crumble${per('crumble')}  spring${per('spring')} carrot${per('carrot')} jet${per('jetpack')} wings${per('wings')} bubble${per('bubble')}  fly${per('flyMan')} wing${per('wingMan')} spike${per('spikeMan')} ball${per('spikeBall')}`);
}
if (failed) process.exit(1);
console.log('all skies OK');
