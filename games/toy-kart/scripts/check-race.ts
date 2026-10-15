/**
 * Races computer cars round every circuit with the game's own physics and driver, and reports
 * lap times, how often each fell off and whether anyone got stuck. A circuit the computer can't
 * lap cleanly needs reshaping (or the handling needs work).
 *
 *   node games/toy-kart/scripts/check-race.ts [laps] [--trace]
 */
import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { readGlb, type Triangles } from '../../../shared/glb.ts';
import { drive, lineYaw, nearest } from '../src/ai.ts';
import { RacePhysics, STEP, TOP_SPEED, yawOf } from '../src/physics.ts';
import { CIRCUITS, build } from '../src/track.ts';

const LAPS = Number(process.argv[2] ?? 2);
const trace = process.argv.includes('--trace');
const DIR = new URL('../../../../Kenney Game Assets All-in-1 3.7.0/3D assets/Toy Car Kit/Models/GLB format/', import.meta.url);
const cache = new Map<string, Triangles>();
const triangles = (model: string) => {
  if (!cache.has(model)) {
    const b = readFileSync(new URL(`${model}.glb`, DIR));
    cache.set(model, readGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  return cache.get(model)!;
};

await RAPIER.init();
let failed = false;
for (const circuit of CIRCUITS) {
  const built = build(circuit);
  const physics = new RacePhysics(built, triangles);
  const n = built.line.length;
  const drivers = [-0.5, 0.5, -0.2, 0.2].map((lane, i) => ({ lane, skill: 1 - i * 0.04 }));
  const racers = drivers.map((d, i) => {
    // A grid behind the line: two by two.
    const back = 2 + Math.floor(i / 2) * 1.2;
    const at = (n - Math.round(back / 0.25)) % n;
    const p = built.line[at];
    const yaw = lineYaw(built, at);
    const side = i % 2 ? 0.45 : -0.45;
    const car = physics.addCar(p.x - Math.cos(yaw) * side, p.y, p.z + Math.sin(yaw) * side, yaw);
    return { d, car, index: at, progress: at - n, laps: [] as number[], lapStart: 0, falls: 0, stuck: 0 };
  });
  const maxTime = LAPS * (built.length / 3) + 20;
  let t = 0;
  for (; t < maxTime; t += STEP) {
    for (const r of racers) {
      const p = r.car.body.translation();
      const near = nearest(built, p.x, p.y, p.z, r.index);
      // Progress counts up continuously across the start line.
      let step = near.index - r.index;
      if (step < -n / 2) step += n;
      if (step > n / 2) step -= n;
      r.progress += step;
      r.index = near.index;
      if (r.progress >= (r.laps.length + 1) * n) {
        r.laps.push(t - r.lapStart);
        r.lapStart = t;
      }
      r.car.controls = drive(built, r.d, r.index, p.x, p.z, yawOf(r.car.body), r.car.speed, TOP_SPEED * r.car.power);
      // Off the track: back on at the nearest point of the line.
      if (r.car.onFloor || r.car.airTime > 2 || near.off > 2.5) {
        r.falls++;
        const q = built.line[r.index];
        physics.reset(r.car, q.x, q.y, q.z, lineYaw(built, r.index));
      }
      r.stuck = Math.abs(r.car.speed) < 0.3 ? r.stuck + STEP : 0;
    }
    physics.step();
    if (trace && Math.round(t / STEP) % 60 === 0) {
      const r = racers[0];
      const p = r.car.body.translation();
      console.log(`t ${t.toFixed(1)} pos ${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)} v ${r.car.speed.toFixed(1)} idx ${r.index} grounded ${r.car.grounded}`);
    }
    if (racers.every((r) => r.laps.length >= LAPS)) break;
  }
  const ok = racers.every((r) => r.laps.length >= LAPS);
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${circuit.name} (${built.length.toFixed(0)} long)`);
  for (const r of racers) {
    console.log(`     lane ${r.d.lane.toFixed(1)} skill ${r.d.skill.toFixed(2)}: laps ${r.laps.map((l) => l.toFixed(2)).join(' ') || '-'}  falls ${r.falls}${r.laps.length < LAPS ? `  stopped at ${((100 * (r.progress % n)) / n).toFixed(0)}%` : ''}`);
  }
  physics.free();
}
process.exit(failed ? 1 : 0);
