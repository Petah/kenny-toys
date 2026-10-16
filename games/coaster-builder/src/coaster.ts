/**
 * A coaster as a smooth path built from moves (straight, turn, climb, drop, loop…) and the ride
 * along it. No three.js, so `scripts/check-rides.ts` can build and ride coasters in Node.
 *
 * The path is a list of points a quarter unit apart, each with the direction of travel and an
 * "up" for the track (which turns over in loops and leans into turns). Every move starts and
 * ends level, so any move can follow any other.
 */

export type Vec = { x: number; y: number; z: number };
const v = (x: number, y: number, z: number): Vec => ({ x, y, z });
const add = (a: Vec, b: Vec) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec, b: Vec) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: Vec, k: number) => v(a.x * k, a.y * k, a.z * k);
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec, b: Vec) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: Vec) => Math.hypot(a.x, a.y, a.z);
const norm = (a: Vec) => scale(a, 1 / (len(a) || 1));
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Smoother still: no sudden change in how sharply it bends where moves join. */
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export type MoveName = 'straight' | 'left' | 'right' | 'up' | 'down' | 'drop' | 'lift' | 'loop' | 'hill' | 'wideLeft' | 'wideRight';

/** Where a move ends, relative to where it starts (heading +z, level), and its shape. */
interface MoveDef {
  /** A point at t ∈ [0, 1] in the move's own frame: x to the right, y up, z ahead. */
  at: (t: number) => Vec;
  /** How far the heading turns by the end (positive is to the right). */
  turn: number;
  /** Roughly how long, for how finely to sample it. */
  length: number;
  /** A chain pulls the train up this move. */
  chain?: boolean;
  /** Loops turn the track over: "up" comes from the loop's centre rather than the sky. */
  loop?: { radius: number };
}

const arc = (r: number, dir: 1 | -1) => (t: number) => {
  const a = (t * Math.PI) / 2;
  return v(dir * (r - r * Math.cos(a)), 0, r * Math.sin(a));
};

export const MOVES: Record<MoveName, MoveDef> = {
  straight: { at: (t) => v(0, 0, 8 * t), turn: 0, length: 8 },
  left: { at: arc(6, -1), turn: -Math.PI / 2, length: 9.4 },
  right: { at: arc(6, 1), turn: Math.PI / 2, length: 9.4 },
  wideLeft: { at: arc(11, -1), turn: -Math.PI / 2, length: 17.3 },
  wideRight: { at: arc(11, 1), turn: Math.PI / 2, length: 17.3 },
  up: { at: (t) => v(0, 5 * smoother(t), 12 * t), turn: 0, length: 13 },
  down: { at: (t) => v(0, -5 * smoother(t), 12 * t), turn: 0, length: 13 },
  drop: { at: (t) => v(0, -12 * smoother(t), 20 * t), turn: 0, length: 24 },
  lift: { at: (t) => v(0, 14 * smoother(t), 24 * t), turn: 0, length: 28, chain: true },
  // A camelback: up and over for a moment of floating.
  hill: { at: (t) => v(0, 6 * Math.sin(Math.PI * t) ** 2, 16 * t), turn: 0, length: 18 },
  // A loop with a little sideways shift so the way out passes beside the way in.
  loop: {
    at: (t) => {
      const r = 5;
      const a = t * Math.PI * 2;
      return v(2.4 * smooth(t), r * (1 - Math.cos(a)), r * Math.sin(a) + 6 * t);
    },
    turn: 0,
    length: 36,
    loop: { radius: 5 },
  },
};

/** A heading and a place: every move starts and ends level. */
export interface Pose {
  p: Vec;
  yaw: number;
}

/** A local point placed by a pose (yaw 0 faces +z; positive yaw turns towards +x). */
export function apply(pose: Pose, l: Vec): Vec {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  return v(pose.p.x + l.x * c + l.z * s, pose.p.y + l.y, pose.p.z - l.x * s + l.z * c);
}

