/**
 * The marble run as a chain of pieces, each snapped onto the open end of the one before.
 * Pure geometry, no three.js or Rapier, so scripts can build and check runs under Node.
 */
import type { Port, Side } from './ports.ts';

/** One piece of an item: which port the marble enters by and which it leaves by. */
export interface Part {
  model: string;
  /** A side letter, or 'high' / 'low' to pick the highest or lowest port (for helixes and U-bends). */
  enter: Side | 'high' | 'low';
  exit: Side | 'high' | 'low' | null;
}

export interface Item {
  id: string;
  label: string;
  parts: Part[];
}

export interface Shape {
  ports: Port[];
  /** The piece's own bounding box. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Where the track is open: a point on the groove floor and the way a marble would leave it. */
export interface Head {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
}

export interface Placed {
  model: string;
  /** World position of the model's origin and its turn about y (three.js convention). */
  x: number;
  y: number;
  z: number;
  angle: number;
  /** World bounding box. */
  box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** Index of the item in the run that this piece belongs to. */
  item: number;
}

/** A run starts with a closed-ended chute this high up, open to the north. */
export const START: Head = { x: 0, y: 8, z: 0, dx: 0, dz: -1 };
export const START_MODEL = 'end-rounded';
/** Pillars are this wide; nothing may pass through one. */
const PILLAR = 0.22;
/** Pieces may touch at their ends, so boxes are shrunk this much before testing for overlap. */
const SLACK = 0.06;

/** three.js turns +y anticlockwise seen from above: local (x, z) becomes this in the world. */
export function turn(x: number, z: number, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c + z * s, z: -x * s + z * c };
}

function pickPort(ports: Port[], which: Side | 'high' | 'low', not?: Port) {
  const usable = ports.filter((p) => p !== not && p.floor > 0.2);
  if (which === 'high') return usable.reduce((a, b) => (b.floor > a.floor ? b : a));
  if (which === 'low') return usable.reduce((a, b) => (b.floor < a.floor ? b : a));
  const found = usable.find((p) => p.side === which);
  if (!found) throw new Error(`no ${which} port`);
  return found;
}

/**
 * Puts one part on the end of the track. The part turns so its entry port faces back along
 * the track, then moves so the two grooves meet at the same height.
 */
export function attach(head: Head, part: Part, shape: Shape, item: number): { placed: Placed; head: Head | null } {
  const entry = pickPort(shape.ports, part.enter);
  // The entry port points out of the piece; it has to point back the way the marble came.
  const angle = [0, 1, 2, 3].map((q) => (q * Math.PI) / 2).find((a) => {
    const d = turn(entry.dx, entry.dz, a);
    return Math.abs(d.x + head.dx) < 1e-6 && Math.abs(d.z + head.dz) < 1e-6;
  })!;
  const e = turn(entry.x, entry.z, angle);
  const x = head.x - e.x;
  const z = head.z - e.z;
  const y = head.y - entry.floor;

  const corners = [
    turn(shape.minX, shape.minZ, angle),
    turn(shape.maxX, shape.maxZ, angle),
    turn(shape.minX, shape.maxZ, angle),
    turn(shape.maxX, shape.minZ, angle),
  ];
  const box = {
    minX: x + Math.min(...corners.map((c) => c.x)),
    maxX: x + Math.max(...corners.map((c) => c.x)),
    minY: y + shape.minY,
    maxY: y + shape.maxY,
    minZ: z + Math.min(...corners.map((c) => c.z)),
    maxZ: z + Math.max(...corners.map((c) => c.z)),
  };
  const placed = { model: part.model, x, y, z, angle, box, item };
  if (!part.exit) return { placed, head: null };
  const out = pickPort(shape.ports, part.exit, entry);
  const o = turn(out.x, out.z, angle);
  const d = turn(out.dx, out.dz, angle);
  return { placed, head: { x: x + o.x, y: y + out.floor, z: z + o.z, dx: Math.round(d.x), dz: Math.round(d.z) } };
}

type Box = Placed['box'];
const overlaps = (a: Box, b: Box) =>
  a.minX + SLACK < b.maxX - SLACK && b.minX + SLACK < a.maxX - SLACK && a.minY + SLACK < b.maxY - SLACK && b.minY + SLACK < a.maxY - SLACK && a.minZ + SLACK < b.maxZ - SLACK && b.minZ + SLACK < a.maxZ - SLACK;

/** The column a piece's pillar stands in, from the ground up to the piece. */
export function pillarBox(p: Placed): Box | null {
  if (p.box.minY < 0.3) return null;
  const cx = (p.box.minX + p.box.maxX) / 2;
  const cz = (p.box.minZ + p.box.maxZ) / 2;
  return { minX: cx - PILLAR, maxX: cx + PILLAR, minY: 0, maxY: p.box.minY, minZ: cz - PILLAR, maxZ: cz + PILLAR };
}

