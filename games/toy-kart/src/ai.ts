import type { Controls } from './physics.ts';
import { LINE_STEP, wrap, type Built } from './track.ts';

/**
 * Where a car is round the circuit, and how the computer drives. No three.js or Rapier, so the
 * race checker shares it.
 */

/** The centre-line point nearest a position, searching near the last one first. */
export function nearest(built: Built, x: number, y: number, z: number, hint: number) {
  const line = built.line;
  const n = line.length;
  let best = hint;
  let bestD = Infinity;
  const look = (i: number) => {
    const p = line[((i % n) + n) % n];
    // Height counts extra so a car on an upper deck isn't placed on the track under it.
    const d = (p.x - x) ** 2 + (p.z - z) ** 2 + ((p.y - y) * 3) ** 2;
    if (d < bestD) {
      bestD = d;
      best = ((i % n) + n) % n;
    }
  };
  for (let i = hint - 24; i <= hint + 40; i++) look(i);
  // Lost (after a respawn or a wild bounce): look everywhere.
  if (bestD > 4) for (let i = 0; i < n; i++) look(i);
  return { index: best, off: Math.sqrt(bestD) };
}

/** Heading of the line at a point. */
export function lineYaw(built: Built, i: number) {
  const n = built.line.length;
  const a = built.line[((i - 2) % n + n) % n];
  const b = built.line[(i + 2) % n];
  return Math.atan2(b.x - a.x, b.z - a.z);
}

/** How much the line turns over the next `ahead` units, in radians. */
export function turnAhead(built: Built, i: number, ahead: number) {
  const steps = Math.round(ahead / LINE_STEP);
  let total = 0;
  let prev = lineYaw(built, i);
  for (let k = 4; k <= steps; k += 4) {
    const y = lineYaw(built, i + k);
    total += Math.abs(wrap(y - prev));
    prev = y;
  }
  return total;
}

export interface Driver {
  /** Which side of the centre line it likes, from -0.6 (left) to 0.6 (right). */
  lane: number;
  /** 0.85-1: how close to the limit it corners. */
  skill: number;
}

/** Steering and throttle towards a point ahead on the line, slowing for corners. */
export function drive(built: Built, d: Driver, index: number, x: number, z: number, yaw: number, speed: number, top: number): Controls {
  const n = built.line.length;
  const look = Math.round((1.4 + Math.max(0, speed) * 0.22) / LINE_STEP);
  const ti = (index + look) % n;
  const t = built.line[ti];
  const ty = lineYaw(built, ti);
  // Right of a car facing +z is -x, so the lane offset goes that way.
  const tx = t.x - Math.cos(ty) * d.lane;
  const tz = t.z + Math.sin(ty) * d.lane;
  const want = Math.atan2(tx - x, tz - z);
  const diff = wrap(want - yaw);
  const steer = Math.max(-1, Math.min(1, -diff * 2.6));
  const bend = turnAhead(built, index, 2 + Math.max(0, speed) * 0.45);
  const target = top * d.skill * Math.max(0.5, 1 - bend * 0.38);
  const throttle = speed < target ? 1 : speed > target + 1.2 ? -0.6 : 0.15;
  return { throttle, steer };
}