export function endOf(start: Pose, move: MoveName): Pose {
  const d = MOVES[move];
  return { p: apply(start, d.at(1)), yaw: start.yaw + d.turn };
}

/** Where the station puts the train on the track: its platform is level at this height. */
export const STATION_Y = 1.6;
export const STATION_LENGTH = 12;
export const START: Pose = { p: v(0, STATION_Y, 0), yaw: 0 };
/** Track can't go lower than this over the grass. */
export const MIN_Y = 0.9;

/** Every pose along a list of moves, starting after the station. */
export function poses(moves: MoveName[]): Pose[] {
  const out: Pose[] = [{ p: apply(START, v(0, 0, STATION_LENGTH)), yaw: 0 }];
  for (const m of moves) out.push(endOf(out[out.length - 1], m));
  return out;
}

/** Can this move go on the end without dipping into the ground? */
export function fits(end: Pose, move: MoveName) {
  for (let i = 0; i <= 20; i++) if (apply(end, MOVES[move].at(i / 20)).y < MIN_Y - 1e-6) return false;
  return true;
}

export interface Point {
  p: Vec;
  /** Direction of travel. */
  t: Vec;
  /** The track's up: out of the rails. */
  u: Vec;
  /** Distance along the track. */
  s: number;
  chain: boolean;
  /** On the station's platform (brakes and launch). */
  station: boolean;
}

export interface Track {
  points: Point[];
  length: number;
  /** Does it come back round to the station? */
  closed: boolean;
  /** Where the move each point belongs to begins, for undo highlights. */
  loops: number;
}

const STEP = 0.25;

/**
 * Samples the station, the moves and (if `close`) a smooth run back into the station into
 * evenly spaced points, with a frame at each.
 */
export function buildTrack(moves: MoveName[], close: boolean): Track {
  const raw: { p: Vec; chain: boolean; station: boolean; loopCentre?: Vec }[] = [];
  const pushLine = (a: Vec, b: Vec, station: boolean) => {
    const n = Math.max(1, Math.ceil(len(sub(b, a)) / STEP));
    for (let i = 0; i < n; i++) raw.push({ p: add(a, scale(sub(b, a), i / n)), chain: false, station });
  };
  // The station: a level run along +z.
  pushLine(START.p, apply(START, v(0, 0, STATION_LENGTH)), true);
  let pose: Pose = { p: apply(START, v(0, 0, STATION_LENGTH)), yaw: 0 };
  let loops = 0;
  for (const m of moves) {
    const d = MOVES[m];
    const n = Math.max(2, Math.ceil(d.length / STEP));
    // Loops sample finely and know their centre (for the track's "up").
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const lp = d.at(t);
      const centre = d.loop ? apply(pose, v(lp.x, d.loop.radius, lp.z - d.loop.radius * Math.sin(t * Math.PI * 2))) : undefined;
      raw.push({ p: apply(pose, lp), chain: !!d.chain, station: false, loopCentre: centre });
    }
    if (d.loop) loops++;
    pose = endOf(pose, m);
  }
  if (close) {
    // Back to the start of the station with a Hermite curve, arriving heading +z along it.
    const a = pose.p;
    const b = apply(START, v(0, 0, -6));
    const dist = len(sub(b, a));
    const ta = scale(v(Math.sin(pose.yaw), 0, Math.cos(pose.yaw)), dist * 1.2);
    const tb = scale(v(0, 0, 1), dist * 1.2);
    const n = Math.ceil((dist * 1.5) / STEP);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      const p = add(add(scale(a, h00), scale(ta, h10)), add(scale(b, h01), scale(tb, h11)));
      p.y = Math.max(MIN_Y, p.y);
      raw.push({ p, chain: false, station: false });
    }
    pushLine(b, START.p, true);
    raw.push({ p: START.p, chain: false, station: true });
  } else {
    raw.push({ p: pose.p, chain: false, station: false });
  }

  // Resample at even spacing and work out frames.
  const pts: Point[] = [];
  let s = 0;
  let prevU = v(0, 1, 0);
  for (let i = 0; i < raw.length; i++) {
    const a = raw[Math.max(0, i - 1)].p;
    const b = raw[Math.min(raw.length - 1, i + 1)].p;
    const t = norm(sub(b, a));
    if (i > 0) s += len(sub(raw[i].p, raw[i - 1].p));
    let u: Vec;
    const lc = raw[i].loopCentre;
    if (lc) {
      // In a loop, up points at the middle of the loop.
      u = norm(sub(lc, raw[i].p));
      u = norm(sub(u, scale(t, dot(u, t))));
    } else {
      // Carry the last up along (parallel transport), then ease it back towards the sky.
      u = sub(prevU, scale(t, dot(prevU, t)));
      const sky = sub(v(0, 1, 0), scale(t, t.y));
      u = norm(add(scale(norm(u), 0.85), scale(norm(sky), 0.15)));
    }
    prevU = u;
    pts.push({ p: raw[i].p, t, u, s, chain: raw[i].chain, station: raw[i].station });
  }
  // Lean into turns: roll the up towards the inside of the bend, more for tighter, faster bends.
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i + 1];
    const turn = cross(a.t, b.t).y / Math.max(1e-6, b.s - a.s);
    const side = norm(cross(pts[i].t, pts[i].u));
    const bank = Math.max(-0.7, Math.min(0.7, -turn * 3.5));
    if (pts[i].u.y > 0.5) pts[i].u = norm(add(scale(pts[i].u, Math.cos(bank)), scale(side, Math.sin(bank))));
  }
  // Smooth the ups so the banking eases in and out.
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      if (pts[i].u.y < 0.3) continue;
      const avg = norm(add(add(pts[i - 1].u, pts[i + 1].u), scale(pts[i].u, 2)));
      pts[i].u = norm(sub(avg, scale(pts[i].t, dot(avg, pts[i].t))));
    }
  }
  return { points: pts, length: s, closed: close, loops };
}

