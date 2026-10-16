/**
 * The tower defence rules with no three.js: the map and its path, waves of UFOs, towers, shots
 * and money. `game.ts` draws it; `scripts/check-waves.ts` plays it with a bot.
 *
 * World units are tiles: tile (col, row) is centred on x = col, z = row.
 */

export type Dir = 0 | 1 | 2 | 3;
const STEP: Record<Dir, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };
const GLYPHS: Record<string, Dir[]> = { '─': [1, 3], '│': [0, 2], '┌': [1, 2], '┐': [2, 3], '└': [0, 1], '┘': [0, 3] };

/** The map: S is where the UFOs come in, B the castle. Box-drawing glyphs are the path; * is scenery. */
export const MAP = [
  '   *         ',
  ' S───┐  ┌──┐ ',
  '     │* │  │ ',
  ' ┌───┘  │  │*',
  ' │    * │  │ ',
  ' │  ┌───┘  │ ',
  ' │  │   *  │ ',
  ' └──┘  ┌───┘ ',
  '  *    B     ',
];

export interface Cell {
  col: number;
  row: number;
}

export interface Level {
  cols: number;
  rows: number;
  /** Path tiles in order from the spawn to the castle, each with the sides it joins. */
  path: (Cell & { dirs: Dir[] })[];
  /** Where towers can go. */
  free: Cell[];
  scenery: Cell[];
  spawn: Cell;
  base: Cell;
}

export function parseMap(lines: string[]): Level {
  const rows = lines.length;
  const cols = Math.max(...lines.map((l) => [...l].length));
  const grid = lines.map((l) => [...l]);
  const g = (c: number, r: number) => grid[r]?.[c] ?? ' ';
  let spawn: Cell | undefined;
  let base: Cell | undefined;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (g(c, r) === 'S') spawn = { col: c, row: r };
    if (g(c, r) === 'B') base = { col: c, row: r };
  }
  if (!spawn || !base) throw new Error('map needs S and B');
  const sidesOf = (c: number, r: number): Dir[] => {
    const ch = g(c, r);
    if (GLYPHS[ch]) return GLYPHS[ch];
    if (ch === 'S' || ch === 'B') {
      return ([0, 1, 2, 3] as Dir[]).filter((d) => (GLYPHS[g(c + STEP[d][0], r + STEP[d][1])] ?? []).includes(((d + 2) % 4) as Dir));
    }
    return [];
  };
  const path: Level['path'] = [];
  let at = spawn;
  let from: Dir | undefined;
  const seen = new Set<string>();
  for (;;) {
    const key = `${at.col},${at.row}`;
    if (seen.has(key)) throw new Error('path loops');
    seen.add(key);
    const sides = sidesOf(at.col, at.row);
    path.push({ ...at, dirs: sides });
    if (at.col === base.col && at.row === base.row) break;
    const next = sides.find((d) => d !== from);
    if (next === undefined) throw new Error(`path stops at ${key}`);
    at = { col: at.col + STEP[next][0], row: at.row + STEP[next][1] };
    from = ((next + 2) % 4) as Dir;
  }
  const onPath = new Set(path.map((p) => `${p.col},${p.row}`));
  const free: Cell[] = [];
  const scenery: Cell[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (onPath.has(`${c},${r}`)) continue;
    if (g(c, r) === '*') scenery.push({ col: c, row: r });
    else free.push({ col: c, row: r });
  }
  return { cols, rows, path, free, scenery, spawn, base };
}

// ---- Path geometry -------------------------------------------------------------------------

/** The route along the path's centre line, rounding each corner on a quarter circle. */
export class Route {
  private pts: { x: number; z: number; s: number }[] = [];
  length = 0;

