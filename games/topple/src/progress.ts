import { load, save } from '@shared/storage';

const KEY = 'topple:progress';

interface Progress {
  /** Best stars per level index (0 = not cleared). */
  stars: number[];
  best: number[];
}

export function loadProgress(): Progress {
  const p = load<Partial<Progress>>(KEY, {});
  return { stars: Array.isArray(p.stars) ? p.stars : [], best: Array.isArray(p.best) ? p.best : [] };
}

export function isUnlocked(level: number) {
  return level === 0 || (loadProgress().stars[level - 1] ?? 0) > 0;
}

/** Saves a cleared level and reports whether the score beat the previous best. */
export function recordClear(level: number, score: number, stars: number) {
  const p = loadProgress();
  const previous = p.best[level] ?? 0;
  p.best[level] = Math.max(previous, score);
  p.stars[level] = Math.max(p.stars[level] ?? 0, stars);
  save(KEY, p);
  return { best: p.best[level], isNew: score > previous && previous > 0 };
}
