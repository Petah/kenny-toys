import { load, save } from './storage';

export interface LevelProgress {
  /** Best stars per level index (0 = not cleared). */
  stars: number[];
  /** Best score per level index (0 = none yet). */
  best: number[];
}

/**
 * Per-level stars and best scores for a game with a level select, where clearing a level
 * unlocks the next. `better` says which way scores improve: points go up, moves go down.
 */
export function levelProgress(game: string, better: 'higher' | 'lower') {
  const key = `${game}:progress`;
  const improves = (score: number, previous: number) => previous === 0 || (better === 'higher' ? score > previous : score < previous);

  function loadProgress(): LevelProgress {
    const p = load<Partial<LevelProgress>>(key, {});
    return { stars: Array.isArray(p.stars) ? p.stars : [], best: Array.isArray(p.best) ? p.best : [] };
  }

  return {
    load: loadProgress,

    /** A level opens once the one before it is cleared. A best score counts, since some games clear with no stars. */
    isUnlocked(level: number) {
      const p = loadProgress();
      return level === 0 || (p.stars[level - 1] ?? 0) > 0 || (p.best[level - 1] ?? 0) > 0;
    },

    /** Saves a cleared level and reports whether the score beat a previous best. */
    recordClear(level: number, score: number, stars: number) {
      const p = loadProgress();
      const previous = p.best[level] ?? 0;
      const isNew = previous > 0 && improves(score, previous);
      if (improves(score, previous)) p.best[level] = score;
      p.stars[level] = Math.max(p.stars[level] ?? 0, stars);
      save(key, p);
      return { best: p.best[level], isNew };
    },
  };
}
