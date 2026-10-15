/**
 * Checks the islands: how much of each chunk is land and how much open ground there is for
 * targets, over a few seeds. With --dump FILE it writes one seed's tile numbers as JSON, for
 * drawing a picture of a stretch of the map.
 *
 *   node games/island-raid/scripts/check-terrain.ts [--dump out.json]
 */
import { writeFileSync } from 'node:fs';
import { CHUNK_COLS, CHUNK_CELLS, Terrain, WATER } from '../src/terrain.ts';

const CHUNKS = 30;
const dump = process.argv.indexOf('--dump');
const land: number[] = [];
const spots: number[] = [];
for (let seed = 1; seed <= 20; seed++) {
  const terrain = new Terrain(seed * 7919);
  const rows: number[][] = [];
  for (let i = 0; i > -CHUNKS; i--) {
    const c = terrain.chunk(i);
    rows.unshift(...c.tiles);
    // Only the middle of the map, where the planes fly.
    const middle = c.tiles.flatMap((r) => r.slice(CHUNK_COLS / 2 - 6, CHUNK_COLS / 2 + 6));
    land.push(middle.filter((t) => t !== WATER).length / middle.length);
    spots.push(c.spots.filter((s) => Math.abs(s.x) < 6 * 16).length);
  }
  if (seed === 1 && dump > 0) writeFileSync(process.argv[dump + 1], JSON.stringify(rows));
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)];
console.log(`${land.length} chunks of ${CHUNK_CELLS * 2} rows`);
console.log(`land in the middle: median ${(pct(land, 0.5) * 100).toFixed(0)}%, 10th ${(pct(land, 0.1) * 100).toFixed(0)}%, 90th ${(pct(land, 0.9) * 100).toFixed(0)}%`);
console.log(`open ground spots in the middle: median ${pct(spots, 0.5)}, 10th ${pct(spots, 0.1)}, chunks with none ${spots.filter((s) => s === 0).length}`);
