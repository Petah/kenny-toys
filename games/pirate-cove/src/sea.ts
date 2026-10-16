/**
 * The sea battle with no three.js: ships under sail, broadsides, cannonballs, islands to steer
 * round, navy ships that hunt you, and gold to scoop up. `game.ts` draws it; the checker runs it.
 *
 * World units: a small ship is about 9 long. Heading 0 sails towards +z; a ship's port (left)
 * side faces heading - 90°, starboard (right) heading + 90° (seen from above, x to the right).
 */

export type Side = 'left' | 'right';
export type ShipKind = 'pirate' | 'small' | 'medium' | 'large';

export const SHIPS: Record<ShipKind, { hp: number; guns: number; length: number; beam: number; top: number; turn: number; gold: number; reload: number }> = {
  pirate: { hp: 24, guns: 3, length: 8.8, beam: 4.4, top: 15, turn: 1.0, gold: 0, reload: 2.2 },
  small: { hp: 5, guns: 2, length: 8.8, beam: 4.4, top: 11, turn: 0.9, gold: 25, reload: 5 },
  medium: { hp: 9, guns: 3, length: 10.6, beam: 4.6, top: 10, turn: 0.75, gold: 50, reload: 5 },
  large: { hp: 15, guns: 4, length: 13, beam: 4.8, top: 9, turn: 0.6, gold: 100, reload: 4.5 },
};

export interface Ship {
  id: number;
  kind: ShipKind;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** 0 to 1: how much sail is set. */
  sail: number;
  /** -1 to 1: rudder. */
  turn: number;
  hp: number;
  reload: Record<Side, number>;
  /** Seconds since it started sinking (undefined while afloat). */
  sinking?: number;
  /** AI: where it's patrolling to. */
  goal?: { x: number; z: number };
  bumped: number;
  hitAt: number;
}

export interface Ball {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface Island {
  x: number;
  z: number;
  r: number;
  /** A fort on it that shoots at you. */
  fort?: { hp: number; reload: number; dead: boolean };
}

export interface Loot {
  id: number;
  x: number;
  z: number;
  /** Gold, or a crate of timber that patches the hull. */
  kind: 'gold' | 'repair';
  value: number;
  /** Drifts and bobs; gone after a while. */
  life: number;
}

export type Event =
  | { type: 'fire'; ship: Ship; side: Side; balls: Ball[] }
  | { type: 'fortFire'; island: Island; ball: Ball }
  | { type: 'hit'; ship: Ship; ball: Ball }
  | { type: 'fortHit'; island: Island; ball: Ball }
  | { type: 'splash'; ball: Ball }
  | { type: 'sink'; ship: Ship }
  | { type: 'fortDown'; island: Island }
  | { type: 'loot'; loot: Loot }
  | { type: 'bump'; ship: Ship }
  | { type: 'spawn'; ship: Ship }
  | { type: 'over' };

export const WORLD = 170;
export const ROUND = 150;
export const BALL_SPEED = 34;
export const BALL_LIFT = 4.2;
export const GRAVITY = 9.8;
export const DECK = 2.2;

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Islands laid out round the middle, leaving open water to sail in. */
export function makeIslands(rand: () => number): Island[] {
  const out: Island[] = [];
  for (let tries = 0; out.length < 11 && tries < 500; tries++) {
    const r = 7 + rand() * 9;
    const a = rand() * Math.PI * 2;
    const d = 30 + rand() * (WORLD - 45);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 22)) continue;
    out.push({ x, z, r, fort: out.length % 3 === 1 ? { hp: 8, reload: 2, dead: false } : undefined });
  }
  return out;
}

