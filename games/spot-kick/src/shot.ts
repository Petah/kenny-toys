/**
 * Penalty kicks with no Phaser: where a kick goes, how the keeper dives, and whether it's a
 * goal, a save, off the post or wide. Metres, seen from above: the goal line is y = 0 with the
 * posts at x = ±HALF_GOAL, the penalty spot at y = SPOT; z is height off the grass.
 */

export const HALF_GOAL = 3.66;
export const BAR = 2.44;
export const SPOT = 11;
export const GRAVITY = 9.8;
export const POST_R = 0.12;
export const BALL_R = 0.11;

/** A kick: aimed along a direction with a power from 0 to 1. */
export interface Kick {
  /** Where on the goal line it's aimed (x), before any slice. */
  aimX: number;
  power: number;
}

export interface Flight {
  vx: number;
  vy: number;
  vz: number;
  /** When it reaches the goal line, and where it is then. */
  time: number;
  x: number;
  z: number;
}

/** A kick never goes exactly where it's aimed: the harder it's hit, the further off it can go. */
export function wobble(k: Kick, rand: () => number): Kick {
  const g = (rand() + rand() + rand() - 1.5) / 1.5;
  return { aimX: k.aimX + g * (0.15 + k.power * 0.7), power: k.power };
}

/** Faster kicks rise more: blast it and it's over the bar. */
export function flightOf(k: Kick): Flight {
  const speed = 16 + 16 * k.power;
  const dx = k.aimX;
  const dy = -SPOT;
  const len = Math.hypot(dx, dy);
  const vx = (dx / len) * speed;
  const vy = (dy / len) * speed;
  // Tuned so a kick at 0.85 power reaches the bar and anything harder sails over.
  const vz = 3 + Math.pow(k.power, 3) * 8.6;
  const time = len / speed;
  const z = Math.max(0, vz * time - 0.5 * GRAVITY * time * time);
  return { vx, vy, vz, time, x: dx, z };
}

/** Where the ball is `t` seconds after the kick (it bounces off the grass). */
export function ballAt(f: Flight, t: number) {
  let z = f.vz * t - 0.5 * GRAVITY * t * t;
  if (z < 0) {
    // A simple bounce: what's left of the arc, smaller.
    const land = (2 * f.vz) / GRAVITY;
    const after = t - land;
    const v2 = f.vz * 0.45;
    z = Math.max(0, v2 * after - 0.5 * GRAVITY * after * after);
  }
  return { x: f.vx * t, y: SPOT + f.vy * t, z };
}

export interface Keeper {
  /** Where the keeper stands along the line, and the spot they're diving for. */
  x: number;
  target: number;
  /** Seconds until they react (move). */
  wait: number;
  diving: boolean;
}

export const DIVE_SPEED = 7;

/** How far either side the keeper can reach at a height: less up in the corners. */
export function reach(k: Keeper, z: number) {
  const body = k.diving ? 0.85 : 0.6;
  const tall = k.diving ? 1.9 : 2.25;
  if (z > tall) return 0;
  return body * (1 - 0.25 * (z / tall));
}

export function stepKeeper(k: Keeper, dt: number) {
  if (k.wait > 0) {
    k.wait -= dt;
    return;
  }
  const d = k.target - k.x;
  if (Math.abs(d) > 0.05) k.diving = Math.abs(k.target) > 0.6;
  k.x += Math.sign(d) * Math.min(Math.abs(d), DIVE_SPEED * dt);
}

export type Result = 'goal' | 'saved' | 'post' | 'wide' | 'over';

/** What happens when the ball reaches the goal line, with the keeper where they are. */
export function judge(f: Flight, k: Keeper): Result {
  const { x, z } = f;
  const ax = Math.abs(x);
  if (z > BAR + BALL_R) return 'over';
  if (Math.abs(ax - HALF_GOAL) < POST_R + BALL_R || (Math.abs(z - BAR) < POST_R + BALL_R && ax < HALF_GOAL)) return 'post';
  if (ax > HALF_GOAL) return 'wide';
  if (Math.abs(x - k.x) < reach(k, z) + BALL_R) return 'saved';
  return 'goal';
}

/**
 * The computer keeper's guess at a kick: a good keeper reads the side more often, and gets
 * moving sooner.
 */
export function keeperGuess(f: Flight, skill: number, rand: () => number): Keeper {
  const reads = rand() < 0.15 + skill * 0.4;
  let target: number;
  if (reads) {
    // Reads the kick, but has to see it first.
    target = f.x + (rand() - 0.5) * (2.2 - skill * 1.4);
    target = Math.max(-HALF_GOAL + 0.4, Math.min(HALF_GOAL - 0.4, target));
    return { x: 0, target, wait: 0.1 + (1 - skill) * 0.15, diving: false };
  }
  // A guess, made before the kick, so the dive is already under way.
  const r = rand();
  target = r < 0.42 ? -2.2 : r < 0.84 ? 2.2 : 0;
  return { x: 0, target, wait: 0, diving: false };
}

/** The computer's kick: corners more often, harder and more accurate the better they are. */
export function cpuKick(skill: number, rand: () => number): Kick {
  const side = rand() < 0.5 ? -1 : 1;
  const r = rand();
  const aim = r < 0.15 ? 0 : side * (r < 0.55 ? 2.9 : 1.9);
  const off = (rand() - 0.5) * (1.6 - skill);
  const power = 0.35 + rand() * 0.35 + skill * 0.1;
  return { aimX: aim + off, power: Math.min(0.92, power) };
}
