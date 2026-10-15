/**
 * Checks the letter mix gives players enough to work with: fills boards the way the game does
 * and counts the words on them, then plays games with a simple bot (it plays the longest word on
 * the board every few drops) to see how the board holds up as it fills.
 *
 *   node games/word-drop/scripts/check-board.ts
 */
import { readFileSync } from 'node:fs';
import { COLS, Dictionary, Well } from '../src/board.ts';

const dict = new Dictionary(readFileSync(new URL('../src/words.txt', import.meta.url), 'utf8'));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = 200;
const counts: number[] = [];
const longest: number[] = [];
let t0 = performance.now();
for (let seed = 1; seed <= SEEDS; seed++) {
  const well = new Well(rng(seed));
  well.fill(4);
  const words = well.words(dict);
  counts.push(words.length);
  longest.push(words[0]?.word.length ?? 0);
}
const ms = (performance.now() - t0) / SEEDS;
counts.sort((a, b) => a - b);
const pct = (p: number) => counts[Math.floor((counts.length - 1) * p)];
console.log(`starting boards (4 rows): words min ${counts[0]}, 10% ${pct(0.1)}, median ${pct(0.5)}; longest word median ${longest.sort((a, b) => a - b)[SEEDS >> 1]} letters; solver ${ms.toFixed(1)}ms a board`);

// Bot games: a tile drops each step; every `every` drops the bot plays its longest word.
for (const every of [3, 4, 5]) {
  const lasted: number[] = [];
  let dry = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed * 31);
    const well = new Well(rand);
    well.fill(4);
    let step = 0;
    for (; step < 400; step++) {
      const col = Math.floor(rand() * COLS);
      if (!well.hasRoom(col)) break;
      well.drop(col, well.make());
      if (step % every === 0) {
        const best = well.words(dict, 400)[0];
        if (best) well.clear(best.path, best.word);
        else dry++;
      }
    }
    lasted.push(step);
  }
  lasted.sort((a, b) => a - b);
  console.log(`bot playing every ${every} drops: lasted min ${lasted[0]}, median ${lasted[20]} drops; ${dry} turns with no word`);
}