export class Sea {
  ships: Ship[] = [];
  balls: Ball[] = [];
  islands: Island[];
  loot: Loot[] = [];
  time = ROUND;
  gold = 0;
  sunk = 0;
  over = false;
  player: Ship;
  private nextId = 1;
  private spawnIn = 6;
  private rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.islands = makeIslands(rand);
    this.player = this.addShip('pirate', 0, 0, 0);
    this.player.sail = 0.6;
    for (let i = 0; i < 3; i++) this.spawnNavy(i === 2 ? 'medium' : 'small');
    for (let i = 0; i < 6; i++) this.dropLoot((this.rand() - 0.5) * WORLD * 1.4, (this.rand() - 0.5) * WORLD * 1.4, 10);
  }

  private addShip(kind: ShipKind, x: number, z: number, heading: number): Ship {
    const s: Ship = { id: this.nextId++, kind, x, z, heading, speed: 0, sail: 0.5, turn: 0, hp: SHIPS[kind].hp, reload: { left: 0, right: 0 }, bumped: 0, hitAt: 9 };
    this.ships.push(s);
    return s;
  }

  /** A navy ship sails in from somewhere out of sight. */
  spawnNavy(kind: ShipKind) {
    for (let tries = 0; tries < 30; tries++) {
      const a = this.rand() * Math.PI * 2;
      const d = 80 + this.rand() * 60;
      const x = this.player.x + Math.cos(a) * d;
      const z = this.player.z + Math.sin(a) * d;
      if (Math.abs(x) > WORLD || Math.abs(z) > WORLD) continue;
      if (this.islands.some((i) => Math.hypot(i.x - x, i.z - z) < i.r + 8)) continue;
      const s = this.addShip(kind, x, z, this.rand() * Math.PI * 2);
      return s;
    }
    return undefined;
  }

  private dropLoot(x: number, z: number, value: number, kind: Loot['kind'] = 'gold') {
    if (this.islands.some((i) => Math.hypot(i.x - x, i.z - z) < i.r + 3)) return;
    this.loot.push({ id: this.nextId++, x, z, kind, value, life: 45 });
  }

  /** Fires one side's guns, spread along the hull. */
  fire(s: Ship, side: Side): Ball[] {
    if (s.reload[side] > 0 || s.sinking !== undefined) return [];
    const def = SHIPS[s.kind];
    s.reload[side] = def.reload;
    const out: Ball[] = [];
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const { x: ox, z: oz } = Sea.sideDir(s, side);
    for (let g = 0; g < def.guns; g++) {
      const along = ((g + 0.5) / def.guns - 0.5) * def.length * 0.6;
      // Navy gunners are less steady than yours.
      const spread = (this.rand() - 0.5) * (s.kind === 'pirate' ? 0.08 : 0.3);
      const dx = ox * Math.cos(spread) - oz * Math.sin(spread);
      const dz = ox * Math.sin(spread) + oz * Math.cos(spread);
      const b: Ball = {
        id: this.nextId++, owner: s.id,
        x: s.x + fx * along + dx * def.beam * 0.5, y: DECK, z: s.z + fz * along + dz * def.beam * 0.5,
        vx: dx * BALL_SPEED + fx * s.speed, vy: BALL_LIFT + (this.rand() - 0.5) * 0.6, vz: dz * BALL_SPEED + fz * s.speed,
      };
      out.push(b);
      this.balls.push(b);
    }
    return out;
  }

  /** Which way a side's guns point: port is on the left looking forward, from above. */
  static sideDir(s: Ship, side: Side) {
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    return side === 'left' ? { x: fz, z: -fx } : { x: -fz, z: fx };
  }

  /** The side facing a point, for clicking on the water to fire. */
  sideFacing(s: Ship, x: number, z: number): Side {
    const l = Sea.sideDir(s, 'left');
    return (x - s.x) * l.x + (z - s.z) * l.z > 0 ? 'left' : 'right';
  }

  step(dt: number): Event[] {
    const ev: Event[] = [];
    if (this.over) return ev;
    this.time = Math.max(0, this.time - dt);
    for (const s of this.ships) {
      if (s.sinking !== undefined) {
        s.sinking += dt;
        s.speed *= 1 - dt;
        continue;
      }
      if (s !== this.player) this.think(s, dt, ev);
      const def = SHIPS[s.kind];
      const target = def.top * s.sail;
      s.speed += (target - s.speed) * Math.min(1, dt * 0.6);
      // Rudder bites harder with way on.
      s.heading = wrapAngle(s.heading + s.turn * def.turn * dt * Math.min(1, 0.35 + s.speed / def.top));
      s.x += Math.sin(s.heading) * s.speed * dt;
      s.z += Math.cos(s.heading) * s.speed * dt;
      for (const side of ['left', 'right'] as Side[]) s.reload[side] = Math.max(0, s.reload[side] - dt);
      s.bumped = Math.max(0, s.bumped - dt);
      s.hitAt += dt;
      // Islands and the edge of the world push back.
      for (const i of this.islands) {
        const d = Math.hypot(s.x - i.x, s.z - i.z);
        const min = i.r + def.beam * 0.6;
        if (d < min) {
          const nx = (s.x - i.x) / (d || 1);
          const nz = (s.z - i.z) / (d || 1);
          s.x = i.x + nx * min;
          s.z = i.z + nz * min;
          if (s.speed > 6 && s.bumped <= 0) {
            s.hp -= 1;
            s.hitAt = 0;
            s.bumped = 1.5;
            ev.push({ type: 'bump', ship: s });
          }
          s.speed *= 0.5;
        }
      }
      const edge = WORLD + 10;
      if (Math.abs(s.x) > edge) s.x = Math.sign(s.x) * edge;
      if (Math.abs(s.z) > edge) s.z = Math.sign(s.z) * edge;
    }
    // Ships nudge each other apart.
    for (const a of this.ships) for (const b of this.ships) {
      if (a.id >= b.id || a.sinking !== undefined || b.sinking !== undefined) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      const min = (SHIPS[a.kind].length + SHIPS[b.kind].length) * 0.35;
      if (d < min && d > 0) {
        const push = (min - d) / 2;
        a.x += ((a.x - b.x) / d) * push;
        a.z += ((a.z - b.z) / d) * push;
        b.x -= ((a.x - b.x) / d) * push;
        b.z -= ((a.z - b.z) / d) * push;
      }
    }
    this.stepForts(dt, ev);
    this.stepBalls(dt, ev);
    // Loot: drifts, and the pirate scoops up what it sails over.
    for (const l of [...this.loot]) {
      l.life -= dt;
      const p = this.player;
      if (p.sinking === undefined && Math.hypot(l.x - p.x, l.z - p.z) < 6) {
        if (l.kind === 'repair') p.hp = Math.min(SHIPS.pirate.hp, p.hp + l.value);
        else this.gold += l.value;
        this.loot.splice(this.loot.indexOf(l), 1);
        ev.push({ type: 'loot', loot: l });
      } else if (l.life <= 0) this.loot.splice(this.loot.indexOf(l), 1);
    }
    // Wrecks go under, and more navy ships come, bigger as time goes on.
    this.ships = this.ships.filter((s) => s.sinking === undefined || s.sinking < 6 || s === this.player);
    const navy = this.ships.filter((s) => s !== this.player && s.sinking === undefined).length;
    this.spawnIn -= dt;
    const want = 3 + Math.floor((ROUND - this.time) / 50);
    if (navy < want && this.spawnIn <= 0) {
      const t = (ROUND - this.time) / ROUND;
      const r = this.rand();
      const kind: ShipKind = r < 0.15 + t * 0.3 ? 'large' : r < 0.5 + t * 0.2 ? 'medium' : 'small';
      const s = this.spawnNavy(kind);
      if (s) ev.push({ type: 'spawn', ship: s });
      this.spawnIn = 7;
    }
    if (!this.over && (this.time <= 0 || this.player.sinking !== undefined)) {
      if (this.time <= 0 || this.player.sinking! > 2.5) {
        this.over = true;
        ev.push({ type: 'over' });
      }
    }
    return ev;
  }

  /** Navy captains: patrol, and when the pirate's near, swing round to bring their guns to bear. */
  private think(s: Ship, _dt: number, ev: Event[]) {
    const p = this.player;
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    const dist = Math.hypot(dx, dz);
    let want: number;
    if (dist < 75 && p.sinking === undefined) {
      const bearing = Math.atan2(dx, dz);
      // Close in when far; when in range, turn side-on.
      if (dist > 36) want = bearing;
      else {
        const a = wrapAngle(bearing - Math.PI / 2 - s.heading);
        const b = wrapAngle(bearing + Math.PI / 2 - s.heading);
        want = s.heading + (Math.abs(a) < Math.abs(b) ? a : b);
        if (dist < 16) want += Math.PI / 4;
      }
      s.sail = dist > 36 ? 0.85 : 0.5;
      // Fire when the pirate's off the beam and in range.
      for (const side of ['left', 'right'] as Side[]) {
        const dir = Sea.sideDir(s, side);
        const cos = (dx * dir.x + dz * dir.z) / (dist || 1);
        if (cos > 0.95 && dist < 34 && s.reload[side] <= 0) {
          const balls = this.fire(s, side);
          if (balls.length) ev.push({ type: 'fire', ship: s, side, balls });
        }
      }
    } else {
      if (!s.goal || Math.hypot(s.goal.x - s.x, s.goal.z - s.z) < 10) {
        s.goal = { x: (this.rand() - 0.5) * WORLD * 1.6, z: (this.rand() - 0.5) * WORLD * 1.6 };
      }
      want = Math.atan2(s.goal.x - s.x, s.goal.z - s.z);
      s.sail = 0.5;
    }
    // Steer clear of islands ahead.
    for (const i of this.islands) {
      const ax = s.x + Math.sin(s.heading) * 14;
      const az = s.z + Math.cos(s.heading) * 14;
      if (Math.hypot(ax - i.x, az - i.z) < i.r + 5) {
        const away = Math.atan2(s.x - i.x, s.z - i.z);
        want = s.heading + Math.sign(wrapAngle(away - s.heading) || 1) * 1.2;
      }
    }
    const d = wrapAngle(want - s.heading);
    s.turn = Math.max(-1, Math.min(1, d * 2));
  }

  private stepForts(dt: number, ev: Event[]) {
    const p = this.player;
    for (const i of this.islands) {
      const f = i.fort;
      if (!f || f.dead || p.sinking !== undefined) continue;
      f.reload -= dt;
      const dx = p.x - i.x;
      const dz = p.z - i.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 48 || f.reload > 0) continue;
      f.reload = 5;
      // Lob it at where the ship's heading.
      const time = dist / BALL_SPEED;
      // Fort gunners guess at the lead, and not very well.
      const tx = p.x + Math.sin(p.heading) * p.speed * time * this.rand() * 1.4 + (this.rand() - 0.5) * 8;
      const tz = p.z + Math.cos(p.heading) * p.speed * time * this.rand() * 1.4 + (this.rand() - 0.5) * 8;
      const tdx = tx - i.x;
      const tdz = tz - i.z;
      const td = Math.hypot(tdx, tdz) || 1;
      const flight = td / BALL_SPEED;
      const ball: Ball = {
        id: this.nextId++, owner: -1, x: i.x + (tdx / td) * i.r * 0.5, y: 6, z: i.z + (tdz / td) * i.r * 0.5,
        vx: (tdx / td) * BALL_SPEED, vy: (0.5 * GRAVITY * flight * flight - 4) / flight, vz: (tdz / td) * BALL_SPEED,
      };
      this.balls.push(ball);
      ev.push({ type: 'fortFire', island: i, ball });
    }
  }

  private stepBalls(dt: number, ev: Event[]) {
    for (const b of [...this.balls]) {
      b.vy -= GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      let gone = false;
      for (const s of this.ships) {
        if (s.id === b.owner || s.sinking !== undefined || b.y > 6) continue;
        // In the ship's own frame: along its length and across its beam.
        const dx = b.x - s.x;
        const dz = b.z - s.z;
        const fx = Math.sin(s.heading);
        const fz = Math.cos(s.heading);
        const along = dx * fx + dz * fz;
        const across = dx * fz - dz * fx;
        const def = SHIPS[s.kind];
        if (Math.abs(along) < def.length / 2 && Math.abs(across) < def.beam / 2 + 0.3) {
          // Navy ships don't hurt each other.
          const owner = this.ships.find((o) => o.id === b.owner);
          if (owner && owner !== this.player && s !== this.player) continue;
          s.hp -= 1;
          s.hitAt = 0;
          ev.push({ type: 'hit', ship: s, ball: b });
          if (s.hp <= 0) {
            s.sinking = 0;
            ev.push({ type: 'sink', ship: s });
            if (s !== this.player) {
              this.sunk++;
              this.gold += SHIPS[s.kind].gold;
              for (let k = 0; k < 2 + SHIPS[s.kind].guns; k++) this.dropLoot(s.x + (this.rand() - 0.5) * 10, s.z + (this.rand() - 0.5) * 10, 5);
              this.dropLoot(s.x + (this.rand() - 0.5) * 6, s.z + (this.rand() - 0.5) * 6, 4, 'repair');
            }
          }
          gone = true;
          break;
        }
      }
      if (!gone && b.owner === this.player.id) {
        for (const i of this.islands) {
          if (!i.fort || i.fort.dead || b.y > 9) continue;
          if (Math.hypot(b.x - i.x, b.z - i.z) < 3.2) {
            i.fort.hp -= 1;
            ev.push({ type: 'fortHit', island: i, ball: b });
            if (i.fort.hp <= 0) {
              i.fort.dead = true;
              this.gold += 75;
              ev.push({ type: 'fortDown', island: i });
            }
            gone = true;
            break;
          }
        }
      }
      if (!gone && b.y <= 0) {
        gone = true;
        ev.push({ type: 'splash', ball: b });
      }
      if (gone) this.balls.splice(this.balls.indexOf(b), 1);
    }
  }
}
