/**
 * The probe's flight, with no Phaser in it so scripts/check-levels.ts can fly the same paths the
 * game does. Everything is in level units: a 1280 x 720 field, seconds and pixels a second.
 * It steps at a fixed DT, so a flight comes out the same at any frame rate, and the aiming
 * preview is the start of the very path the probe will take.
 */

export const FIELD_W = 1280;
export const FIELD_H = 720;

/** Simulation step, in seconds. */
export const DT = 1 / 240;
/** Pull at a planet's surface, in pixels a second squared, for a planet of mass 1. */
export const SURFACE_G = 2200;
/** Fastest launch, at full stretch. */
export const MAX_LAUNCH = 500;
/** Slowest launch, so a tap doesn't just drop the probe. */
export const MIN_LAUNCH = 150;
export const PROBE_R = 10;
/** How close the probe's centre has to come to the station's to dock. */
export const DOCK_R = 50;
export const STAR_R = 28;
/** How far past the edge of the field the probe can stray before it's lost. About the edge of the screen. */
export const MARGIN = 90;
/** A flight that hasn't ended by now is stuck in orbit. */
export const FLIGHT_LIMIT = 10;

export interface Point {
  x: number;
  y: number;
}

/** A circle round a fixed centre. Positive periods go clockwise on screen. */
export interface Orbit {
  cx: number;
  cy: number;
  radius: number;
  /** Seconds a lap. */
  period: number;
  /** Where on the circle it is at time 0, in turns from the right-hand side. */
  phase: number;
}

export interface Planet extends Point {
  r: number;
  /** Which of the pack's ten planets to draw. */
  skin: number;
  /** Pull relative to an ordinary planet of the same size. */
  mass?: number;
  orbit?: Orbit;
}

/** An asteroid: wrecks the probe but doesn't pull it. */
export interface Rock extends Point {
  r: number;
  orbit?: Orbit;
}

export interface Level {
  name: string;
  /** Seconds of path the aiming dots show. */
  preview: number;
  start: Point;
  station: Point & { orbit?: Orbit };
  planets: Planet[];
  rocks: Rock[];
  stars: Point[];
}

/** Where a body is `t` seconds into the level. */
export function placeAt(body: Point & { orbit?: Orbit }, t: number): Point {
  const o = body.orbit;
  if (!o) return body;
  const a = (o.phase + t / o.period) * Math.PI * 2;
  return { x: o.cx + Math.cos(a) * o.radius, y: o.cy + Math.sin(a) * o.radius };
}

export type Outcome = 'flying' | 'docked' | 'crashed' | 'lost' | 'stuck';

export interface Flight {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Level time the flight started at. */
  t0: number;
  /** Seconds in flight. */
  t: number;
  /** Indices of the stars picked up on the way. */
  stars: number[];
  outcome: Outcome;
  /** What it crashed into. */
  hit?: Point;
}

export function launch(level: Level, t0: number, vx: number, vy: number): Flight {
  return { x: level.start.x, y: level.start.y, vx, vy, t0, t: 0, stars: [], outcome: 'flying' };
}

/** Launch velocity for an aim angle (radians) and a stretch from 0 to 1. */
export function launchVelocity(angle: number, power: number): Point {
  const speed = MIN_LAUNCH + (MAX_LAUNCH - MIN_LAUNCH) * power;
  return { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
}

/** Advances a flight by one DT, then checks what it ran into. */
export function step(level: Level, f: Flight) {
  if (f.outcome !== 'flying') return;
  const now = f.t0 + f.t;
  let ax = 0;
  let ay = 0;
  for (const p of level.planets) {
    const at = placeAt(p, now);
    const dx = at.x - f.x;
    const dy = at.y - f.y;
    const d2 = Math.max(dx * dx + dy * dy, p.r * p.r);
    const a = (SURFACE_G * (p.mass ?? 1) * p.r * p.r) / d2;
    const d = Math.sqrt(d2);
    ax += (a * dx) / d;
    ay += (a * dy) / d;
  }
  // Semi-implicit Euler: steady enough for orbits at this step size.
  f.vx += ax * DT;
  f.vy += ay * DT;
  f.x += f.vx * DT;
  f.y += f.vy * DT;
  f.t += DT;
  check(level, f, f.t0 + f.t);
}

function check(level: Level, f: Flight, now: number) {
  const near = (p: Point, r: number) => (f.x - p.x) ** 2 + (f.y - p.y) ** 2 < r * r;
  for (const p of level.planets) {
    const at = placeAt(p, now);
    if (near(at, p.r + PROBE_R * 0.6)) return end(f, 'crashed', at);
  }
  for (const rock of level.rocks) {
    const at = placeAt(rock, now);
    if (near(at, rock.r + PROBE_R * 0.6)) return end(f, 'crashed', at);
  }
  level.stars.forEach((s, i) => {
    if (!f.stars.includes(i) && near(s, STAR_R)) f.stars.push(i);
  });
  if (near(placeAt(level.station, now), DOCK_R)) return end(f, 'docked');
  if (f.x < -MARGIN || f.x > FIELD_W + MARGIN || f.y < -MARGIN || f.y > FIELD_H + MARGIN) return end(f, 'lost');
  if (f.t > FLIGHT_LIMIT) return end(f, 'stuck');
}

function end(f: Flight, outcome: Outcome, hit?: Point) {
  f.outcome = outcome;
  f.hit = hit;
}

/** Flies a launch to the end, or for `seconds` at most, recording a point every `every` steps. */
export function fly(level: Level, t0: number, vx: number, vy: number, seconds = FLIGHT_LIMIT + 1, every = 0) {
  const f = launch(level, t0, vx, vy);
  const path: Point[] = [{ x: f.x, y: f.y }];
  const steps = Math.round(seconds / DT);
  for (let i = 1; i <= steps && f.outcome === 'flying'; i++) {
    step(level, f);
    if (every && i % every === 0) path.push({ x: f.x, y: f.y });
  }
  return { flight: f, path };
}

/** True when any planet, rock or the station moves. */
export const hasMovers = (level: Level) => [...level.planets, ...level.rocks, level.station].some((b) => b.orbit);
