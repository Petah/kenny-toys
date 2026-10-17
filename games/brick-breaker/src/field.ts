/**
 * The brick field with no Phaser: levels drawn as letter maps, bricks, balls bouncing off walls,
 * bricks and the paddle. `BreakScene` draws it; `scripts/check-levels.ts` plays it with a bot.
 *
 * Units are pixels of the playfield: COLS columns of CELL wide, rows ROW tall (a brick's body;
 * its studs poke up into the row above, under the brick stacked there).
 */

export const COLS = 12;
export const CELL = 32;
export const ROW = 14;
export const WIDTH = COLS * CELL;
export const HEIGHT = 600;
/** Where the paddle's top sits. */
export const PADDLE_Y = HEIGHT - 40;
export const BALL_R = 7;
export const TOP = 40;

export type Colour = 'Red' | 'Yellow' | 'Blue' | 'Green' | 'White' | 'Black';
export const COLOURS: Record<string, Colour> = { r: 'Red', y: 'Yellow', b: 'Blue', g: 'Green', w: 'White', k: 'Black' };
/** Special blocks: two columns wide, four rows tall. Digits for the characters, so capital colour letters stay free. */
export const SPECIALS: Record<string, { frame: string; power?: Power; hp: number; solid?: boolean; explode?: boolean }> = {
  '1': { frame: 'extra_character_a', power: 'multi', hp: 1 },
  '2': { frame: 'extra_character_b', power: 'wide', hp: 1 },
  '3': { frame: 'extra_character_c', power: 'slow', hp: 1 },
  '4': { frame: 'extra_character_d', power: 'life', hp: 1 },
  X: { frame: 'extra_crate_explosive', hp: 1, explode: true },
  S: { frame: 'extra_stone', hp: 0, solid: true },
};
export type Power = 'multi' | 'wide' | 'slow' | 'life';

export interface Brick {
  id: number;
  /** Body rectangle. */
  x: number;
  y: number;
  w: number;
  h: number;
  colour?: Colour;
  special?: string;
  /** Hits left; stone has 0 and never breaks. */
  hp: number;
  units: number;
  rows: number;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  stuck: boolean;
}

export interface Drop {
  id: number;
  x: number;
  y: number;
  power: Power;
}

/**
 * Reads a level map: one character per column; runs of a colour letter join into the longest bricks
 * the pack has. Lower and upper case are the same colour but separate runs, so rows can be laid
 * staggered like a real wall ('rrRRRRrr' is a 2, a 4 and a 2).
 */
export function parseLevel(lines: string[]): Brick[] {
  const out: Brick[] = [];
  let id = 1;
  const taken = new Set<string>();
  lines.forEach((line, row) => {
    const chars = [...line.padEnd(COLS, ' ')].slice(0, COLS);
    let c = 0;
    while (c < COLS) {
      const ch = chars[c];
      if (taken.has(`${c},${row}`) || ch === ' ' || ch === '.') {
        c++;
        continue;
      }
      if (SPECIALS[ch]) {
        // Specials fill a 2×4 block from their top-left.
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) taken.add(`${c + dx},${row + dy}`);
        out.push({ id: id++, x: c * CELL, y: TOP + row * ROW, w: CELL * 2, h: ROW * 4, special: ch, hp: SPECIALS[ch].hp, units: 2, rows: 4 });
        c += 2;
        continue;
      }
      const colour = COLOURS[ch.toLowerCase()];
      if (!colour) throw new Error(`unknown brick '${ch}' at ${c},${row}`);
      let run = 0;
      while (c + run < COLS && chars[c + run] === ch && !taken.has(`${c + run},${row}`)) run++;
      // Biggest pieces first: 6, 4, 2, 1 studs.
      let left = run;
      while (left > 0) {
        const size = [6, 4, 2, 1].find((s) => s <= left)!;
        out.push({ id: id++, x: c * CELL, y: TOP + row * ROW, w: size * CELL, h: ROW, colour, hp: colour === 'Black' ? 2 : 1, units: size, rows: 1 });
        c += size;
        left -= size;
      }
    }
  });
  return out;
}

export interface StepEvents {
  hits: { brick: Brick; broke: boolean; ball: Ball }[];
  walls: number;
  paddle: Ball[];
  lost: Ball[];
  explode: Brick[];
}

