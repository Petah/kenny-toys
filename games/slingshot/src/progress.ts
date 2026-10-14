import { levelProgress } from '@shared/progress';

/** Stars collected and fewest launches per level. */
const progress = levelProgress('slingshot', 'lower');

export const loadProgress = progress.load;
export const isUnlocked = progress.isUnlocked;
export const recordClear = progress.recordClear;
