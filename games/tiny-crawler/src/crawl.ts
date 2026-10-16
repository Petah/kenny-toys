/**
 * The dungeon's rules with no Phaser: one room per floor, a hero, monsters taking turns,
 * chests (some of them mimics), potions and weapons. Each action returns the events it caused
 * for the scene to animate. `scripts/check-crawl.ts` plays it with a bot.
 *
 * Positions are floor tiles inside the room: x from 0 to W - 1, y from 0 (by the top wall,
 * where the door is) to H - 1.
 */

/** Room size in floor tiles, wide by default; tall screens get a tall room. */
export const W = 11;
export const H = 8;

export interface Pos {
  x: number;
  y: number;
}

export type MonsterKind = 'rat' | 'bat' | 'spider' | 'slime' | 'ghost' | 'orc' | 'cyclops' | 'demon' | 'mimic';
export const MONSTERS: Record<MonsterKind, { tile: number; hp: number; atk: number; from: number; name: string; xp: number }> = {
  rat: { tile: 123, hp: 1, atk: 1, from: 1, name: 'rat', xp: 1 },
  bat: { tile: 120, hp: 1, atk: 1, from: 1, name: 'bat', xp: 1 },
  spider: { tile: 122, hp: 2, atk: 1, from: 2, name: 'spider', xp: 2 },
  slime: { tile: 108, hp: 3, atk: 1, from: 2, name: 'slime', xp: 2 },
  ghost: { tile: 121, hp: 2, atk: 1, from: 3, name: 'ghost', xp: 3 },
  orc: { tile: 112, hp: 3, atk: 2, from: 4, name: 'orc', xp: 4 },
  cyclops: { tile: 109, hp: 5, atk: 2, from: 6, name: 'cyclops', xp: 6 },
  demon: { tile: 110, hp: 6, atk: 3, from: 8, name: 'demon', xp: 8 },
  mimic: { tile: 92, hp: 3, atk: 2, from: 99, name: 'mimic', xp: 5 },
};

export type ItemKind = 'red' | 'blue' | 'sword' | 'axe' | 'hammer' | 'shield' | 'gold';
export const ITEMS: Record<ItemKind, { tile: number; name: string }> = {
  red: { tile: 115, name: 'red potion' },
  blue: { tile: 116, name: 'blue potion' },
  sword: { tile: 104, name: 'sword' },
  axe: { tile: 118, name: 'axe' },
  hammer: { tile: 117, name: 'war hammer' },
  shield: { tile: 102, name: 'shield' },
  gold: { tile: 0, name: 'gold' },
};
/** Attack each weapon gives. */
export const WEAPON_ATK: Record<string, number> = { fists: 1, sword: 2, axe: 3, hammer: 4 };
/** Scenery that blocks the way: barrels, tables, gravestones. */
export const OBSTACLES = [82, 72, 64, 65, 66, 74];

export interface Monster {
  id: number;
  kind: MonsterKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  /** Slimes and cyclopes move every other turn. */
  tick: number;
}

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  amount: number;
}

export interface Chest {
  id: number;
  x: number;
  y: number;
  mimic: boolean;
  opened: boolean;
  /** What's inside a real chest. */
  loot: { kind: ItemKind; amount: number };
}

export interface Hero {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  weapon: 'fists' | 'sword' | 'axe' | 'hammer';
  /** Hits the shield will still soak up. */
  shield: number;
  gold: number;
  kills: number;
}

export type Event =
  | { type: 'move'; who: 'hero' | number; from: Pos; to: Pos }
  | { type: 'bump'; at: Pos }
  | { type: 'attack'; by: 'hero' | number; at: Pos; target: 'hero' | number; damage: number; blocked: boolean; killed: boolean }
  | { type: 'pickup'; item: Item }
  | { type: 'open'; chest: Chest }
  | { type: 'mimic'; chest: Chest; monster: Monster }
  | { type: 'door' }
  | { type: 'descend'; floor: number }
  | { type: 'dead' };

