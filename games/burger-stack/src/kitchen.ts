/**
 * The rules of the kitchen with no three.js: what falls, how fast, what each ticket asks for,
 * and what happens when the plate catches something. `game.ts` draws it; `scripts/check-orders.ts`
 * plays it with a bot to pitch the difficulty.
 *
 * Units: the plate moves along x in [-HALF_W, HALF_W]; things fall from DROP_Y down to the plate
 * at y = 0 (the top of the stack, which grows as layers go on).
 */

export type Kind = 'bun-bottom' | 'patty' | 'cheese' | 'salad' | 'tomato' | 'bacon' | 'egg' | 'bun-top' | 'bones' | 'can' | 'wrapper';

/** How much height each layer adds to the stack, and its catch width. */
export const LAYER: Record<Kind, { h: number; name: string; junk?: boolean }> = {
  'bun-bottom': { h: 0.4, name: 'Bun' },
  patty: { h: 0.46, name: 'Patty' },
  cheese: { h: 0.22, name: 'Cheese' },
  salad: { h: 0.3, name: 'Lettuce' },
  tomato: { h: 0.22, name: 'Tomato' },
  bacon: { h: 0.28, name: 'Bacon' },
  egg: { h: 0.28, name: 'Egg' },
  'bun-top': { h: 1.2, name: 'Bun' },
  bones: { h: 0.5, name: 'Fish bones', junk: true },
  can: { h: 0.5, name: 'Old can', junk: true },
  wrapper: { h: 0.4, name: 'Wrapper', junk: true },
};

export const FILLINGS: Kind[] = ['patty', 'cheese', 'salad', 'tomato', 'bacon', 'egg'];
export const JUNK: Kind[] = ['bones', 'can', 'wrapper'];

export const HALF_W = 6.2;
export const DROP_Y = 13;
/** How close (in x) the plate's middle must be to something falling to catch it. */
export const CATCH_R = 1.55;
export const ROUND_TIME = 90;
export const SERVE_BONUS_TIME = 5;

/** Builds a ticket: a bottom bun, some fillings, a top bun. Longer tickets as the round goes on. */
export function makeTicket(served: number, rand: () => number): Kind[] {
  const fillings = Math.min(6, 1 + Math.floor(served / 2) + (rand() < 0.4 ? 1 : 0));
  const out: Kind[] = ['bun-bottom'];
  // Always a patty, the rest from what's left, doubles allowed after a while.
  const pool: Kind[] = served < 2 ? ['patty', 'cheese', 'salad'] : served < 4 ? ['patty', 'cheese', 'salad', 'tomato'] : FILLINGS;
  out.push('patty');
  for (let i = 1; i < fillings; i++) {
    let k: Kind;
    do k = pool[Math.floor(rand() * pool.length)];
    while (k === out[out.length - 1]);
    out.push(k);
  }
  out.push('bun-top');
  return out;
}

export interface Falling {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  vy: number;
  /** A gentle spin while it falls, for show. */
  spin: number;
}

export type Event =
  | { type: 'catch'; item: Falling; right: boolean; offset: number }
  | { type: 'miss'; item: Falling }
  | { type: 'served'; ticket: Kind[] }
  | { type: 'ruined'; ticket: Kind[] };

/** One shift at the grill. */
export class Kitchen {
  items: Falling[] = [];
  /** What's on the plate, bottom to top. */
  stack: Kind[] = [];
  ticket: Kind[];
  time = ROUND_TIME;
  elapsed = 0;
  served = 0;
  ruined = 0;
  /** Money earned, in dollars. */
  cash = 0;
  /** Burgers served in a row without a mistake. */
  streak = 0;
  private nextId = 1;
  private spawnIn = 0.6;
  private sinceNeeded = 0;

  private rand: () => number;
  /** How far the plate can go either side, and where things drop from (the top of the view). */
  halfW: number;
  dropY: number;

