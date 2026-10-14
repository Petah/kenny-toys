/**
 * Rolls marbles down a run under Node and reports how far each got. With no arguments it
 * builds a sample run; pass item ids to try your own:
 *
 *   node games/marble-run/scripts/roll.ts [straight drop left ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { readGlb, type Triangles } from '../../../shared/glb.ts';
import { ITEMS } from '../src/pieces.ts';
import { MARBLE_RADIUS, RunPhysics, STEP, initPhysics } from '../src/physics.ts';
import { START, buildRun, type Shape } from '../src/track.ts';
import { bounds, findPorts } from '../src/ports.ts';

const ROOT = process.env.KENNEY_ROOT ?? path.resolve(import.meta.dirname, '../../../../Kenney Game Assets All-in-1 3.7.0');
const MODELS = path.join(ROOT, '3D assets/Marble Kit/Models/GLB format');
const tris = new Map<string, Triangles>();
const shapes = new Map<string, Shape>();
const triangles = (m: string) => {
  if (!tris.has(m)) {
    const b = fs.readFileSync(path.join(MODELS, `${m}.glb`));
    tris.set(m, readGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  return tris.get(m)!;
};
const shape = (m: string) => shapes.get(m) ?? shapes.set(m, { ports: findPorts(triangles(m)), ...bounds(triangles(m)) }).get(m)!;

export const SAMPLE = ['straight', 'drop', 'left', 'steep', 'helix-right', 'u-left', 'bump', 'wave', 'drop', 'jog-left', 'helix-left', 'gentle', 'funnel', 'finish'];

export async function roll(ids: string[], marbles = 3, verbose = true) {
  await initPhysics();
  const items = ids.map((id) => ITEMS.find((i) => i.id === id)!);
  const run = buildRun(items, shape);
  if (run.items.length < items.length && verbose) console.log(`only ${run.items.length} of ${items.length} items fit`);
  const ph = new RunPhysics();
  ph.setTrack(run.placed, triangles, shape);
  const results: { reached: number; of: number; how: string; secs: number }[] = [];
  for (let m = 0; m < marbles; m++) {
    const id = ph.addMarble(START.x, START.y + MARBLE_RADIUS + 0.02, START.z + 0.35, 0, -1.2 - m * 0.1);
    let furthest = 0;
    let still = 0;
    let how = 'timed out';
    let top = 0;
    let t = 0;
    for (; t < 60; t += STEP) {
      ph.step();
      const p = ph.marble(id)!.translation();
      const v = ph.marble(id)!.linvel();
      const inside = run.placed.findIndex((q) => p.x >= q.box.minX - 0.05 && p.x <= q.box.maxX + 0.05 && p.z >= q.box.minZ - 0.05 && p.z <= q.box.maxZ + 0.05 && p.y >= q.box.minY - 0.05 && p.y <= q.box.maxY + 0.3);
      furthest = Math.max(furthest, run.placed[inside]?.item ?? 0);
      if (p.y < 0.2) {
        how = furthest === run.items.length ? 'off the end' : `fell off after item ${furthest} (${run.items[furthest - 1]?.id ?? 'start'}) at ${p.x.toFixed(1)},${p.z.toFixed(1)}, top speed ${top.toFixed(1)}`;
        break;
      }
      top = Math.max(top, Math.hypot(v.x, v.y, v.z));
      if (Math.hypot(v.x, v.y, v.z) < 0.03) still += STEP; else still = 0;
      if (still > 1) { how = `stopped in item ${furthest} (${run.items[furthest - 1]?.id ?? 'start'})`; break; }
    }
    ph.removeMarble(id);
    results.push({ reached: furthest, of: run.items.length, how, secs: t });
    if (verbose) console.log(`marble ${m + 1}: reached item ${furthest}/${run.items.length} in ${t.toFixed(1)}s: ${how}`);
  }
  ph.free();
  return { results, run };
}

if (import.meta.main) await roll(process.argv.length > 2 ? process.argv.slice(2) : SAMPLE);
