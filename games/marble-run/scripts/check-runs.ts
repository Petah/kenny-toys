/**
 * Rolls marbles down a batch of random runs (the same generator as "Surprise me") and reports
 * how many reach the end, and where the rest left the track or stalled. Run it after changing
 * the physics or the palette.
 *
 *   node games/marble-run/scripts/check-runs.ts [runs] [seed]
 */
import { ITEMS } from '../src/pieces.ts';
import { randomRun, type Shape } from '../src/track.ts';
import { loadShape } from './check-pieces.ts';
import { roll } from './roll.ts';

const [runs = 30, seed = 7] = process.argv.slice(2).map(Number);
const cache = new Map<string, Shape>();
const shapes = (m: string) => cache.get(m) ?? cache.set(m, loadShape(m)).get(m)!;
let s = seed;
const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;

const problems = new Map<string, number>();
let finished = 0;
let total = 0;
let items = 0;
for (let r = 0; r < runs; r++) {
  const ids = randomRun(ITEMS, shapes, rand).map((i) => i.id);
  items += ids.length;
  const { results } = await roll(ids, 3, false);
  for (const res of results) {
    total++;
    if (res.how === 'off the end') finished++;
    else {
      const key = res.how.replace(/ at [^,]*,[^,]*,/, ',').replace(/item \d+ /, '').replace(/top speed (\d+)\.\d/, 'top speed ~$1');
      problems.set(key, (problems.get(key) ?? 0) + 1);
    }
  }
}
console.log(`${finished}/${total} marbles reached the end of ${runs} random runs (${(items / runs).toFixed(1)} items each)`);
for (const [k, v] of [...problems].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x ${k}`);
process.exit(finished / total < 0.9 ? 1 : 0);