  constructor(level: Level) {
    const p = level.path;
    const add = (x: number, z: number) => {
      const last = this.pts[this.pts.length - 1];
      const s = last ? last.s + Math.hypot(x - last.x, z - last.z) : 0;
      this.pts.push({ x, z, s });
    };
    // Start off the far edge of the spawn tile.
    const [sx, sz] = STEP[p[0].dirs[0]];
    add(p[0].col - sx * 0.5, p[0].row - sz * 0.5);
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      const prev = p[i - 1];
      const next = p[i + 1];
      if (!prev || !next) {
        add(c.col, c.row);
        continue;
      }
      const inX = c.col - prev.col;
      const inZ = c.row - prev.row;
      const outX = next.col - c.col;
      const outZ = next.row - c.row;
      if (inX === outX && inZ === outZ) {
        add(c.col, c.row);
        continue;
      }
      // A corner: an arc from the middle of the side it comes in by to the side it leaves by.
      const ax = c.col - inX * 0.5;
      const az = c.row - inZ * 0.5;
      const bx = c.col + outX * 0.5;
      const bz = c.row + outZ * 0.5;
      const cx = ax + outX * 0.5;
      const cz = az + outZ * 0.5;
      for (let k = 0; k <= 8; k++) {
        const t = (k / 8) * (Math.PI / 2);
        add(cx + (ax - cx) * Math.cos(t) + (bx - cx) * Math.sin(t), cz + (az - cz) * Math.cos(t) + (bz - cz) * Math.sin(t));
      }
    }
    this.length = this.pts[this.pts.length - 1].s;
  }

  at(s: number) {
    const pts = this.pts;
    if (s <= 0) return { x: pts[0].x, z: pts[0].z };
    let lo = 0;
    let hi = pts.length - 1;
    if (s >= pts[hi].s) return { x: pts[hi].x, z: pts[hi].z };
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    const k = (s - a.s) / (b.s - a.s || 1);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  }
}

// ---- Units ---------------------------------------------------------------------------------

export type UfoKind = 'scout' | 'dart' | 'tank' | 'mother';
export const UFOS: Record<UfoKind, { model: string; hp: number; speed: number; reward: number; leak: number; size: number }> = {
  scout: { model: 'enemy-ufo-a', hp: 32, speed: 1.0, reward: 3, leak: 1, size: 0.55 },
  dart: { model: 'enemy-ufo-b', hp: 20, speed: 1.8, reward: 3, leak: 1, size: 0.5 },
  tank: { model: 'enemy-ufo-c', hp: 110, speed: 0.65, reward: 8, leak: 2, size: 0.7 },
  mother: { model: 'enemy-ufo-d', hp: 520, speed: 0.5, reward: 40, leak: 6, size: 1.05 },
};

export type TowerKind = 'turret' | 'cannon' | 'ballista' | 'catapult';
export const TOWERS: Record<TowerKind, { name: string; weapon: string; cost: number; range: number; every: number; damage: number; splash: number; speed: number; arc: number; ammo: string; note: string }> = {
  turret: { name: 'Turret', weapon: 'weapon-turret', cost: 50, range: 2.3, every: 0.33, damage: 5, splash: 0, speed: 9, arc: 0, ammo: 'weapon-ammo-bullet', note: 'quick shots' },
  cannon: { name: 'Cannon', weapon: 'weapon-cannon', cost: 80, range: 2.6, every: 1.1, damage: 24, splash: 0.85, speed: 5, arc: 0.6, ammo: 'weapon-ammo-cannonball', note: 'splash damage' },
  ballista: { name: 'Ballista', weapon: 'weapon-ballista', cost: 90, range: 4, every: 1.2, damage: 46, splash: 0, speed: 10, arc: 0, ammo: 'weapon-ammo-arrow', note: 'long range' },
  catapult: { name: 'Catapult', weapon: 'weapon-catapult', cost: 130, range: 4.6, every: 2.4, damage: 60, splash: 1.4, speed: 4, arc: 2, ammo: 'weapon-ammo-boulder', note: 'big splash' },
};
export const MAX_LEVEL = 3;
export const upgradeCost = (kind: TowerKind, level: number) => Math.round(TOWERS[kind].cost * (0.7 + level * 0.3));
/** Each level up: more damage, a little more range and a little faster. */
export const stats = (kind: TowerKind, level: number) => {
  const t = TOWERS[kind];
  return { ...t, damage: t.damage * (1 + (level - 1) * 0.55), range: t.range + (level - 1) * 0.35, every: t.every * (1 - (level - 1) * 0.1) };
};

export interface Ufo {
  id: number;
  kind: UfoKind;
  hp: number;
  maxHp: number;
  s: number;
  speed: number;
  /** Seconds since last hit, for a flash. */
  hitAt: number;
}

