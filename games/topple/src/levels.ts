import { SCALE, SHAPE_SIZE, type Material, type Shape } from './blocks';

/** A block in a level. `x` is its centre and `y` its bottom edge, in pixels above the ground. */
export interface BlockSpec {
  m: Material;
  s: Shape;
  x: number;
  y: number;
  /** Mirror horizontally (for ramps facing the other way). */
  flip?: boolean;
}

export type AlienColor = 'Beige' | 'Blue' | 'Green' | 'Pink' | 'Yellow';

export interface CreatureSpec {
  x: number;
  y: number;
  color: AlienColor;
  round?: boolean;
}

export type ShotKind = 'rock' | 'bomb';

export interface Level {
  name: string;
  backdrop: 'grass' | 'desert' | 'shroom' | 'land';
  shots: ShotKind[];
  blocks: BlockSpec[];
  creatures: CreatureSpec[];
}

/** Height of a shape once scaled, for stacking. */
const h = (s: Shape) => SHAPE_SIZE[s].h * SCALE;
const POST = h('post'); // 84
const TALL = h('tall'); // 132
const SLAB = h('sq'); // 42

/** Two posts under a long beam, with room for one creature between them. Returns the blocks; it's POST (or TALL) + SLAB high. */
function hut(m: Material, x: number, y: number, opts: { beam?: Material; posts?: 'post' | 'tall' } = {}): BlockSpec[] {
  const posts = opts.posts ?? 'post';
  return [
    { m, s: posts, x: x - 45, y },
    { m, s: posts, x: x + 45, y },
    { m: opts.beam ?? m, s: 'long', x, y: y + h(posts) },
  ];
}

function column(m: Material, x: number, y: number, shapes: Shape[]): BlockSpec[] {
  let at = y;
  return shapes.map((s) => {
    const b = { m, s, x, y: at };
    at += h(s);
    return b;
  });
}

const HUT = POST + SLAB; // 126
const TALL_HUT = TALL + SLAB; // 174

