/**
 * The sky, made a row at a time going up: where platforms, items and critters go. No Phaser, so
 * `scripts/check-climb.ts` can generate thousands of rows and check every one can be reached.
 * World units; y grows downwards as on screen, so going up means y getting more negative.
 */

/** Width of the column the bunny plays in; it wraps round at the sides. */
export const WIDTH = 480;
export const GRAVITY = 1900;
export const JUMP_V = 950;
export const SPRING_V = 1520;
/** How high a plain bounce goes. */
export const JUMP_HEIGHT = (JUMP_V * JUMP_V) / (2 * GRAVITY);
/** The biggest gap between platforms on the way up, leaving room to spare under a full jump. */
export const MAX_GAP = 190;
/** World units per point of score. */
export const UNITS_PER_POINT = 10;

export const PLATFORM_W = { big: 171, small: 90, cloud: 112 };

export type Biome = 'grass' | 'sand' | 'snow' | 'cake' | 'stone' | 'wood';
/** Score where each kind of island starts, cycling round after the last. */
export const BIOMES: { from: number; biome: Biome }[] = [
  { from: 0, biome: 'grass' },
  { from: 300, biome: 'sand' },
  { from: 700, biome: 'snow' },
  { from: 1200, biome: 'cake' },
  { from: 1800, biome: 'stone' },
  { from: 2500, biome: 'wood' },
];

export function biomeAt(points: number): Biome {
  const lap = 3200;
  const p = points % lap;
  let b: Biome = 'grass';
  for (const z of BIOMES) if (p >= z.from) b = z.biome;
  return b;
}

export type PlatformKind = 'solid' | 'moving' | 'crumble' | 'cloud';
export type Item = 'spring' | 'carrot' | 'gold' | 'jetpack' | 'wings' | 'bubble';
export type EnemyKind = 'flyMan' | 'wingMan' | 'spikeMan' | 'spikeBall';

export interface PlatformSpec {
  x: number;
  /** The top surface, where the bunny's feet land. */
  y: number;
  kind: PlatformKind;
  size: 'big' | 'small';
  biome: Biome;
  /** Moving platforms glide between these x positions. */
  minX?: number;
  maxX?: number;
  speed?: number;
  item?: Item;
  /** On the line of platforms guaranteed to be reachable. */
  path: boolean;
}

export interface EnemySpec {
  kind: EnemyKind;
  x: number;
  y: number;
  /** Walkers pace and fliers drift between these. */
  minX: number;
  maxX: number;
}

/** A small seeded random generator (mulberry32), so a sky can be made again from its seed. */
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

export const widthOf = (p: { kind: PlatformKind; size: 'big' | 'small' }) => (p.kind === 'cloud' ? PLATFORM_W.cloud : PLATFORM_W[p.size]);

/** 0 at the bottom, rising to 1 by 2600 points up. */
export const difficulty = (y: number) => Math.min(1, Math.max(0, -y / UNITS_PER_POINT / 2600));

export class Sky {
  private rand: () => number;
  /** The highest path platform so far. */
  top: number;
  lastX = WIDTH / 2;

  constructor(seed: number, startY = 0) {
    this.rand = rng(seed);
    this.top = startY;
  }

  private between(a: number, b: number) {
    return a + this.rand() * (b - a);
  }

  private chance(p: number) {
    return this.rand() < p;
  }