/** Moves a ball by up to its velocity × dt, bouncing off everything; returns what it touched. */
export function moveBall(b: Ball, dt: number, bricks: Brick[], paddle: { x: number; w: number }, ev: StepEvents) {
  if (b.stuck) return;
  const speed = Math.hypot(b.vx, b.vy);
  const steps = Math.max(1, Math.ceil((speed * dt) / 3));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    b.x += b.vx * h;
    b.y += b.vy * h;
    // Walls and ceiling.
    if (b.x < BALL_R) {
      b.x = BALL_R;
      b.vx = Math.abs(b.vx);
      ev.walls++;
    } else if (b.x > WIDTH - BALL_R) {
      b.x = WIDTH - BALL_R;
      b.vx = -Math.abs(b.vx);
      ev.walls++;
    }
    if (b.y < TOP - ROW + BALL_R) {
      b.y = TOP - ROW + BALL_R;
      b.vy = Math.abs(b.vy);
      ev.walls++;
    }
    // The paddle: where it hits sets the angle it goes back up at.
    if (b.vy > 0 && b.y + BALL_R >= PADDLE_Y && b.y + BALL_R <= PADDLE_Y + 14 && Math.abs(b.x - paddle.x) <= paddle.w / 2 + BALL_R) {
      const off = Math.max(-1, Math.min(1, (b.x - paddle.x) / (paddle.w / 2)));
      const angle = off * (Math.PI / 3);
      b.vx = Math.sin(angle) * speed;
      b.vy = -Math.cos(angle) * speed;
      b.y = PADDLE_Y - BALL_R;
      ev.paddle.push(b);
    }
    // Bricks: push out along the shallower overlap and bounce.
    for (const k of bricks) {
      if (k.hp < 0) continue;
      const cx = Math.max(k.x, Math.min(b.x, k.x + k.w));
      const cy = Math.max(k.y, Math.min(b.y, k.y + k.h));
      const dx = b.x - cx;
      const dy = b.y - cy;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
      const overlapX = Math.min(b.x + BALL_R - k.x, k.x + k.w - (b.x - BALL_R));
      const overlapY = Math.min(b.y + BALL_R - k.y, k.y + k.h - (b.y - BALL_R));
      if (overlapX < overlapY) {
        b.vx = b.x < k.x + k.w / 2 ? -Math.abs(b.vx) : Math.abs(b.vx);
        b.x += b.vx > 0 ? overlapX : -overlapX;
      } else {
        b.vy = b.y < k.y + k.h / 2 ? -Math.abs(b.vy) : Math.abs(b.vy);
        b.y += b.vy > 0 ? overlapY : -overlapY;
      }
      let broke = false;
      if (k.hp > 0) {
        k.hp--;
        if (k.hp === 0) {
          k.hp = -1;
          broke = true;
        }
      }
      ev.hits.push({ brick: k, broke, ball: b });
      break;
    }
    if (b.y > HEIGHT + 20) {
      ev.lost.push(b);
      return;
    }
  }
}

/** An explosive crate takes everything within reach with it (except stone). */
export function blast(at: Brick, bricks: Brick[]): Brick[] {
  const out: Brick[] = [];
  const cx = at.x + at.w / 2;
  const cy = at.y + at.h / 2;
  for (const k of bricks) {
    if (k === at || k.hp <= 0) continue;
    const nx = Math.max(k.x, Math.min(cx, k.x + k.w));
    const ny = Math.max(k.y, Math.min(cy, k.y + k.h));
    if (Math.hypot(nx - cx, ny - cy) < 70) {
      k.hp = -1;
      out.push(k);
    }
  }
  return out;
}

/** Bricks still to break (stone doesn't count). */
export const remaining = (bricks: Brick[]) => bricks.filter((k) => k.hp > 0).length;

/** Everything that goes when `k` breaks: itself and, for an explosive crate, what its blast takes, chaining through other crates. */
export function chain(k: Brick, bricks: Brick[]): Brick[] {
  const out = [k];
  for (let i = 0; i < out.length; i++) {
    if (out[i].special && SPECIALS[out[i].special!].explode) out.push(...blast(out[i], bricks));
  }
  return out;
}
