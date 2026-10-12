/**
 * Per-browser persistence for small things like high scores. Storage can be blocked
 * (private windows, previews), so every access is guarded and falls back to defaults.
 */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`kenney-toys:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T) {
  try {
    localStorage.setItem(`kenney-toys:${key}`, JSON.stringify(value));
  } catch {
    // Not persisting is fine.
  }
}

/** Records a score and returns the previous best, so callers can celebrate a new record. */
export function submitHighScore(game: string, score: number): { best: number; isNew: boolean } {
  const previous = load(`${game}:best`, 0);
  if (score > previous) save(`${game}:best`, score);
  return { best: Math.max(score, previous), isNew: score > previous };
}