export interface Tower {
  id: number;
  kind: TowerKind;
  col: number;
  row: number;
  level: number;
  cooldown: number;
  /** Which way the weapon faces. */
  yaw: number;
  spent: number;
}

export interface Shot {
  id: number;
  kind: TowerKind;
  from: { x: number; y: number; z: number };
  to: { x: number; z: number };
  target: number;
  t: number;
  /** Flight time. */
  time: number;
  damage: number;
  splash: number;
  arc: number;
}

export type Event =
  | { type: 'fire'; tower: Tower; shot: Shot }
  | { type: 'hit'; shot: Shot; x: number; z: number; splash: boolean }
  | { type: 'kill'; ufo: Ufo; x: number; z: number; reward: number }
  | { type: 'leak'; ufo: Ufo }
  | { type: 'wave'; wave: number }
  | { type: 'cleared'; wave: number; bonus: number }
  | { type: 'over' }
  | { type: 'won' };

export const WAVES = 15;
export const START_COINS = 150;
export const LIVES = 20;
/** Height of a level-1 tower's weapon; each level adds a storey. */
export const TOWER_Y = 1.45;
export const UFO_Y = 0.65;

/** What a wave sends, and how far apart. */
export function waveOf(n: number): { kind: UfoKind; gap: number }[] {
  const out: { kind: UfoKind; gap: number }[] = [];
  const count = 8 + n * 2;
  for (let i = 0; i < count; i++) {
    let kind: UfoKind = 'scout';
    if (n >= 3 && i % 3 === 1) kind = 'dart';
    if (n >= 5 && i % 5 === 4) kind = 'tank';
    if (n >= 9 && i % 4 === 2) kind = 'tank';
    out.push({ kind, gap: kind === 'dart' ? 0.5 : 0.9 - Math.min(0.4, n * 0.03) });
  }
  // Every fifth wave, a mothership at the end.
  if (n % 5 === 0) for (let i = 0; i < n / 5; i++) out.push({ kind: 'mother', gap: 2 });
  return out;
}

/** UFOs get tougher each wave. */
export const hpScale = (wave: number) => 1 + (wave - 1) * 0.42 + Math.max(0, wave - 6) * 0.28;

export class Defense {
  level: Level;
  route: Route;
  coins = START_COINS;
  lives = LIVES;
  /** The wave under way (or last finished), from 1. */
  wave = 0;
  ufos: Ufo[] = [];
  towers: Tower[] = [];
  shots: Shot[] = [];
  /** Still to come out this wave. */
  queue: { kind: UfoKind; gap: number }[] = [];
  spawnIn = 0;
  running = false;
  ended?: 'over' | 'won';
  kills = 0;
  private nextId = 1;

  constructor(map: string[] = MAP) {
    this.level = parseMap(map);
    this.route = new Route(this.level);
  }

  canBuild(col: number, row: number) {
    return this.level.free.some((c) => c.col === col && c.row === row) && !this.towers.some((t) => t.col === col && t.row === row);
  }

  build(kind: TowerKind, col: number, row: number): Tower | undefined {
    const cost = TOWERS[kind].cost;
    if (this.coins < cost || !this.canBuild(col, row)) return undefined;
    this.coins -= cost;
    const t: Tower = { id: this.nextId++, kind, col, row, level: 1, cooldown: 0, yaw: 0, spent: cost };
    this.towers.push(t);
    return t;
  }

  upgrade(t: Tower) {
    if (t.level >= MAX_LEVEL) return false;
    const cost = upgradeCost(t.kind, t.level);
    if (this.coins < cost) return false;
    this.coins -= cost;
    t.spent += cost;
    t.level++;
    return true;
  }

  sell(t: Tower) {
    const refund = Math.floor(t.spent * 0.7);
    this.coins += refund;
    this.towers.splice(this.towers.indexOf(t), 1);
    return refund;
  }

  /** Starts the next wave; calling it early (while one is still out) pays a bonus. */
  sendWave(): Event[] {
    if (this.ended || this.wave >= WAVES) return [];
    const early = this.running ? Math.max(0, Math.round(this.queue.length + this.ufos.length)) : 0;
    this.wave++;
    this.queue.push(...waveOf(this.wave));
    this.running = true;
    this.coins += early;
    return [{ type: 'wave', wave: this.wave }];
  }

