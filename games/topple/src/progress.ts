import { levelProgress } from '@shared/progress';

const progress = levelProgress('topple', 'higher');

export const loadProgress = progress.load;
export const isUnlocked = progress.isUnlocked;
export const recordClear = progress.recordClear;
