import { kenney } from '@shared/kenney';

const PACK = '2D assets/Monster Builder Pack/Spritesheet';
export const ATLAS = { key: 'monster', image: kenney(`${PACK}/spritesheet_double.png`), xml: kenney(`${PACK}/spritesheet_double.xml`) };

const GOOGLY = '2D assets/Googly Eyes';
export const GOOGLY_LAYERS = { white: kenney(`${GOOGLY}/Layers/0.png`), pupil: kenney(`${GOOGLY}/Layers/1.png`), shine: kenney(`${GOOGLY}/Layers/2.png`) };
export const GOOGLY_THUMB = kenney(`${GOOGLY}/PNG/googly-a.png`);

/** The double-resolution atlas is 2× the pack's nominal pixel sizes. */
export const ATLAS_RES = 2;

export const COLORS = ['blue', 'dark', 'green', 'red', 'white', 'yellow'] as const;

export type Category = 'body' | 'eyes' | 'googly' | 'face' | 'arms' | 'legs' | 'extras';

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'body', label: 'Bodies' },
  { id: 'eyes', label: 'Eyes' },
  { id: 'googly', label: 'Googly' },
  { id: 'face', label: 'Mouths' },
  { id: 'arms', label: 'Arms' },
  { id: 'legs', label: 'Legs' },
  { id: 'extras', label: 'Horns & Ears' },
];

/** Googly eyes aren't atlas frames; their "frame" is a size, as nominal diameter in pack pixels. */
export const GOOGLY_SIZES = { 'googly:s': 36, 'googly:m': 56, 'googly:l': 84 } as const;
export type GooglySize = keyof typeof GOOGLY_SIZES;

export function categorize(frame: string): Category | undefined {
  if (frame.startsWith('googly:')) return 'googly';
  if (frame.startsWith('body_')) return 'body';
  if (frame.startsWith('arm_')) return 'arms';
  if (frame.startsWith('leg_')) return 'legs';
  if (frame.startsWith('eye')) return 'eyes'; // eyes and eyebrows
  if (frame.startsWith('mouth') || frame.startsWith('nose_') || frame.startsWith('snot_')) return 'face';
  if (frame.startsWith('detail_')) return 'extras';
  return undefined;
}

/** Whether a part sits behind the body (limbs, horns) or in front of it (face). */
export function layerOf(category: Category): 'back' | 'body' | 'front' {
  if (category === 'body') return 'body';
  if (category === 'arms' || category === 'legs' || category === 'extras') return 'back';
  return 'front';
}

/** Eyes that look odd blinking (already closed, crosses, stalks). */
export function canBlink(frame: string): boolean {
  return frame.startsWith('eye_') && !frame.startsWith('eye_closed') && !frame.startsWith('eye_dead');
}
