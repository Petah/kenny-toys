/**
 * The slope: endless in every direction downhill, made in square chunks as the skier nears them.
 * A chunk is built from a seed and its coordinates alone, so dropping one that's far behind and
 * making it again later gives the same trees. Distances are in world pixels, 16 to a tile (a metre).
 */

export const CHUNK = 256;
/** Chairlifts cross the slope this often, starting this far down. */
export const LIFT_FIRST = 1400;
export const LIFT_EVERY = 2400;
/** Towers stand this far apart along a lift, so every chunk has one in the same place. */
export const TOWER_EVERY = CHUNK;
/** The clear patch round the start, on chunk (0, 0) and its neighbour to the left. */
const START_CLEAR = { x: 110, y: 230 };

export interface Kind {
  frame: number;
  /** Hit box above the ground point (bottom middle of the tile). */
  hit: { w: number; h: number };
  /** What touching it does. */
  effect: 'crash' | 'jump';
}

export const KINDS = {
  pine: { frame: 6, hit: { w: 6, h: 5 }, effect: 'crash' },
  pine2: { frame: 30, hit: { w: 6, h: 5 }, effect: 'crash' },
  tree: { frame: 18, hit: { w: 6, h: 5 }, effect: 'crash' },
  dead: { frame: 7, hit: { w: 6, h: 4 }, effect: 'crash' },
  dead2: { frame: 19, hit: { w: 6, h: 4 }, effect: 'crash' },
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

const SCENERY: [KindName, number][] = [
  ['pine', 5],
  ['pine2', 5],
  ['tree', 2],
  ['dead', 1.5],
  ['dead2', 1],
  ['twigs', 1.2],
  ['rock', 1.5],
  ['snowman', 0.4],
  ['netRed', 0.35],
  ['netBlue', 0.35],
];
const SCENERY_TOTAL = SCENERY.reduce((a, [, w]) => a + w, 0);

/** Cable heights of the chairlifts crossing rows y0 to y1. */
export function liftsBetween(y0: number, y1: number) {
  const out: number[] = [];
  for (let n = Math.max(0, Math.ceil((y0 - LIFT_FIRST) / LIFT_EVERY)); LIFT_FIRST + n * LIFT_EVERY < y1; n++) out.push(LIFT_FIRST + n * LIFT_EVERY);
  return out;
}

export function makeChunk(seed: number, cx: number, cy: number): ChunkData {
  const chunk: ChunkData = { cx, cy, things: [], gates: [] };
  if (cy < 0) return chunk;
  const rand = rng(hash(seed, cx, cy));
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const metres = y0 / 16;

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
  const spot = (pad: number) => ({ x: x0 + pad + rand() * (CHUNK - pad * 2), y: y0 + pad + rand() * (CHUNK - pad * 2) });

  // A slalom gate, sometimes two, narrowing the further down you get.
  const gates = rand() < 0.5 ? 1 : rand() < Math.min(0.5, metres / 1500) ? 2 : 0;
  for (let i = 0; i < gates; i++) {
    const width = Math.max(48, 76 - metres / 60);
    for (let tries = 0; tries < 8; tries++) {
      const p = spot(24);
      const left = p.x - width / 2;
      const right = p.x + width / 2;
      if (!free(left, p.y, 6) || !free(right, p.y, 6) || !free(p.x, p.y, 10)) continue;
      chunk.things.push({ kind: 'flagRed', x: left, y: p.y }, { kind: 'flagBlue', x: right, y: p.y });
      chunk.gates.push({ y: p.y, left, right });
      keepOut.push({ x0: left - 10, y0: p.y - 70, x1: right + 10, y1: p.y + 40 });
      break;
    }
  }

  // A jump now and then, with a clear run-up and landing.
  if (rand() < 0.35 && !(cy === 0 && Math.abs(cx) <= 1)) {
    for (let tries = 0; tries < 8; tries++) {
      const p = spot(30);
      if (!free(p.x, p.y, 14)) continue;
      chunk.things.push({ kind: 'ramp', x: p.x, y: p.y });
      keepOut.push({ x0: p.x - 24, y0: p.y - 50, x1: p.x + 24, y1: p.y + 90 });
      break;
    }
  }

  const count = Math.round(6 + Math.min(12, metres / 70) + rand() * 3);
  for (let i = 0, tries = 0; i < count && tries < count * 6; tries++) {
    const p = spot(9);
    if (!free(p.x, p.y, 8)) continue;
    let pick = rand() * SCENERY_TOTAL;
    const [kind] = SCENERY.find(([, w]) => (pick -= w) < 0) ?? SCENERY[0];
    chunk.things.push({ kind, x: Math.round(p.x), y: Math.round(p.y) });
    i++;
  }
  return chunk;
}

/** True when a hit box round (x, y) with half-width hw and height h overlaps a thing's. */
export function touches(t: Thing, x: number, y: number, hw: number, h: number) {
  const k = KINDS[t.kind];
  return Math.abs(t.x - x) < k.hit.w / 2 + hw && y > t.y - k.hit.h - h && y - h < t.y;
}