const DIRS: Pos[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
const key = (p: Pos) => `${p.x},${p.y}`;

export class Crawl {
  floor = 1;
  hero: Hero = { x: 0, y: 0, hp: 10, maxHp: 10, weapon: 'fists', shield: 0, gold: 0, kills: 0 };
  monsters: Monster[] = [];
  items: Item[] = [];
  chests: Chest[] = [];
  /** Blocking scenery: tile number at each spot. */
  obstacles = new Map<string, number>();
  /** The door's column in the top wall, and whether it's open. */
  doorX = 5;
  doorOpen = false;
  dead = false;
  turn = 0;
  private nextId = 1;
  private rand: () => number;
  w: number;
  h: number;

  constructor(rand: () => number = Math.random, w = W, h = H) {
    this.rand = rand;
    this.w = w;
    this.h = h;
    this.hero.x = Math.floor(w / 2);
    this.hero.y = h - 1;
    this.buildFloor();
  }

  private r(n: number) {
    return Math.floor(this.rand() * n);
  }

  /** Total score: gold, kills and how deep you got. */
  get score() {
    return this.hero.gold + this.hero.kills * 5 + (this.floor - 1) * 25;
  }

  inside(p: Pos) {
    return p.x >= 0 && p.y >= 0 && p.x < this.w && p.y < this.h;
  }

  monsterAt(p: Pos) {
    return this.monsters.find((m) => m.x === p.x && m.y === p.y);
  }

  chestAt(p: Pos) {
    return this.chests.find((c) => !c.opened && c.x === p.x && c.y === p.y);
  }

  /** Can something walk here (ghosts can float over scenery)? */
  private open(p: Pos, ghost = false) {
    if (!this.inside(p)) return false;
    if (!ghost && this.obstacles.has(key(p))) return false;
    if (this.chestAt(p)) return false;
    return true;
  }

  /** Lays out a fresh room: scenery that never cuts the room in two, monsters, loot and a door. */
  buildFloor() {
    const n = this.floor;
    this.monsters = [];
    this.items = [];
    this.chests = [];
    this.doorOpen = false;
    this.doorX = 1 + this.r(this.w - 2);
    this.hero.x = Math.floor(this.w / 2);
    this.hero.y = this.h - 1;
    const start = { x: this.hero.x, y: this.hero.y };
    const taken = new Set<string>([key(start), key({ x: this.doorX, y: 0 })]);
    for (let tries = 0; tries < 50; tries++) {
      this.obstacles.clear();
      const count = 4 + this.r(4);
      for (let i = 0; i < count; i++) {
        const p = { x: this.r(this.w), y: 1 + this.r(this.h - 2) };
        if (taken.has(key(p)) || Math.abs(p.x - start.x) + Math.abs(p.y - start.y) < 2) continue;
        this.obstacles.set(key(p), OBSTACLES[this.r(OBSTACLES.length)]);
      }
      if (this.allReachable(start)) break;
    }
    const free = () => {
      for (let t = 0; t < 200; t++) {
        const p = { x: this.r(this.w), y: this.r(this.h) };
        if (taken.has(key(p)) || this.obstacles.has(key(p))) continue;
        taken.add(key(p));
        return p;
      }
      return undefined;
    };
    const farFree = () => {
      for (let t = 0; t < 200; t++) {
        const p = free();
        if (!p) return undefined;
        if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) >= 4) return p;
        taken.delete(key(p));
      }
      return undefined;
    };
    // Monsters: more of them, and tougher kinds, the deeper you go.
    const kinds = (Object.keys(MONSTERS) as MonsterKind[]).filter((k) => MONSTERS[k].from <= n);
    const count = Math.min(9, 2 + Math.floor(n * 0.6));
    for (let i = 0; i < count; i++) {
      const p = farFree();
      if (!p) break;
      // Newer kinds turn up more often than the easy ones.
      const pick = kinds[Math.min(kinds.length - 1, Math.floor(Math.sqrt(this.rand()) * kinds.length))];
      this.addMonster(pick, p);
    }
    // A chest or two; from floor 3 some are mimics.
    const chests = 1 + (n >= 3 && this.rand() < 0.5 ? 1 : 0);
    for (let i = 0; i < chests; i++) {
      const p = farFree();
      if (!p) break;
      const mimic = n >= 3 && this.rand() < 0.25;
      this.chests.push({ id: this.nextId++, x: p.x, y: p.y, mimic, opened: false, loot: this.loot() });
    }
    // Sometimes a potion lying about.
    if (this.rand() < 0.45) {
      const p = free();
      if (p) this.items.push({ id: this.nextId++, kind: this.rand() < 0.75 ? 'red' : 'blue', x: p.x, y: p.y, amount: 1 });
    }
    if (!this.allReachable(start)) this.obstacles.clear();
  }

  /** What a chest holds: mostly gold, sometimes a better weapon, a shield or a potion. */
  private loot(): { kind: ItemKind; amount: number } {
    const n = this.floor;
    const r = this.rand();
    const better = (['sword', 'axe', 'hammer'] as const).find((w) => WEAPON_ATK[w] > WEAPON_ATK[this.hero.weapon]);
    if (r < 0.25 && better && n >= 2) return { kind: better, amount: 1 };
    if (r < 0.4) return { kind: 'shield', amount: 1 };
    if (r < 0.55) return { kind: this.rand() < 0.6 ? 'red' : 'blue', amount: 1 };
    return { kind: 'gold', amount: 8 + this.r(8) + n * 4 };
  }

  private addMonster(kind: MonsterKind, p: Pos) {
    const def = MONSTERS[kind];
    // A little tougher every few floors.
    const hp = def.hp + Math.floor((this.floor - def.from) / 4);
    const m: Monster = { id: this.nextId++, kind, x: p.x, y: p.y, hp, maxHp: hp, atk: def.atk, tick: this.r(2) };
    this.monsters.push(m);
    return m;
  }

  /** Every open tile can be reached from `from`, so scenery never walls anything off. */
  private allReachable(from: Pos) {
    const seen = new Set([key(from)]);
    const queue = [from];
    while (queue.length) {
      const p = queue.shift()!;
      for (const d of DIRS) {
        const q = { x: p.x + d.x, y: p.y + d.y };
        if (!this.inside(q) || this.obstacles.has(key(q)) || seen.has(key(q))) continue;
        seen.add(key(q));
        queue.push(q);
      }
    }
    return seen.size === this.w * this.h - this.obstacles.size;
  }

  /** The first step from `from` towards `to`, going round scenery and other monsters. */
  private stepTowards(from: Pos, to: Pos, ghost: boolean): Pos | undefined {
    // Distances out from the target, then step to whichever neighbour is nearest.
    const dist = new Map<string, number>([[key(to), 0]]);
    const queue = [to];
    while (queue.length) {
      const p = queue.shift()!;
      const d = dist.get(key(p))!;
      for (const dd of DIRS) {
        const q = { x: p.x + dd.x, y: p.y + dd.y };
        if (dist.has(key(q))) continue;
        const isFrom = q.x === from.x && q.y === from.y;
        if (!isFrom && (!this.open(q, ghost) || this.monsterAt(q))) continue;
        dist.set(key(q), d + 1);
        if (!isFrom) queue.push(q);
      }
    }
    let best: Pos | undefined;
    let bestD = Infinity;
    for (const dd of DIRS) {
      const q = { x: from.x + dd.x, y: from.y + dd.y };
      const d = dist.get(key(q));
      if (d !== undefined && d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  }

  /** The hero tries to step (or attacks what's there); then the monsters take their turns. */
  act(dx: number, dy: number): Event[] {
    if (this.dead) return [];
    const ev: Event[] = [];
    const h = this.hero;
    if (dx === 0 && dy === 0) {
      // Waiting a turn.
    } else {
      const to = { x: h.x + dx, y: h.y + dy };
      // Out through the open door.
      if (to.y === -1 && to.x === this.doorX && this.doorOpen) {
        this.floor++;
        // A breather on the stairs.
        h.hp = Math.min(h.maxHp, h.hp + 2);
        this.buildFloor();
        ev.push({ type: 'descend', floor: this.floor });
        return ev;
      }
      const m = this.monsterAt(to);
      const chest = this.chestAt(to);
      if (m) {
        const dmg = WEAPON_ATK[h.weapon];
        m.hp -= dmg;
        const killed = m.hp <= 0;
        ev.push({ type: 'attack', by: 'hero', at: to, target: m.id, damage: dmg, blocked: false, killed });
        if (killed) {
          this.monsters.splice(this.monsters.indexOf(m), 1);
          h.kills++;
          h.gold += MONSTERS[m.kind].xp;
        }
      } else if (chest) {
        chest.opened = true;
        if (chest.mimic) {
          const mm = this.addMonster('mimic', chest);
          ev.push({ type: 'mimic', chest, monster: mm });
        } else {
          ev.push({ type: 'open', chest });
          this.give({ id: this.nextId++, kind: chest.loot.kind, x: chest.x, y: chest.y, amount: chest.loot.amount }, ev);
        }
      } else if (!this.open(to)) {
        ev.push({ type: 'bump', at: to });
        return ev;
      } else {
        ev.push({ type: 'move', who: 'hero', from: { x: h.x, y: h.y }, to });
        h.x = to.x;
        h.y = to.y;
        const item = this.items.find((i) => i.x === to.x && i.y === to.y);
        if (item) {
          this.items.splice(this.items.indexOf(item), 1);
          this.give(item, ev);
        }
      }
    }
    this.turn++;
    this.monstersAct(ev);
    if (!this.doorOpen && !this.monsters.length) {
      this.doorOpen = true;
      ev.push({ type: 'door' });
    }
    return ev;
  }

  private give(item: Item, ev: Event[]) {
    const h = this.hero;
    if (item.kind === 'gold') h.gold += item.amount;
    else if (item.kind === 'red') h.hp = Math.min(h.maxHp, h.hp + 4);
    else if (item.kind === 'blue') {
      h.maxHp += 2;
      h.hp = Math.min(h.maxHp, h.hp + 2);
    } else if (item.kind === 'shield') h.shield += 3;
    else if (WEAPON_ATK[item.kind] > WEAPON_ATK[h.weapon]) h.weapon = item.kind as Hero['weapon'];
    ev.push({ type: 'pickup', item });
  }

  private monstersAct(ev: Event[]) {
    const h = this.hero;
    for (const m of [...this.monsters]) {
      if (this.dead) return;
      if ((m.kind === 'slime' || m.kind === 'cyclops') && (m.tick++ % 2 === 1)) continue;
      const dist = Math.abs(m.x - h.x) + Math.abs(m.y - h.y);
      if (dist === 1) {
        let dmg = m.atk;
        let blocked = false;
        if (h.shield > 0) {
          h.shield--;
          dmg = Math.max(0, dmg - 1);
          blocked = true;
        }
        h.hp -= dmg;
        ev.push({ type: 'attack', by: m.id, at: { x: h.x, y: h.y }, target: 'hero', damage: dmg, blocked, killed: h.hp <= 0 });
        if (h.hp <= 0) {
          this.dead = true;
          ev.push({ type: 'dead' });
        }
        continue;
      }
      let to: Pos | undefined;
      // Bats flutter about; everything else heads for the hero.
      if (m.kind === 'bat' && this.rand() < 0.5) {
        const d = DIRS[this.r(4)];
        to = { x: m.x + d.x, y: m.y + d.y };
      } else {
        to = this.stepTowards(m, h, m.kind === 'ghost');
      }
      if (!to || (to.x === h.x && to.y === h.y)) continue;
      // Ghosts drift over scenery.
      if (!this.open(to, m.kind === 'ghost') || this.monsterAt(to)) continue;
      ev.push({ type: 'move', who: m.id, from: { x: m.x, y: m.y }, to });
      m.x = to.x;
      m.y = to.y;
    }
  }
}