  ufoPos(u: Ufo) {
    return this.route.at(u.s);
  }

  step(dt: number): Event[] {
    const ev: Event[] = [];
    if (this.ended) return ev;
    // Spawn.
    if (this.queue.length) {
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) {
        const next = this.queue.shift()!;
        const def = UFOS[next.kind];
        const hp = Math.round(def.hp * hpScale(this.wave));
        this.ufos.push({ id: this.nextId++, kind: next.kind, hp, maxHp: hp, s: 0, speed: def.speed, hitAt: 9 });
        this.spawnIn = next.gap;
      }
    }
    // Move.
    for (const u of [...this.ufos]) {
      u.s += u.speed * dt;
      u.hitAt += dt;
      if (u.s >= this.route.length) {
        this.ufos.splice(this.ufos.indexOf(u), 1);
        this.lives = Math.max(0, this.lives - UFOS[u.kind].leak);
        ev.push({ type: 'leak', ufo: u });
      }
    }
    // Towers pick the UFO furthest along within range.
    for (const t of this.towers) {
      t.cooldown -= dt;
      const st = stats(t.kind, t.level);
      let best: Ufo | undefined;
      for (const u of this.ufos) {
        const p = this.ufoPos(u);
        if (Math.hypot(p.x - t.col, p.z - t.row) > st.range) continue;
        if (!best || u.s > best.s) best = u;
      }
      if (!best) continue;
      const p = this.ufoPos(best);
      t.yaw = Math.atan2(p.x - t.col, p.z - t.row);
      if (t.cooldown > 0) continue;
      t.cooldown = st.every;
      // Lead the target: where it'll be when the shot lands.
      const dist = Math.hypot(p.x - t.col, p.z - t.row);
      const time = dist / st.speed + st.arc * 0.25;
      const lead = this.route.at(best.s + best.speed * time);
      const shot: Shot = {
        id: this.nextId++, kind: t.kind, from: { x: t.col, y: TOWER_Y + (t.level - 1) * 0.55, z: t.row },
        to: st.splash ? lead : p, target: best.id, t: 0, time, damage: st.damage, splash: st.splash, arc: st.arc,
      };
      this.shots.push(shot);
      ev.push({ type: 'fire', tower: t, shot });
    }
    // Shots: direct ones follow their target; lobbed ones land where they were aimed.
    for (const s of [...this.shots]) {
      s.t += dt;
      if (!s.splash) {
        const u = this.ufos.find((x) => x.id === s.target);
        if (u) s.to = this.ufoPos(u);
      }
      if (s.t < s.time) continue;
      this.shots.splice(this.shots.indexOf(s), 1);
      ev.push({ type: 'hit', shot: s, x: s.to.x, z: s.to.z, splash: s.splash > 0 });
      const victims = s.splash
        ? this.ufos.filter((u) => {
            const p = this.ufoPos(u);
            return Math.hypot(p.x - s.to.x, p.z - s.to.z) <= s.splash;
          })
        : this.ufos.filter((u) => u.id === s.target);
      for (const u of victims) {
        u.hp -= s.damage;
        u.hitAt = 0;
        if (u.hp <= 0) {
          this.ufos.splice(this.ufos.indexOf(u), 1);
          const reward = UFOS[u.kind].reward;
          this.coins += reward;
          this.kills++;
          const p = this.ufoPos(u);
          ev.push({ type: 'kill', ufo: u, x: p.x, z: p.z, reward });
        }
      }
    }
    if (this.lives <= 0) {
      this.ended = 'over';
      ev.push({ type: 'over' });
      return ev;
    }
    if (this.running && !this.queue.length && !this.ufos.length) {
      this.running = false;
      const bonus = 10 + this.wave * 3;
      this.coins += bonus;
      ev.push({ type: 'cleared', wave: this.wave, bonus });
      if (this.wave >= WAVES) {
        this.ended = 'won';
        ev.push({ type: 'won' });
      }
    }
    return ev;
  }

  /** Final score: kills, lives saved and coins left. */
  get score() {
    return this.kills * 10 + this.lives * 50 + (this.ended === 'won' ? 500 + this.coins : 0) + (this.wave - 1) * 40;
  }
}