  /** The next row up: one platform on the way, plus whatever else shares its height. */
  next(): { platforms: PlatformSpec[]; enemies: EnemySpec[] } {
    const d = difficulty(this.top);
    const gap = Math.min(MAX_GAP, this.between(62, 100) + d * this.between(50, 95));
    const y = this.top - gap;
    const points = -y / UNITS_PER_POINT;
    const biome = biomeAt(points);
    const platforms: PlatformSpec[] = [];
    const enemies: EnemySpec[] = [];

    const size = this.chance(0.12 + d * 0.5) ? 'small' : 'big';
    const roll = this.rand();
    const moving = points > 120 && roll < 0.08 + d * 0.3;
    const cloud = !moving && points > 450 && roll < 0.08 + d * 0.3 + 0.1;
    const kind: PlatformKind = moving ? 'moving' : cloud ? 'cloud' : 'solid';
    const w = widthOf({ kind, size });
    const x = this.between(w / 2 + 4, WIDTH - w / 2 - 4);
    const path: PlatformSpec = { x, y, kind, size, biome, path: true };
    if (moving) {
      const span = this.between(120, 260 + d * 120);
      path.minX = Math.max(w / 2, x - span / 2);
      path.maxX = Math.min(WIDTH - w / 2, x + span / 2);
      path.speed = this.between(55, 95) * (1 + d);
    }
    // Things to pick up.
    if (kind === 'solid' && this.chance(0.075)) path.item = 'spring';
    else if (points > 150 && this.chance(0.022)) path.item = this.chance(0.45) ? 'jetpack' : 'wings';
    else if (points > 250 && this.chance(0.02)) path.item = 'bubble';
    else if (this.chance(0.2)) path.item = this.chance(0.12) ? 'gold' : 'carrot';
    platforms.push(path);

    // A cracked decoy in the gap below, which breaks underfoot.
    if (points > 60 && this.chance(0.14 + d * 0.3)) {
      const cs = this.chance(0.5) ? 'big' : 'small';
      const cw = PLATFORM_W[cs];
      const cx = this.awayFrom(x, cw, w);
      if (cx !== undefined) platforms.push({ x: cx, y: y + gap * this.between(0.35, 0.65), kind: 'crumble', size: cs, biome, path: false });
    }
    // Sometimes a spare island beside it, early on more often.
    else if (!moving && this.chance(0.3 - d * 0.2)) {
      const sx = this.awayFrom(x, PLATFORM_W.small, w);
      if (sx !== undefined) platforms.push({ x: sx, y: y + this.between(-30, 30), kind: 'solid', size: 'small', biome, path: false });
    }

    // Critters, from a little way up.
    if (points > 300 && this.chance(0.05 + d * 0.11)) {
      const r = this.rand();
      if (points > 900 && r < 0.18) {
        // A spiky man pacing his own island, off to one side.
        const ix = this.awayFrom(x, PLATFORM_W.big, w) ?? (x < WIDTH / 2 ? WIDTH - PLATFORM_W.big / 2 - 4 : PLATFORM_W.big / 2 + 4);
        platforms.push({ x: ix, y: y - gap * 0.5, kind: 'solid', size: 'big', biome, path: false });
        enemies.push({ kind: 'spikeMan', x: ix, y: y - gap * 0.5, minX: ix - PLATFORM_W.big / 2 + 22, maxX: ix + PLATFORM_W.big / 2 - 22 });
      } else if (points > 600 && r < 0.38) {
        enemies.push({ kind: 'spikeBall', x: this.awayFrom(x, 70, w) ?? (x < WIDTH / 2 ? WIDTH - 50 : 50), y: y + gap * 0.5, minX: 0, maxX: 0 });
      } else {
        const ex = this.between(50, WIDTH - 50);
        const kind: EnemyKind = this.chance(0.5) ? 'flyMan' : 'wingMan';
        enemies.push({ kind, x: ex, y: y + gap * this.between(0.3, 0.7) - 40, minX: 50, maxX: WIDTH - 50 });
      }
    }

    this.top = y;
    this.lastX = x;
    return { platforms, enemies };
  }

  /** An x for something `w` wide that doesn't overlap a platform `pw` wide at `px`. */
  private awayFrom(px: number, w: number, pw: number): number | undefined {
    const lo = w / 2 + 4;
    const hi = WIDTH - w / 2 - 4;
    const clear = (pw + w) / 2 + 24;
    const left = px - clear;
    const right = px + clear;
    const options: number[] = [];
    if (left >= lo) options.push(this.between(lo, left));
    if (right <= hi) options.push(this.between(right, hi));
    return options.length ? options[Math.floor(this.rand() * options.length)] : undefined;
  }
}
