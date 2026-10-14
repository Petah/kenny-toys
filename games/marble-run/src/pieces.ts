import type { Item, Part } from './track.ts';

/**
 * The palette. Each item is one or more pieces in a row; `enter` and `exit` say which ports the
 * marble uses (see ports.ts). Turns are from the marble's point of view, and
 * scripts/check-pieces.ts prints what each item really does, so the labels stay honest.
 */
const one = (model: string, enter: Part['enter'], exit: Part['exit']): Part[] => [{ model, enter, exit }];

/** A slope down, built from the kit's three ramp parts so it eases in and out of the drop. */
const drop = (grade: 'a' | 'b' | 'c'): Part[] => [
  { model: `ramp-end-solid-${grade}`, enter: 's', exit: 'n' },
  { model: `ramp-long-solid-${grade}`, enter: 's', exit: 'n' },
  { model: `ramp-start-solid-${grade}`, enter: 's', exit: 'n' },
];

export const ITEMS: Item[] = [
  { id: 'straight', label: 'Straight', parts: one('straight', 's', 'n') },
  { id: 'left', label: 'Left', parts: one('curve-solid', 'w', 'n') },
  { id: 'right', label: 'Right', parts: one('curve-solid', 'n', 'w') },
  { id: 'wide-left', label: 'Wide left', parts: one('curve-solid-large', 'w', 'n') },
  { id: 'wide-right', label: 'Wide right', parts: one('curve-solid-large', 'n', 'w') },
  { id: 'drop', label: 'Drop', parts: drop('b') },
  { id: 'steep', label: 'Steep drop', parts: drop('c') },
  { id: 'gentle', label: 'Gentle drop', parts: drop('a') },
  // The kit names helixes by their handedness, which is the opposite of the way the marble turns.
  { id: 'helix-left', label: 'Spiral left', parts: one('helix-quarter-right', 'high', 'low') },
  { id: 'helix-right', label: 'Spiral right', parts: one('helix-quarter-left', 'high', 'low') },
  { id: 'u-left', label: 'U-turn left', parts: one('helix-half-right', 'high', 'low') },
  { id: 'u-right', label: 'U-turn right', parts: one('helix-half-left', 'high', 'low') },
  { id: 'bump', label: 'Bump', parts: one('bump-solid-a', 's', 'n') },
  { id: 'wave', label: 'Wiggle', parts: one('wave-solid-b', 's', 'n') },
  { id: 'jog-left', label: 'Jog left', parts: one('s-curve-left', 's', 'n') },
  { id: 'jog-right', label: 'Jog right', parts: one('s-curve-right', 's', 'n') },
  { id: 'funnel', label: 'Funnel', parts: one('funnel', 's', 'n') },
  { id: 'finish', label: 'Finish', parts: one('end-hole-rounded', 'n', null) },
];

/** Models that are drawn but not built from the palette. */
export const EXTRA_MODELS = ['end-rounded', 'marble-high', 'support-color-single-bottom', 'support-color-single-middle', 'tree', 'tree-tall', 'tree-large'];
export const ALL_MODELS = [...new Set([...ITEMS.flatMap((i) => i.parts.map((p) => p.model)), ...EXTRA_MODELS])];
