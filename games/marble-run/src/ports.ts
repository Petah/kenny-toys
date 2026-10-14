/**
 * Finds where a track piece's groove meets the edge of the piece: its "ports", where another
 * piece can join. Worked out from the model's triangles, so every piece in the kit snaps
 * without hand-measured numbers. No three.js, so scripts can use it under Node.
 */
import type { Triangles } from '../../../shared/glb.ts';

export type Side = 'n' | 'e' | 's' | 'w';

export interface Port {
  side: Side;
  /** Groove centre on the piece's edge, in the piece's own coordinates. */
  x: number;
  z: number;
  /** Height of the groove's floor there. */
  floor: number;
  /** Unit vector pointing out of the piece. */
  dx: number;
  dz: number;
}

/** Heights of every surface above a point, highest first. */
function heightsAt(t: Triangles, x: number, z: number) {
  const p = t.positions;
  const out: number[] = [];
  for (let i = 0; i < t.indices.length; i += 3) {
    const [a, b, c] = [t.indices[i] * 3, t.indices[i + 1] * 3, t.indices[i + 2] * 3];
    const d = (p[b + 2] - p[c + 2]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 2] - p[c + 2]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((p[b + 2] - p[c + 2]) * (x - p[c]) + (p[c] - p[b]) * (z - p[c + 2])) / d;
    const l2 = ((p[c + 2] - p[a + 2]) * (x - p[c]) + (p[a] - p[c]) * (z - p[c + 2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    out.push(l1 * p[a + 1] + l2 * p[b + 1] + l3 * p[c + 1]);
  }
  return out.sort((u, v) => v - u);
}

export function bounds(t: Triangles) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < t.positions.length; i += 3) {
    b.minX = Math.min(b.minX, t.positions[i]);
    b.maxX = Math.max(b.maxX, t.positions[i]);
    b.minY = Math.min(b.minY, t.positions[i + 1]);
    b.maxY = Math.max(b.maxY, t.positions[i + 1]);
    b.minZ = Math.min(b.minZ, t.positions[i + 2]);
    b.maxZ = Math.max(b.maxZ, t.positions[i + 2]);
  }
  return b;
}

const STEP = 0.01;
/** A groove is at least this much lower than the walls beside it, and this wide. */
const DEPTH = 0.12;
const MIN_WIDTH = 0.25;
const MAX_WIDTH = 1.2;

/**
 * Scans along each side just inside the piece's outline. Where the top surface dips into a
 * groove between two walls, that's a port. Stacked pieces (helixes) can have track above a
 * port, so each sample looks at every surface there, not just the top one.
 */
export function findPorts(t: Triangles): Port[] {
  const b = bounds(t);
  const sides: { side: Side; fixed: number; axis: 'x' | 'z'; from: number; to: number; dx: number; dz: number }[] = [
    { side: 'n', fixed: b.minZ + 0.015, axis: 'x', from: b.minX, to: b.maxX, dx: 0, dz: -1 },
    { side: 's', fixed: b.maxZ - 0.015, axis: 'x', from: b.minX, to: b.maxX, dx: 0, dz: 1 },
    { side: 'w', fixed: b.minX + 0.015, axis: 'z', from: b.minZ, to: b.maxZ, dx: -1, dz: 0 },
    { side: 'e', fixed: b.maxX - 0.015, axis: 'z', from: b.minZ, to: b.maxZ, dx: 1, dz: 0 },
  ];
  const ports: Port[] = [];
  for (const s of sides) {
    // Each sample: the surfaces there, grouped into "layers" by height.
    const samples: { at: number; heights: number[] }[] = [];
    for (let at = s.from + STEP / 2; at < s.to; at += STEP) {
      const [x, z] = s.axis === 'x' ? [at, s.fixed] : [s.fixed, at];
      samples.push({ at, heights: heightsAt(t, x, z) });
    }
    // Look for a groove in each distinct layer of track along this side.
    const layers = [...new Set(samples.flatMap((p) => p.heights.map((h) => Math.round(h * 4) / 4)))].sort((u, v) => v - u);
    for (const layer of layers) {
      // Height of this layer's surface at each sample (the surface within half a unit below the layer's level).
      const h = samples.map((p) => p.heights.find((y) => y <= layer + 0.13 && y >= layer - 0.5));
      const wallTop = Math.max(...h.filter((y): y is number => y !== undefined));
      let start = -1;
      for (let i = 0; i <= h.length; i++) {
        const low = i < h.length && h[i] !== undefined && h[i]! < wallTop - DEPTH;
        if (low && start < 0) start = i;
        if (!low && start >= 0) {
          const width = (i - start) * STEP;
          // A groove needs a wall (or higher ground) on both sides.
          const walled = start > 0 && i < h.length && h[start - 1] !== undefined && h[i] !== undefined;
          if (width >= MIN_WIDTH && width <= MAX_WIDTH && walled) {
            const mid = (samples[start].at + samples[i - 1].at) / 2;
            const floor = Math.min(...h.slice(start, i).map((y) => y!));
            const [x, z] = s.axis === 'x' ? [mid, s.side === 'n' ? b.minZ : b.maxZ] : [s.side === 'w' ? b.minX : b.maxX, mid];
            if (!ports.some((p) => p.side === s.side && Math.hypot(p.x - x, p.z - z) < 0.1 && Math.abs(p.floor - floor) < 0.1)) {
              ports.push({ side: s.side, x: round(x), z: round(z), floor: round(floor), dx: s.dx, dz: s.dz });
            }
          }
          start = -1;
        }
      }
    }
  }
  return ports;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
