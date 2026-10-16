/**
 * Fires thousands of kicks at keepers of each skill and prints how often each kind of shot
 * scores, to tune the keeper and the kick's rise: corners should mostly go in, the middle mostly
 * get saved, and a full-power blast should often fly over.
 *
 *   node games/spot-kick/scripts/check-shots.ts
 */
import { cpuKick, flightOf, judge, keeperGuess, stepKeeper, wobble, type Kick, type Result } from '../src/shot.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(7);

function shoot(kick: Kick, skill: number): Result {
  const f = flightOf(wobble(kick, rand));
  const k = keeperGuess(f, skill, rand);
  for (let t = 0; t < f.time; t += 1 / 120) stepKeeper(k, 1 / 120);
  return judge(f, k);
}

const kinds: [string, () => Kick][] = [
  ['corner, firm', () => ({ aimX: (rand() < 0.5 ? -1 : 1) * (2.8 + rand() * 0.6), power: 0.45 + rand() * 0.25 })],
  ['side, firm', () => ({ aimX: (rand() < 0.5 ? -1 : 1) * (1.4 + rand() * 0.8), power: 0.45 + rand() * 0.25 })],
  ['middle', () => ({ aimX: (rand() - 0.5) * 1.2, power: 0.4 + rand() * 0.4 })],
  ['blasted', () => ({ aimX: (rand() - 0.5) * 6, power: 0.9 + rand() * 0.1 })],
  ['soft', () => ({ aimX: (rand() - 0.5) * 6, power: rand() * 0.25 })],
];
for (const skill of [0.2, 0.5, 0.8]) {
  console.log(`keeper skill ${skill}`);
  for (const [name, make] of kinds) {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const r = shoot(make(), skill);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    const pct = (r: string) => `${Math.round(((counts[r] ?? 0) / 40))}%`.padStart(4);
    console.log(`  ${name.padEnd(13)} goal ${pct('goal')} saved ${pct('saved')} post ${pct('post')} wide ${pct('wide')} over ${pct('over')}`);
  }
}
// The computer's kicks against a player who guesses a side at random half the time.
for (const skill of [0.2, 0.5, 0.8]) {
  let goals = 0;
  for (let i = 0; i < 4000; i++) {
    const f = flightOf(cpuKick(skill, rand));
    // Reads it a third of the time, otherwise guesses.
    const guess = rand() < 0.33 ? f.x + (rand() - 0.5) * 2 : [-2.4, 0, 2.4][Math.floor(rand() * 3)];
    const k = { x: 0, target: guess, wait: 0, diving: false };
    for (let t = 0; t < f.time + 0.6; t += 1 / 120) stepKeeper(k, 1 / 120);
    if (judge(f, k) === 'goal') goals++;
  }
  console.log(`cpu kicker skill ${skill}: scores ${Math.round(goals / 40)}% against a guesser`);
}
