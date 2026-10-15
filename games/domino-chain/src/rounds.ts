import { CHIP_R, DIE_R, L, PAWN_R, SPACING, Table, W } from './chain.ts';

/** The pack's five domino sets, one per round in turn, each on its own colour of baize. */
export const THEMES = [
  { set: 'light', felt: 0x2f7d5b, rim: 0x6b4325 },
  { set: 'dark', felt: 0x3b8fa6, rim: 0x2b3442 },
  { set: 'gingerbread', felt: 0xc8574a, rim: 0x6b3a22 },
  { set: 'hearts', felt: 0x7a5cd6, rim: 0x4a3392 },
  { set: 'stars', felt: 0x2e4d8f, rim: 0x1c2a4a },
] as const;
export type Theme = (typeof THEMES)[number];

export const PAWN_COLOURS = ['Yellow', 'Blue', 'Green', 'Purple', 'White', 'Black', 'Red'] as const;

export interface Round {
  number: number;
  theme: Theme;
  /** Dominoes the player may lay. */
  budget: number;
  start: { x: number; y: number; dx: number; dy: number };
}

/** Small seeded generator (mulberry32), so a round can be laid out again the same way. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sets the table for round `n` (from 1): a starting domino on one edge pointing in, pawns to knock
 * over, dice in the way from round 2 and a few chips for bonus points. The budget is enough for a
 * nearest-first tour of the pawns with some slack, which shrinks as the rounds go on.
 */
export function setRound(table: Table, n: number, width: number, height: number, seed: number): Round {
  const rand = rng(seed * 7919 + n * 104729);
  const between = (a: number, b: number) => a + rand() * (b - a);
  table.pieces = [];
  table.chips = [];
  table.dice = [];

  // The start domino sits on the long side nearest the player's thumb: the bottom in portrait, the left otherwise.
  const portrait = height > width;
  const start = portrait
    ? { x: between(width * 0.3, width * 0.7), y: height - 50, dx: 0, dy: -1 }
    : { x: 50, y: between(height * 0.3, height * 0.7), dx: 1, dy: 0 };
  table.addDomino(start.x, start.y, start.dx, start.dy, -1, 27);

  const taken: { x: number; y: number; r: number }[] = [{ x: start.x, y: start.y, r: 90 }];
  const spot = (r: number, margin: number) => {
    for (let tries = 0; tries < 400; tries++) {
      const x = between(margin, width - margin);
      const y = between(margin, height - margin);
      if (taken.every((t) => Math.hypot(t.x - x, t.y - y) > t.r + r)) {
        taken.push({ x, y, r });
        return { x, y };
      }
    }
    return undefined;
  };

  const pawns = Math.min(2 + n, 8);
  for (let i = 0; i < pawns; i++) {
    const p = spot(PAWN_R + 70, 60);
    if (p) table.addPawn(p.x, p.y, Math.floor(rand() * PAWN_COLOURS.length));
  }
  const dice = Math.min(n - 1, 6) + (n > 4 ? 2 : 0);
  for (let i = 0; i < dice; i++) {
    const p = spot(DIE_R + 30, 50);
    if (p) table.dice.push({ x: p.x, y: p.y, angle: between(-30, 30), face: 1 + Math.floor(rand() * 6) });
  }
  for (let i = 0; i < 3; i++) {
    const p = spot(CHIP_R + 30, 50);
    if (p) table.chips.push({ x: p.x, y: p.y, taken: false });
  }

  // A smooth line through the pawns lays about 0.7 dominoes per SPACING of this rough tour (pawns
  // take up room, and curves cut corners). Early rounds allow plenty over that; later ones less.
  const slack = Math.max(0.82, 1.1 - (n - 1) * 0.035);
  const budget = Math.ceil(((tour(start, table.pawns) / SPACING) * slack) / 5) * 5 + 5;
  return { number: n, theme: THEMES[(n - 1) % THEMES.length], budget, start };
}

/** Length of a nearest-first walk from the start through every pawn, allowing for the turns. */
function tour(start: { x: number; y: number }, stops: { x: number; y: number }[]) {
  let at = start;
  let total = 0;
  const left = [...stops];
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].x - at.x, left[i].y - at.y) < Math.hypot(left[best].x - at.x, left[best].y - at.y)) best = i;
    const next = left.splice(best, 1)[0];
    total += Math.hypot(next.x - at.x, next.y - at.y) + L * 0.5;
    at = next;
  }
  return total + W;
}
