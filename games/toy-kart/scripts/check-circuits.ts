/**
 * Checks every circuit closes into a loop (the last piece ends where the first began, facing
 * the same way at the same height) and that no two pieces overlap, then prints each one's
 * length and an ASCII map of its centre line.
 *
 *   node games/toy-kart/scripts/check-circuits.ts [--map]
 */
import { CIRCUITS, build, overlaps } from '../src/track.ts';

const map = process.argv.includes('--map');
let failed = false;
for (const c of CIRCUITS) {
  const b = build(c);
  const closed = b.gap.pos < 0.01 && b.gap.yaw < 0.001 && b.gap.y < 0.001;
  const over = overlaps(b);
  const ys = b.line.map((p) => p.y);
  console.log(
    `${closed && !over.length ? 'ok  ' : 'FAIL'} ${c.name.padEnd(16)} ${b.pieces.length} pieces, ${b.length.toFixed(1)} long, height ${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)}` +
      (closed ? '' : `  gap ${b.gap.pos.toFixed(2)} yaw ${((b.gap.yaw * 180) / Math.PI).toFixed(0)}° y ${b.gap.y.toFixed(2)}`) +
      (over.length ? `  overlaps ${over.map(([i, k]) => `${i}/${k}`).join(' ')}` : ''),
  );
  if (!closed || over.length) failed = true;
  if (map || !closed || over.length) {
    const xs = b.line.map((p) => p.x);
    const zs = b.line.map((p) => p.z);
    const [x0, z0] = [Math.min(...xs), Math.min(...zs)];
    const w = Math.ceil((Math.max(...xs) - x0) / 2) + 1;
    const h = Math.ceil((Math.max(...zs) - z0) / 2) + 1;
    const grid = Array.from({ length: h }, () => Array(w).fill(' '));
    b.line.forEach((p, i) => {
      const ch = i === 0 ? '@' : p.y > c.base + 0.5 ? '^' : p.y < c.base - 0.2 ? 'v' : '·';
      const cell = grid[Math.round((p.z - z0) / 2)];
      const x = Math.round((p.x - x0) / 2);
      if (cell[x] !== '@') cell[x] = ch;
    });
    for (const row of grid.reverse()) console.log('     ' + row.join(' '));
  }
}
process.exit(failed ? 1 : 0);
