/**
 * Drops pets with the game's own physics: each pet alone on the pedestal (it should land and
 * sit still, whichever way up), then bot towers with a little wobble in where they let go, to
 * see how tall a careful player's tower gets before something falls.
 *
 *   node games/pet-stack/scripts/check-stack.ts [towers]
 */
import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { readGlbParts } from '../../../shared/glb.ts';
import { PETS } from '../src/pets.ts';
import { DROP_GAP, FEEL, STEP, Stack, extent, shapeOf, type PetShape } from '../src/stack.ts';

const TOWERS = Number(process.argv[2] ?? 20);
const NOISE = Number(process.env.NOISE ?? 0.2);
// FEEL=angularDamping=2,friction=0.8 tries other physics.
for (const kv of (process.env.FEEL ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  (FEEL as Record<string, number>)[k] = Number(v);
}
const DIR = new URL('../../../../Kenney Game Assets All-in-1 3.7.0/3D assets/Cube Pets/Models/GLB format/', import.meta.url);
const shapes: Record<string, PetShape> = {};
for (const pet of PETS) {
  const b = readFileSync(new URL(`animal-${pet}.glb`, DIR));
  shapes[pet] = shapeOf(readGlbParts(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
}

await RAPIER.init();
let failed = false;

const run = (stack: Stack, seconds: number, until?: () => boolean) => {
  for (let t = 0; t < seconds; t += STEP) {
    stack.step();
    if (until?.()) return t;
  }
  return seconds;
};

console.log('Alone on the pedestal (height in cm at each quarter turn; ! = rolled or never settled):');
for (const pet of PETS) {
  const row: string[] = [];
  for (const q of [0, 1, 2, 3]) {
    const stack = new Stack(shapes);
    const angle = (q * Math.PI) / 2;
    const p = stack.drop(pet, 0, DROP_GAP - extent(shapes[pet], angle).minY, angle);
    const t = run(stack, 4, () => stack.settled());
    const ok = p.state === 'landed' && stack.settled();
    // Upright, every pet must sit still; other ways up some are meant to roll.
    if (!ok && q === 0) failed = true;
    row.push(`${(stack.height() * 10).toFixed(0).padStart(3)}${ok ? '' : '!'}${t > 2 ? '(slow)' : ''}`);
  }
  console.log(`  ${pet.padEnd(12)} ${shapes[pet].parts.length} parts  ${row.join('  ')}`);
}

// Bot towers. The careful bot tries each quarter turn at a few spots over the top pet, looks
// ahead to see which stands steadiest, and drops that, a little off where it meant to.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const settle = (stack: Stack) => run(stack, 6, () => stack.settled());

function choose(stack: Stack, pet: string) {
  const top = stack.pets.filter((p) => p.state === 'landed').sort((a, b) => stack.top(b) - stack.top(a))[0];
  const over = top ? top.body.translation().x : 0;
  let best = { score: -Infinity, x: 0, angle: 0 };
  for (const q of [0, 1, 2, 3]) {
    const angle = (q * Math.PI) / 2;
    const e = extent(shapes[pet], angle);
    for (const dx of [-0.3, -0.15, 0, 0.15, 0.3]) {
      const x = over + dx - (e.minX + e.maxX) / 2;
      const trial = stack.clone();
      trial.drop(pet, x, trial.height() + DROP_GAP - e.minY, angle);
      settle(trial);
      if (trial.pets.some((p) => p.state === 'fallen')) continue;
      const score = -Math.max(...trial.pets.map((p) => trial.lean(p))) - 0.02 * q - 0.05 * Math.abs(dx);
      if (score > best.score) best = { score, x, angle };
    }
  }
  return best;
}

const counts: number[] = [];
const heights: number[] = [];
for (let n = 0; n < (process.env.LAZY_ONLY ? 0 : TOWERS); n++) {
  const stack = new Stack(shapes);
  let placed = 0;
  let best = 0;
  for (let i = 0; i < 40; i++) {
    const pet = PETS[Math.floor(rand() * PETS.length)];
    const pick = choose(stack, pet);
    const e = extent(shapes[pet], pick.angle);
    stack.drop(pet, pick.x + (rand() - 0.5) * NOISE, stack.height() + DROP_GAP - e.minY, pick.angle);
    settle(stack);
    if (stack.pets.some((p) => p.state === 'fallen')) break;
    placed++;
    best = Math.max(best, stack.height());
  }
  counts.push(placed);
  heights.push(best * 10);
  process.stdout.write(`${placed} `);
}
// The lazy bot drops every pet in the middle the way up it comes (as in the game, any way up).
const lazy: number[] = [];
for (let n = 0; n < TOWERS; n++) {
  const stack = new Stack(shapes);
  let placed = 0;
  for (let i = 0; i < 40; i++) {
    const pet = PETS[Math.floor(rand() * PETS.length)];
    const angle = (Math.floor(rand() * 4) * Math.PI) / 2;
    stack.drop(pet, 0, stack.height() + DROP_GAP - extent(shapes[pet], angle).minY, angle);
    settle(stack);
    if (stack.pets.some((p) => p.state === 'fallen')) break;
    placed++;
  }
  lazy.push(placed);
}
lazy.sort((a, b) => a - b);
counts.sort((a, b) => a - b);
heights.sort((a, b) => a - b);
const median = (a: number[]) => a[Math.floor(a.length / 2)];
if (counts.length) console.log(`\nBot towers (${TOWERS}): pets before the first fall: median ${median(counts)}, range ${counts[0]}–${counts.at(-1)}; height median ${median(heights).toFixed(0)}cm, best ${heights.at(-1)!.toFixed(0)}cm`);
console.log(`Lazy towers (${TOWERS}, every pet dropped in the middle as it comes): median ${median(lazy)}, range ${lazy[0]}–${lazy.at(-1)}`);
if (failed) {
  console.log('Some pet would not sit still upright on its own.');
  process.exit(1);
}