/** The point (interpolated) at distance `s` along the track. */
export function sampleAt(track: Track, s: number): Point {
  const pts = track.points;
  if (s <= 0) return pts[0];
  if (s >= track.length) return pts[pts.length - 1];
  // Binary search for the segment.
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const k = (s - a.s) / Math.max(1e-6, b.s - a.s);
  const mix = (x: Vec, y: Vec) => add(scale(x, 1 - k), scale(y, k));
  return { p: mix(a.p, b.p), t: norm(mix(a.t, b.t)), u: norm(mix(a.u, b.u)), s, chain: a.chain, station: a.station };
}

// ---- The ride ------------------------------------------------------------------------------

export const GRAVITY = 9.8;
const CHAIN_SPEED = 4;
/** The station launches trains out fast enough to clear a small hill. */
const LAUNCH_SPEED = 12;
/** Rolling friction and air drag. */
const FRICTION = 0.12;
const DRAG = 0.0016;
/** World units are about 2m: a car is 1.3 long. */
export const METRES = 2;

export interface RideStats {
  topSpeed: number;
  biggestDrop: number;
  maxG: number;
  minG: number;
  airtime: number;
  loops: number;
  length: number;
}

export type RideEnd = 'home' | 'stalled' | 'flew';

/** A train going round a track. */
export class Ride {
  s = 0;
  speed = 0;
  /** Vertical g felt by the riders (1 sitting still). */
  g = 1;
  ended?: RideEnd;
  stats: RideStats;
  private lastPeak = 0;
  private stuck = 0;
  /** Off the end: flying freely. */
  flight?: { p: Vec; vel: Vec; t: Vec };

  track: Track;

  constructor(track: Track) {
    this.track = track;
    this.stats = { topSpeed: 0, biggestDrop: 0, maxG: 1, minG: 1, airtime: 0, loops: track.loops, length: track.length };
    this.lastPeak = track.points[0].p.y;
  }

