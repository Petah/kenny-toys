import { levelProgress } from '@shared/progress';

/** Stars collected and best time (in tenths of a second) per level. */
const progress = levelProgress('tilt-maze', 'lower');

export const loadProgress = progress.load;
export const isUnlocked = progress.isUnlocked;
export const recordClear = progress.recordClear;
