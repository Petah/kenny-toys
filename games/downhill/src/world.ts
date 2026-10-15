/**
 * The slope: endless in every direction downhill, made in square chunks as the skier nears them.
 * A chunk is built from a seed and its coordinates alone, so dropping one that's far behind and
 * making it again later gives the same slope. Distances are in world pixels, 16 to a tile (a metre).
 *
 * Groomed pistes wind down through deep snow, a few screens apart. They're drawn with the pack's
 * terrain tiles the way its sample map (Tiled/sampleMap.tmx) joins them: an edge runs straight down
 * a column, or steps one column sideways in a row using a pair of curved tiles.
 */

export const TILE = 16;
export const CHUNK = 256;
const CHUNK_TILES = CHUNK / TILE;
/** Chairlifts cross the slope this often, starting this far down; both on tile rows. */
export const LIFT_FIRST = 1400;
export const LIFT_EVERY = 2400;
/** The clear patch round the start. */
const START_CLEAR = { x: 110, y: 230 };

/** How far down the slope gets hardest, in metres (tiles). */
export const HARDEST_M = 2500;
/** 0 at the top, 1 from HARDEST_M on. */
export function difficulty(metres: number) {
  return Math.min(1, Math.max(0, metres / HARDEST_M));
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Terrain tiles: groomed piste is white, deep snow pale blue. */
const TERRAIN = {
  piste: [0, 0, 0, 0, 5],
  deep: [2, 2, 2, 2, 3],
  /** Deep snow on the left, piste on the right: straight, stepping left, stepping right. */
  left: { straight: [4], in: [76, 77], out: [64, 65] },
  /** Piste on the left, deep snow on the right. */
  right: { straight: [1], in: [60, 61], out: [72, 73] },
};

export interface Kind {
  frame: number;
  /** The tile above it, for the tall trees, which stand two tiles high. */
  top?: number;
  /** Hit box above the ground point (bottom middle of the tile). */
  hit: { w: number; h: number };
  /** What touching it does. */
  effect: 'crash' | 'jump';
}

export const KINDS = {
  pine: { frame: 18, top: 6, hit: { w: 6, h: 5 }, effect: 'crash' },
  smallPine: { frame: 30, hit: { w: 6, h: 5 }, effect: 'crash' },
  dead: { frame: 19, top: 7, hit: { w: 6, h: 4 }, effect: 'crash' },
  twigs: { frame: 31, hit: { w: 10, h: 4 }, effect: 'crash' },
  rock: { frame: 81, hit: { w: 12, h: 6 }, effect: 'crash' },
  snowman: { frame: 69, hit: { w: 8, h: 5 }, effect: 'crash' },
  netRed: { frame: 10, hit: { w: 14, h: 4 }, effect: 'crash' },
  netBlue: { frame: 11, hit: { w: 14, h: 4 }, effect: 'crash' },
  flagRed: { frame: 20, hit: { w: 4, h: 3 }, effect: 'crash' },
  flagBlue: { frame: 21, hit: { w: 4, h: 3 }, effect: 'crash' },
  tower: { frame: 66, hit: { w: 6, h: 4 }, effect: 'crash' },
  ramp: { frame: 36, hit: { w: 12, h: 9 }, effect: 'jump' },
} satisfies Record<string, Kind>;

export type KindName = keyof typeof KINDS;

export interface Thing {
  kind: KindName;
  x: number;
  /** The ground point: where it stands on the snow. */
  y: number;
}

/** A slalom gate: pass between its flags for style points. */
export interface Gate {
  y: number;
  left: number;
  right: number;
  /** Set once the skier has gone past: through it or not. */
  done?: 'through' | 'missed';
}

export interface ChunkData {
  cx: number;
  cy: number;
  /** Terrain tile numbers, a row at a time. */
  tiles: number[][];
  things: Thing[];
  gates: Gate[];
  /** Cable height of a chairlift crossing this chunk. */
  lift?: number;
}

/** A small seeded random number generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(...ns: number[]) {
  let h = 2166136261;
  for (const n of ns) h = Math.imul(h ^ (n | 0), 16777619);
  return h >>> 0;
}

// ---- Pistes -----------------------------------------------------------------------------------

/** Pistes run down the slope this many tiles apart, wandering either side of their line. */
export const PISTE_SPACING = 36;

/**
 * Where piste k's edges are at a given row, in tiles from x = 0, measured to the middle of the
 * edge tile. Each edge moves less than a tile a row, so rounding it steps at most one column.
 * Piste 0 starts centred on the skier; they all narrow the further down they go.
 */
export function pisteEdges(seed: number, k: number, row: number) {
  const r = rng(hash(seed, k, 77));
  const p1 = k === 0 ? 0 : r() * Math.PI * 2;
  const p2 = k === 0 ? 0 : r() * Math.PI * 2;
  const p3 = r() * Math.PI * 2;
  const flip = r() < 0.5 ? -1 : 1;
  const centre = k * PISTE_SPACING + flip * (6 * Math.sin((row * Math.PI * 2) / 140 + p1) + 3 * Math.sin((row * Math.PI * 2) / 55 + p2));
  const half = lerp(6, 2.6, difficulty(row)) + Math.sin((row * Math.PI * 2) / 70 + p3);
  return { left: centre - half, right: centre + half, centre };
}

/** The pistes near a world x. */
function nearPistes(x: number) {
  const k = Math.round(x / TILE / PISTE_SPACING);
  return [k - 1, k, k + 1];
}

/** True if a point in the world is on groomed piste. */
export function onPiste(seed: number, x: number, y: number) {
  const col = x / TILE - 0.5;
  const row = y / TILE;
  return nearPistes(x).some((k) => {
    const e = pisteEdges(seed, k, row);
    return col > e.left && col < e.right;
  });
}

/** One row of terrain tiles, from column c0, n wide. */
function terrainRow(seed: number, row: number, c0: number, n: number, rand: () => number) {
  const tiles: number[] = [];
  // Which column each edge is in at the top and bottom of the row.
  const edges = nearPistes((c0 + n / 2) * TILE).flatMap((k) => {
    const top = pisteEdges(seed, k, row);
    const bottom = pisteEdges(seed, k, row + 1);
    return [
      { side: TERRAIN.left, from: Math.round(top.left), to: Math.round(bottom.left) },
      { side: TERRAIN.right, from: Math.round(top.right), to: Math.round(bottom.right) },
    ];
  });
  for (let c = c0; c < c0 + n; c++) {
    let tile: number | undefined;
    let inside = false;
    for (const e of edges) {
      const lo = Math.min(e.from, e.to);
      const pieces = e.from === e.to ? e.side.straight : e.to < e.from ? e.side.in : e.side.out;
      if (c >= lo && c < lo + pieces.length) tile = pieces[c - lo];
      // Inside a piste: right of its left edge's pieces and left of its right edge's.
      if (e.side === TERRAIN.left && c > Math.max(e.from, e.to)) inside = !inside;
      if (e.side === TERRAIN.right && c >= Math.min(e.from, e.to)) inside = !inside;
    }
    const fill = inside ? TERRAIN.piste : TERRAIN.deep;
    tiles.push(tile ?? fill[Math.floor(rand() * fill.length)]);
  }
  return tiles;
}

// ---- Lifts ------------------------------------------------------------------------------------

/** Cable heights of the chairlifts crossing rows y0 to y1. */
export function liftsBetween(y0: number, y1: number) {
  const out: number[] = [];
  for (let n = Math.max(0, Math.ceil((y0 - LIFT_FIRST) / LIFT_EVERY)); LIFT_FIRST + n * LIFT_EVERY < y1; n++) out.push(LIFT_FIRST + n * LIFT_EVERY);
  return out;
}

// ---- Chunks -----------------------------------------------------------------------------------

const OFF_PISTE: [KindName, number][] = [
  ['pine', 6],
  ['smallPine', 4],
  ['dead', 2],
  ['rock', 1],
  ['twigs', 1],
];
const ON_PISTE: [KindName, number][] = [
  ['rock', 3],
  ['smallPine', 2],
  ['twigs', 2],
  ['snowman', 1],
  ['netRed', 1],
  ['netBlue', 1],
];
function pick(list: [KindName, number][], rand: () => number) {
  let n = rand() * list.reduce((a, [, w]) => a + w, 0);
  return (list.find(([, w]) => (n -= w) < 0) ?? list[0])[0];
}

export function makeChunk(seed: number, cx: number, cy: number): ChunkData {
  const rand = rng(hash(seed, cx, cy));
  const c0 = cx * CHUNK_TILES;
  const r0 = cy * CHUNK_TILES;
  const tiles: number[][] = [];
  for (let r = 0; r < CHUNK_TILES; r++) tiles.push(terrainRow(seed, r0 + r, c0, CHUNK_TILES, rand));
  const chunk: ChunkData = { cx, cy, tiles, things: [], gates: [] };
  if (cy < 0) return chunk;
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const d = difficulty(r0);

  // Patches nothing else may go in: round the start, along a lift, round gates and below ramps.
  const keepOut: { x0: number; y0: number; x1: number; y1: number }[] = [];
  if (cy === 0) keepOut.push({ x0: -START_CLEAR.x, y0: -100, x1: START_CLEAR.x, y1: START_CLEAR.y });
  const lift = liftsBetween(y0, y0 + CHUNK)[0];
  if (lift !== undefined) {
    chunk.lift = lift;
    keepOut.push({ x0: x0 - 20, y0: lift - 24, x1: x0 + CHUNK + 20, y1: lift + 60 });
    chunk.things.push({ kind: 'tower', x: x0 + CHUNK / 2, y: lift + 40 });
  }
  const free = (x: number, y: number, room: number) =>
    keepOut.every((r) => x < r.x0 - room || x > r.x1 + room || y < r.y0 - room || y > r.y1 + room) &&
    chunk.things.every((t) => Math.hypot(t.x - x, t.y - y) > room + 10);
  /** How far a point is inside the nearest piste, in tiles: negative when it's in deep snow. */
  const depthIn = (x: number, y: number) => {
    const col = x / TILE - 0.5;
    return Math.max(
      ...nearPistes(x).map((k) => {
        const e = pisteEdges(seed, k, y / TILE);
        return Math.min(col - e.left, e.right - col);
      }),
    );
  };

  // On each piste: a slalom gate or two, narrowing the further down, and now and then a jump.
  for (const k of nearPistes(x0 + CHUNK / 2)) {
    const gates = rand() < lerp(0.55, 0.9, d) ? (rand() < d ? 2 : 1) : 0;
    for (let i = 0; i < gates; i++) {
      const y = Math.round(y0 + 24 + rand() * (CHUNK - 48));
      const e = pisteEdges(seed, k, y / TILE);
      const mid = (e.centre + 0.5) * TILE;
      if (mid < x0 + 12 || mid > x0 + CHUNK - 12) continue;
      const width = Math.min(lerp(80, 44, d), (e.right - e.left) * TILE + 8);
      const left = Math.round(mid - width / 2 + (rand() - 0.5) * 16);
      const right = Math.round(left + width);
      if (!free(left, y, 6) || !free(right, y, 6)) continue;
      chunk.things.push({ kind: 'flagRed', x: left, y }, { kind: 'flagBlue', x: right, y });
      chunk.gates.push({ y, left, right });
      keepOut.push({ x0: left - 10, y0: y - 70, x1: right + 10, y1: y + 40 });
    }
    if (rand() < 0.3 && !(cy === 0 && cx === 0)) {
      const y = Math.round(y0 + 30 + rand() * (CHUNK - 60));
      const e = pisteEdges(seed, k, y / TILE);
      const x = Math.round((e.centre + 0.5 + (rand() - 0.5) * (e.right - e.left - 2)) * TILE);
      if (x > x0 + 8 && x < x0 + CHUNK - 8 && free(x, y, 14)) {
        chunk.things.push({ kind: 'ramp', x, y });
        keepOut.push({ x0: x - 24, y0: y - 50, x1: x + 24, y1: y + 90 });
      }
    }
  }

  // Trees thick in the deep snow, and obstacles creeping onto the pistes the further down you go.
  const offDensity = lerp(0.045, 0.11, d);
  const onDensity = lerp(0.002, 0.03, d);
  for (let r = 0; r < CHUNK_TILES; r++) {
    for (let c = 0; c < CHUNK_TILES; c++) {
      const x = Math.round(x0 + c * TILE + 8 + (rand() - 0.5) * 10);
      const y = Math.round(y0 + r * TILE + 8 + (rand() - 0.5) * 10);
      const inside = depthIn(x, y);
      const roll = rand();
      let kind: KindName | undefined;
      if (inside < -1.2 && roll < offDensity) kind = pick(OFF_PISTE, rand);
      else if (inside > 0.8 && roll < onDensity) kind = pick(ON_PISTE, rand);
      if (kind && free(x, y, 8)) chunk.things.push({ kind, x, y });
    }
  }
  return chunk;
}

/** True when a hit box round (x, y) with half-width hw and height h overlaps a thing's. */
export function touches(t: Thing, x: number, y: number, hw: number, h: number) {
  const k = KINDS[t.kind];
  return Math.abs(t.x - x) < k.hit.w / 2 + hw && y > t.y - k.hit.h - h && y - h < t.y;
}