  step(dt: number) {
    if (this.ended && !this.flight) return;
    if (this.flight) {
      this.flight.vel.y -= GRAVITY * dt;
      this.flight.p = add(this.flight.p, scale(this.flight.vel, dt));
      if (this.flight.p.y < 0) this.ended = 'flew';
      return;
    }
    const here = sampleAt(this.track, this.s);
    const slope = here.t.y;
    let a = -GRAVITY * slope - FRICTION * Math.sign(this.speed) - DRAG * this.speed * Math.abs(this.speed);
    if (here.station && this.s < STATION_LENGTH) {
      // Tyres launch it out of the station.
      if (this.speed < LAUNCH_SPEED) a = 9;
    } else if (here.station && this.track.closed && this.s > this.track.length - STATION_LENGTH - 2) {
      // Brakes on the way back in.
      a = -Math.max(2, this.speed * 1.2);
      if (this.speed < 0.6) {
        this.speed = 0;
        this.ended = 'home';
        return;
      }
    }
    this.speed += a * dt;
    if (here.chain && this.speed < CHAIN_SPEED) this.speed = CHAIN_SPEED;
    this.s += this.speed * dt;

    // Felt g: the push of the track (curvature) along its up, plus gravity's share.
    const ahead = sampleAt(this.track, this.s + 0.5);
    const behind = sampleAt(this.track, this.s - 0.5);
    const bend = scale(sub(ahead.t, behind.t), 1 / Math.max(0.25, ahead.s - behind.s));
    const now = sampleAt(this.track, this.s);
    const g = (dot(bend, now.u) * this.speed * this.speed + GRAVITY * now.u.y) / GRAVITY;
    // Riders feel it smoothed over a moment, not the jolt of each join.
    this.g += (g - this.g) * Math.min(1, dt * 8);

    const st = this.stats;
    st.topSpeed = Math.max(st.topSpeed, Math.abs(this.speed));
    if (!now.station) {
      st.maxG = Math.max(st.maxG, this.g);
      st.minG = Math.min(st.minG, this.g);
      if (this.g < 0.25) st.airtime += dt;
    }
    // Drops: from the last high point to each low point.
    if (now.p.y > this.lastPeak || slope > 0.05) this.lastPeak = Math.max(now.p.y, slope > 0.05 ? now.p.y : this.lastPeak);
    st.biggestDrop = Math.max(st.biggestDrop, this.lastPeak - now.p.y);

    if (this.s >= this.track.length) {
      if (this.track.closed) {
        this.ended = 'home';
      } else {
        // Off the end of the track!
        const end = sampleAt(this.track, this.track.length);
        this.flight = { p: end.p, vel: scale(end.t, this.speed), t: end.t };
      }
      return;
    }
    // Rolled back into the station, or stuck in a dip.
    if (this.s < 0) {
      this.s = 0;
      this.speed = 0;
    }
    // Rolling backwards (or barely moving) means it didn't make it over.
    if (this.speed < 0.3 && !now.chain && !(now.station && this.s < STATION_LENGTH)) {
      this.stuck += dt;
      if (this.stuck > 2.5) this.ended = 'stalled';
    } else this.stuck = 0;
  }

  /** Stars out of five, and a word for it. */
  rating() {
    const st = this.stats;
    const kmh = st.topSpeed * METRES * 3.6;
    let score = 0;
    score += Math.min(2, kmh / 45);
    score += Math.min(1, (st.biggestDrop * METRES) / 30);
    score += Math.min(1, st.loops * 0.5);
    score += Math.min(0.6, st.airtime * 0.5);
    score += Math.min(0.6, Math.max(0, st.maxG - 2) * 0.3);
    if (this.ended === 'flew') score *= 0.4;
    if (this.ended === 'stalled') score *= 0.5;
    const stars = Math.max(0, Math.min(5, Math.round(score)));
    const word = ['Snooze', 'Gentle', 'Fun', 'Thrilling', 'Wild', 'Insane'][stars];
    return { stars, word, score };
  }
}