  constructor(rand: () => number, opts: { halfW?: number; dropY?: number } = {}) {
    this.rand = rand;
    this.halfW = opts.halfW ?? HALF_W;
    this.dropY = opts.dropY ?? DROP_Y;
    this.ticket = makeTicket(0, rand);
    this.stack = ['bun-bottom'];
  }

  /** What the ticket wants next. */
  get needed(): Kind | undefined {
    return this.ticket[this.stack.length];
  }

  /** Height of the top of the stack above the plate. */
  get height() {
    return this.stack.reduce((h, k) => h + LAYER[k].h, 0);
  }

  /** 0 at the start of a shift, to 1 after a minute and a half. */
  get pace() {
    return Math.min(1, this.elapsed / 90);
  }

  private spawn() {
    const needed = this.needed;
    const r = this.rand();
    let kind: Kind;
    // The thing you need turns up at least every few drops.
    if (needed && (r < 0.38 || this.sinceNeeded >= 3)) kind = needed;
    else if (r < 0.62 + this.pace * 0.06) kind = this.ticket.filter((k) => k !== needed)[Math.floor(this.rand() * (this.ticket.length - 1))] ?? 'patty';
    else if (r < 0.8) kind = FILLINGS[Math.floor(this.rand() * FILLINGS.length)];
    else kind = JUNK[Math.floor(this.rand() * JUNK.length)];
    // The bottom bun is already on the plate.
    if (kind === 'bun-bottom') kind = 'bun-top';
    this.sinceNeeded = kind === needed ? 0 : this.sinceNeeded + 1;
    // Keep each new drop away from the last one's lane, so two don't arrive on top of each other.
    let x = 0;
    const last = this.items[this.items.length - 1];
    for (let tries = 0; tries < 6; tries++) {
      x = (this.rand() * 2 - 1) * (this.halfW - 0.6);
      if (!last || Math.abs(last.x - x) > 2.2 || last.y < this.dropY - 4) break;
    }
    // A taller view drops from higher up, faster, so things take as long to come down.
    const speed = (3.6 + this.pace * 3.4 + this.rand() * 0.8) * (this.dropY / DROP_Y);
    this.items.push({ id: this.nextId++, kind, x, y: this.dropY, vy: -speed, spin: (this.rand() * 2 - 1) * 2 });
  }

  /** Moves everything on by `dt` with the plate at `plateX`; returns what happened. */
  step(dt: number, plateX: number): Event[] {
    const events: Event[] = [];
    this.elapsed += dt;
    this.time = Math.max(0, this.time - dt);
    this.spawnIn -= dt;
    if (this.spawnIn <= 0 && this.time > 0) {
      this.spawn();
      this.spawnIn = 1.15 - this.pace * 0.5;
    }
    const top = this.height;
    for (const item of [...this.items]) {
      const prevY = item.y;
      item.y += item.vy * dt;
      // Caught when its bottom passes the top of the stack over the plate.
      if (prevY >= top && item.y < top && Math.abs(item.x - plateX) < CATCH_R) {
        this.items.splice(this.items.indexOf(item), 1);
        events.push(...this.caught(item, item.x - plateX));
        continue;
      }
      if (item.y < -3) {
        this.items.splice(this.items.indexOf(item), 1);
        events.push({ type: 'miss', item });
      }
    }
    return events;
  }

  private caught(item: Falling, offset: number): Event[] {
    const right = item.kind === this.needed;
    this.stack.push(item.kind);
    const events: Event[] = [{ type: 'catch', item, right, offset }];
    if (!right) {
      events.push({ type: 'ruined', ticket: this.ticket });
      this.ruined++;
      this.streak = 0;
      this.stack = ['bun-bottom'];
      return events;
    }
    this.cash += 1;
    if (this.stack.length === this.ticket.length) {
      this.served++;
      this.streak++;
      this.cash += this.ticket.length * 2 + Math.min(5, this.streak - 1) * 2;
      this.time += SERVE_BONUS_TIME;
      events.push({ type: 'served', ticket: this.ticket });
      this.ticket = makeTicket(this.served, this.rand);
      this.stack = ['bun-bottom'];
    }
    return events;
  }
}
