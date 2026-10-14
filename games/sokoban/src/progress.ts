import { levelProgress } from '@shared/progress';
import type { Level } from './levels';

const progress = levelProgress('sokoban', 'lower');

export const loadProgress = progress.load;
export const isUnlocked = progress.isUnlocked;
export const recordClear = progress.recordClear;

/** Coins for a clear: three at par, two within half as many moves again, one for finishing. */
export function coinsFor(level: Level, moves: number) {
  if (moves <= level.par) return 3;
  if (moves <= Math.ceil(level.par * 1.5)) return 2;
  return 1;
}