export const LEVELS: Level[] = [
  {
    name: 'Hello there',
    backdrop: 'grass',
    shots: ['rock', 'rock', 'rock'],
    blocks: [...hut('wood', 900, 0), ...column('wood', 1090, 0, ['sq', 'sq'])],
    creatures: [
      { x: 900, y: 0, color: 'Green' },
      { x: 900, y: HUT, color: 'Pink', round: true },
      { x: 1090, y: SLAB * 2, color: 'Yellow' },
    ],
  },
  {
    name: 'Glass houses',
    backdrop: 'grass',
    shots: ['rock', 'rock', 'rock'],
    blocks: [
      ...hut('glass', 840, 0),
      ...hut('glass', 1020, 0),
      ...hut('glass', 1020, HUT),
      ...column('glass', 1170, 0, ['post', 'sq']),
    ],
    creatures: [
      { x: 840, y: 0, color: 'Blue' },
      { x: 1020, y: 0, color: 'Beige' },
      { x: 1020, y: HUT, color: 'Pink', round: true },
      { x: 1170, y: POST + SLAB, color: 'Green', round: true },
    ],
  },
  {
    name: 'The tower',
    backdrop: 'land',
    shots: ['rock', 'rock', 'rock'],
    blocks: [
      ...hut('wood', 960, 0),
      ...hut('wood', 960, HUT),
      ...hut('glass', 960, HUT * 2, { beam: 'wood' }),
      { m: 'wood', s: 'roof', x: 960, y: HUT * 3 },
      ...column('glass', 1130, 0, ['post']),
      { m: 'wood', s: 'ramp', x: 1031, y: 0 },
      { m: 'wood', s: 'ramp', x: 889, y: 0, flip: true },
    ],
    creatures: [
      { x: 960, y: 0, color: 'Yellow' },
      { x: 960, y: HUT, color: 'Green', round: true },
      { x: 960, y: HUT * 2, color: 'Blue' },
      { x: 1130, y: POST, color: 'Pink' },
    ],
  },
  {
    name: 'Stone wall',
    backdrop: 'desert',
    shots: ['rock', 'rock', 'rock'],
    blocks: [
      ...column('stone', 760, 0, ['tall']),
      ...column('stone', 802, 0, ['tall']),
      { m: 'stone', s: 'bar', x: 781, y: TALL },
      ...hut('wood', 1000, 0),
      { m: 'tnt', s: 'sq', x: 1110, y: 0 },
      { m: 'glass', s: 'bar', x: 1000, y: HUT },
      ...column('stone', 1190, 0, ['post', 'sq']),
    ],
    creatures: [
      { x: 781, y: TALL + SLAB, color: 'Beige', round: true },
      { x: 1000, y: 0, color: 'Green' },
      { x: 1110, y: SLAB, color: 'Pink' },
      { x: 1190, y: POST + SLAB, color: 'Yellow', round: true },
    ],
  },
  {
    name: 'Kaboom',
    backdrop: 'desert',
    shots: ['rock', 'bomb', 'rock'],
    blocks: [
      ...hut('stone', 860, 0),
      ...hut('stone', 1060, 0),
      { m: 'tnt', s: 'sq', x: 960, y: 0 },
      { m: 'tnt', s: 'sq', x: 960, y: SLAB },
      { m: 'glass', s: 'roof', x: 860, y: HUT },
      ...hut('wood', 1060, HUT),
    ],
    creatures: [
      { x: 860, y: 0, color: 'Blue' },
      { x: 1060, y: 0, color: 'Yellow' },
      { x: 1060, y: HUT, color: 'Green', round: true },
      { x: 1060, y: HUT * 2, color: 'Pink' },
    ],
  },
  {
    name: 'Pyramid',
    backdrop: 'shroom',
    shots: ['rock', 'rock', 'bomb', 'rock'],
    blocks: [
      { m: 'stone', s: 'ramp', x: 793, y: 0, flip: true },
      ...hut('wood', 880, 0, { beam: 'stone' }),
      { m: 'tnt', s: 'sq', x: 970, y: 0 },
      ...hut('stone', 1060, 0),
      { m: 'stone', s: 'ramp', x: 1147, y: 0 },
      { m: 'wood', s: 'long', x: 970, y: HUT },
      ...hut('glass', 970, HUT + SLAB, { beam: 'wood' }),
      { m: 'wood', s: 'roof', x: 970, y: HUT * 2 + SLAB },
      { m: 'glass', s: 'ramp', x: 883, y: HUT, flip: true },
      { m: 'glass', s: 'ramp', x: 1057, y: HUT },
    ],
    creatures: [
      { x: 880, y: 0, color: 'Pink' },
      { x: 1060, y: 0, color: 'Beige' },
      { x: 970, y: HUT + SLAB, color: 'Yellow', round: true },
      { x: 1210, y: 0, color: 'Green' },
    ],
  },
  {
    name: 'Twin towers',
    backdrop: 'land',
    shots: ['rock', 'rock', 'bomb', 'rock'],
    blocks: [
      ...hut('wood', 860, 0, { posts: 'tall' }),
      ...hut('glass', 860, TALL_HUT, { beam: 'wood' }),
      ...hut('stone', 1090, 0, { posts: 'tall', beam: 'metal' }),
      ...hut('wood', 1090, TALL_HUT),
      { m: 'tnt', s: 'sq', x: 975, y: 0 },
      { m: 'tnt', s: 'sq', x: 975, y: SLAB },
    ],
    creatures: [
      { x: 860, y: 0, color: 'Green' },
      { x: 860, y: TALL_HUT, color: 'Blue', round: true },
      { x: 1090, y: 0, color: 'Pink' },
      { x: 1090, y: TALL_HUT, color: 'Yellow' },
      { x: 1090, y: TALL_HUT + HUT, color: 'Beige', round: true },
    ],
  },
  {
    name: 'Fortress',
    backdrop: 'shroom',
    shots: ['rock', 'bomb', 'rock', 'bomb', 'rock'],
    blocks: [
      ...column('stone', 740, 0, ['tall', 'sq']),
      { m: 'glass', s: 'sq', x: 740, y: TALL + SLAB },
      ...hut('stone', 900, 0, { posts: 'tall' }),
      ...hut('wood', 900, TALL_HUT),
      { m: 'stone', s: 'roof', x: 900, y: TALL_HUT + HUT },
      ...hut('wood', 1075, 0, { beam: 'metal' }),
      { m: 'tnt', s: 'sq', x: 1050, y: HUT },
      { m: 'glass', s: 'post', x: 987, y: 0 },
      ...column('wood', 1205, 0, ['tall']),
    ],
    creatures: [
      { x: 900, y: 0, color: 'Yellow' },
      { x: 900, y: TALL_HUT, color: 'Pink', round: true },
      { x: 1075, y: 0, color: 'Blue' },
      { x: 1100, y: HUT, color: 'Green' },
      { x: 1205, y: TALL, color: 'Beige', round: true },
    ],
  },
];
