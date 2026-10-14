/**
 * Checks every hole: the tiles join up, and the real physics can sink the ball within par.
 *
 *   node games/minigolf/scripts/check-holes.ts [hole numbers, e.g. 3,7]
 *
 * From the tee it tries putts in many directions and strengths, keeps the few that end up
 * closest to the cup (by walking distance along the course), and searches again from each,
 * like a cautious golfer. It reports the fewest strokes it found; a hole fails if that's over par.
 * Needs the Kenney bundle next to the repo, or KENNEY_ROOT.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOLES } from '../src/holes.ts';
import { checkCourse, parseCourse, turnSide, type Course, type Side } from '../src/course.ts';
import { readGlb } from '../src/glb.ts';
import { CoursePhysics, initPhysics } from '../src/physics.ts';

const ROOT = process.env.KENNEY_ROOT ?? path.resolve(import.meta.dirname, '../../../../Kenney Game Assets All-in-1 3.7.0');
const MODELS = path.join(ROOT, '3D assets/Minigolf Kit/Models/GLB format');
const DIRECTIONS = 72;
const POWERS = [0.06, 0.1, 0.15, 0.22, 0.3, 0.4, 0.52, 0.66, 0.82, 1];
const BEAM = 5;

const meshes = (model: string, skip: string[] = []) => {
  const b = fs.readFileSync(path.join(MODELS, `${model}.glb`));
  return readGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), skip);
};

/** Walking distance in tiles from each tile to the cup's tile, through open sides. */
function distances(course: Course) {
  const at = new Map(course.tiles.map((t) => [`${t.col},${t.row}`, t]));
  const STEP: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const opens = (t: Course['tiles'][number]) => new Set(t.def.open.map((s) => turnSide(s, t.turns)));
  const dist = new Map([[course.cup, 0]]);
  const queue = [course.cup];
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    for (const side of opens(t)) {
      const n = at.get(`${t.col + STEP[side][0]},${t.row + STEP[side][1]}`);
      if (n && !dist.has(n) && opens(n).has(((side + 2) % 4) as Side)) {
        dist.set(n, dist.get(t)! + 1);
        queue.push(n);
      }
    }
  }
  return (x: number, z: number) => {
    const t = at.get(`${Math.round(x)},${Math.round(z)}`);
    const tiles = t ? (dist.get(t) ?? 99) : 99;
    // Within a tile, prefer being nearer the cup in a straight line.
    return tiles + Math.hypot(x - course.cup.x, z - course.cup.z) * 0.01;
  };
}

/** Plays one putt from a spot and says where it ended up. */
function putt(ph: CoursePhysics, from: { x: number; y: number; z: number }, angle: number, power: number) {
  ph.place(from.x, from.y, from.z);
  ph.putt(Math.sin(angle), -Math.cos(angle), power);
  for (let i = 0; i < 240 * 20; i++) {
    for (const e of ph.step()) {
      if (e.kind === 'sunk') return { sunk: true, at: from };
      if (e.kind === 'out') return { sunk: false, at: null };
      if (e.kind === 'stopped') return { sunk: false, at: { ...ph.position } };
    }
  }
  return { sunk: false, at: null };
}

function search(ph: CoursePhysics, course: Course, maxStrokes: number) {
  const score = distances(course);
  let frontier = [{ ...ph.tee }];
  for (let stroke = 1; stroke <= maxStrokes; stroke++) {
    const results: { at: { x: number; y: number; z: number }; d: number }[] = [];
    for (const from of frontier) {
      for (let a = 0; a < DIRECTIONS; a++) {
        for (const power of POWERS) {
          const r = putt(ph, from, (a / DIRECTIONS) * Math.PI * 2, power);
          if (r.sunk) return stroke;
          if (r.at) results.push({ at: r.at, d: score(r.at.x, r.at.z) });
        }
      }
    }
    // Keep the best few spots, spread out so they aren't all the same place.
    results.sort((a, b) => a.d - b.d);
    frontier = [];
    for (const r of results) {
      if (frontier.every((f) => Math.hypot(f.x - r.at.x, f.z - r.at.z) > 0.08)) frontier.push(r.at);
      if (frontier.length >= BEAM) break;
    }
  }
  return null;
}

await initPhysics();
const only = process.argv[2]?.split(',').map(Number);
let failed = false;
for (const [i, hole] of HOLES.entries()) {
  if (only && !only.includes(i + 1)) continue;
  const label = `${String(i + 1).padStart(2)}. ${hole.name.padEnd(14)} par ${hole.par}`;
  const course = parseCourse(hole.rows);
  const problems = checkCourse(course);
  if (problems.length) {
    failed = true;
    console.log(`${label}  ${problems.join('; ')}`);
    continue;
  }
  const ph = new CoursePhysics(course, meshes);
  const started = Date.now();
  const best = search(ph, course, hole.par + 1);
  ph.free();
  const verdict = best === null ? `NOT SUNK within ${hole.par + 1}` : best > hole.par ? `best ${best}, OVER PAR` : `best ${best}${best === 1 ? ' (hole in one possible)' : ''}`;
  if (best === null || best > hole.par) failed = true;
  console.log(`${label}  ${verdict}  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
}
process.exit(failed ? 1 : 0);
