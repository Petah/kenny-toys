/**
 * Prints what every palette item does when snapped onto a track heading north: which way it
 * turns, how far it drops and how far it moves the end of the track. Use it to keep the
 * palette's labels honest after changing pieces.ts.
 *
 *   node games/marble-run/scripts/check-pieces.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { readGlb } from '../../../shared/glb.ts';
import { ITEMS } from '../src/pieces.ts';
import { bounds, findPorts } from '../src/ports.ts';
import { tryItem, type Head, type Shape } from '../src/track.ts';

const ROOT = process.env.KENNEY_ROOT ?? path.resolve(import.meta.dirname, '../../../../Kenney Game Assets All-in-1 3.7.0');
const MODELS = path.join(ROOT, '3D assets/Marble Kit/Models/GLB format');

export function loadShape(model: string): Shape {
  const b = fs.readFileSync(path.join(MODELS, `${model}.glb`));
  const tri = readGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return { ports: findPorts(tri), ...bounds(tri) };
}

const cache = new Map<string, Shape>();
const shapes = (m: string) => cache.get(m) ?? cache.set(m, loadShape(m)).get(m)!;

if (import.meta.main) {
  const head: Head = { x: 0, y: 5, z: 0, dx: 0, dz: -1 };
  const names: Record<string, string> = { '0,-1': 'north', '1,0': 'east', '0,1': 'south', '-1,0': 'west' };
  for (const item of ITEMS) {
    const r = tryItem(item, head, [], shapes, 1);
    if (!r.ok) {
      console.log(`${item.label.padEnd(14)} FAILED: ${r.reason}`);
      continue;
    }
    const end = r.head;
    const way = end ? names[`${end.dx},${end.dz}`] : 'end of the run';
    const turn = !end ? '' : way === 'north' ? 'straight on' : way === 'west' ? 'turns left' : way === 'east' ? 'turns right' : 'U-turn';
    const move = end ? `moves (${(end.x - head.x).toFixed(2)}, ${(end.z - head.z).toFixed(2)}), drops ${(head.y - end.y).toFixed(2)}` : '';
    console.log(`${item.label.padEnd(14)} ${r.placed.length} piece(s)  heading ${way.padEnd(6)} ${turn.padEnd(12)} ${move}`);
  }
}
