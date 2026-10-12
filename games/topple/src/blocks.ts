import type * as Phaser from 'phaser';
/** Materials and shapes from the Physics Assets pack, and how each behaves. */

export type Material = 'wood' | 'stone' | 'glass' | 'metal' | 'tnt';
export type Shape = 'sq' | 'bar' | 'long' | 'post' | 'tall' | 'big' | 'ball' | 'ramp' | 'roof';

/** Everything in the world is drawn at this fraction of the pack's 70px grid. */
export const SCALE = 0.6;

export interface MaterialDef {
  /** Frame name prefix inside the elements atlas. */
  prefix: string;
  density: number;
  friction: number;
  restitution: number;
  /** Damage it takes before breaking; see LevelScene.damage for the formula. */
  hp: number;
  points: number;
  /** Debris frames from the debris atlas and an optional tint for materials without their own. */
  debris: 'Wood' | 'Stone' | 'Glass';
  debrisTint?: number;
  /** Colour of the floating score text. */
  color: string;
}

export const MATERIALS: Record<Material, MaterialDef> = {
  glass: { prefix: 'elementGlass', density: 0.0012, friction: 0.4, restitution: 0.05, hp: 5, points: 100, debris: 'Glass', color: '#c9f3ff' },
  wood: { prefix: 'elementWood', density: 0.0016, friction: 0.8, restitution: 0.02, hp: 14, points: 200, debris: 'Wood', color: '#ffcf8a' },
  stone: { prefix: 'elementStone', density: 0.0035, friction: 0.9, restitution: 0, hp: 34, points: 300, debris: 'Stone', color: '#e3edf0' },
  metal: { prefix: 'elementMetal', density: 0.005, friction: 0.7, restitution: 0.05, hp: 90, points: 500, debris: 'Stone', debrisTint: 0xb8c4cc, color: '#e3edf0' },
  tnt: { prefix: 'elementExplosive', density: 0.0016, friction: 0.7, restitution: 0.02, hp: 4, points: 250, debris: 'Stone', debrisTint: 0xffd23f, color: '#ffd23f' },
};

/**
 * Frame numbers for [intact, chipped, cracked] of each shape. The pack numbers every material's
 * frames differently, so these were read off the atlases (metal and explosive share a layout).
 */
type FrameTable = Record<Shape, [number, number, number]>;
const METALLIC: FrameTable = {
  sq: [11, 14, 49], bar: [12, 15, 50], long: [13, 16, 51], post: [17, 22, 52], tall: [20, 25, 55],
  big: [18, 23, 53], ball: [1, 7, 45], ramp: [57, 5, 43], roof: [0, 6, 44],
};
const FRAMES: Record<Material, FrameTable> = {
  wood: {
    sq: [10, 13, 45], bar: [11, 14, 46], long: [12, 15, 47], post: [16, 21, 48], tall: [19, 24, 51],
    big: [17, 22, 49], ball: [0, 6, 44], ramp: [53, 4, 42], roof: [54, 5, 43],
  },
  stone: {
    sq: [11, 14, 46], bar: [12, 15, 47], long: [13, 16, 48], post: [17, 22, 49], tall: [20, 25, 52],
    big: [18, 23, 50], ball: [1, 7, 45], ramp: [54, 5, 43], roof: [0, 6, 44],
  },
  glass: {
    sq: [12, 15, 47], bar: [13, 16, 48], long: [14, 17, 49], post: [18, 23, 50], tall: [21, 26, 53],
    big: [19, 24, 51], ball: [2, 8, 46], ramp: [0, 6, 44], roof: [1, 7, 45],
  },
  metal: METALLIC,
  tnt: METALLIC,
};

/** Unscaled pixel size of each shape in the atlas. */
export const SHAPE_SIZE: Record<Shape, { w: number; h: number }> = {
  sq: { w: 70, h: 70 },
  bar: { w: 140, h: 70 },
  long: { w: 220, h: 70 },
  post: { w: 70, h: 140 },
  tall: { w: 70, h: 220 },
  big: { w: 140, h: 140 },
  ball: { w: 70, h: 70 },
  ramp: { w: 70, h: 70 },
  roof: { w: 140, h: 70 },
};

export function frameFor(material: Material, shape: Shape, damage: 0 | 1 | 2) {
  return `${MATERIALS[material].prefix}${String(FRAMES[material][shape][damage]).padStart(3, '0')}.png`;
}

/** Matter body shape for a block, in unscaled atlas pixels (the game object's scale is applied after). */
export function bodyShape(shape: Shape, flip = false): Phaser.Types.Physics.Matter.MatterSetBodyConfig | undefined {
  if (shape === 'ball') return { type: 'circle', radius: 34 };
  // Right angle at the bottom left, matching the art (bottom right when mirrored).
  if (shape === 'ramp') return { type: 'fromVerts', verts: flip ? '70 0 70 70 0 70' : '0 0 70 70 0 70' };
  if (shape === 'roof') return { type: 'fromVerts', verts: '70 0 140 70 0 70' };
  return undefined;
}