/** Why a new piece can't go where it would, or null if it fits. */
export function blocked(next: Placed, track: Placed[]): string | null {
  if (next.box.minY < -0.01) return 'That would go below the ground';
  const mine = pillarBox(next);
  for (const p of track) {
    // The piece it joins onto touches it, which is fine.
    if (overlaps(next.box, p.box)) return 'No room there: it would hit the track';
    const theirs = pillarBox(p);
    if (theirs && overlaps(next.box, theirs)) return 'No room there: it would hit a support';
    if (mine && overlaps(mine, p.box)) return 'No room there: its support would hit the track';
  }
  return null;
}

/** Builds a whole run from its items, stopping at the first that doesn't fit. */
export function buildRun(items: Item[], shapes: (model: string) => Shape) {
  const start = attachStart(shapes(START_MODEL));
  const placed: Placed[] = [start.placed];
  let head: Head | null = start.head;
  const accepted: Item[] = [];
  for (const item of items) {
    const result = tryItem(item, head, placed, shapes, accepted.length + 1);
    if (!result.ok) break;
    placed.push(...result.placed);
    head = result.head;
    accepted.push(item);
    if (!head) break;
  }
  return { placed, head, items: accepted };
}

/**
 * The chute everything starts from. Its only port is put at START facing the way the run
 * goes, by attaching it to an imaginary track coming the other way.
 */
export function attachStart(shape: Shape) {
  const { placed } = attach({ ...START, dx: -START.dx, dz: -START.dz }, { model: START_MODEL, enter: 'n', exit: null }, shape, 0);
  return { placed, head: START as Head };
}

export function tryItem(item: Item, head: Head | null, track: Placed[], shapes: (model: string) => Shape, index: number) {
  if (!head) return { ok: false as const, reason: 'The run is finished' };
  const placed: Placed[] = [];
  let at: Head | null = head;
  for (const part of item.parts) {
    if (!at) return { ok: false as const, reason: 'The run is finished' };
    const r = attach(at, part, shapes(part.model), index);
    // Parts of the same item join each other, so only test against what was there before.
    const why = blocked(r.placed, track);
    if (why) return { ok: false as const, reason: why };
    placed.push(r.placed);
    at = r.head;
  }
  return { ok: true as const, placed, head: at };
}

/**
 * A random run that fits: mostly downhill with turns mixed in, finishing when it runs low or
 * long. `random` returns 0..1, so tests can pass a seeded one.
 */
export function randomRun(items: Item[], shapes: (model: string) => Shape, random: () => number, maxItems = 16): Item[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const start = attachStart(shapes(START_MODEL));
  const track: Placed[] = [start.placed];
  let head: Head | null = start.head;
  const chosen: Item[] = [];
  // Weights: drops and turns most, flourishes now and then.
  const weights: [string, number][] = [
    ['straight', 2], ['left', 3], ['right', 3], ['wide-left', 2], ['wide-right', 2], ['drop', 4], ['steep', 2], ['gentle', 2],
    ['helix-left', 3], ['helix-right', 3], ['u-left', 2], ['u-right', 2], ['bump', 2], ['wave', 2], ['jog-left', 1], ['jog-right', 1], ['funnel', 1],
  ];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  // Marbles lose speed on the flat, so a random run never has more than two flat items in a
  // row, and only puts a bump straight after something downhill (it needs the speed).
  const downhill = new Set(['drop', 'steep', 'gentle', 'helix-left', 'helix-right', 'u-left', 'u-right']);
  let flats = 0;
  while (head && chosen.length < maxItems - 1 && head.y > 0.6) {
    let placed = false;
    for (let attempt = 0; attempt < 12 && !placed; attempt++) {
      let r = random() * total;
      const id = weights.find(([, w]) => (r -= w) < 0)![0];
      if (!downhill.has(id) && flats >= 2) continue;
      if (id === 'bump' && !downhill.has(chosen.at(-1)?.id ?? '')) continue;
      const item = byId.get(id)!;
      const result = tryItem(item, head, track, shapes, chosen.length + 1);
      if (!result.ok) continue;
      track.push(...result.placed);
      head = result.head;
      chosen.push(item);
      flats = downhill.has(id) ? 0 : flats + 1;
      placed = true;
    }
    if (!placed) break;
  }
  const finish = byId.get('finish')!;
  if (head && tryItem(finish, head, track, shapes, chosen.length + 1).ok) chosen.push(finish);
  return chosen;
}
