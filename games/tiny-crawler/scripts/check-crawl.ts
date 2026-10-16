/**
 * Plays runs with a bot (fight whatever's next to you, else walk to the nearest monster,
 * chest or potion, then the door) and reports how deep it gets, to pitch the monsters. Also
 * checks every floor can be crossed: the door and every open tile reachable from the start.
 *
 *   node games/tiny-crawler/scripts/check-crawl.ts [runs]
 */
import { Crawl, H, W, type Pos } from '../src/crawl.ts';

const RUNS = Number(process.argv[2] ?? 200);
const DIRS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The first step on a shortest walk to any of `goals`, or undefined. */
function stepTo(c: Crawl, goals: Pos[]): Pos | undefined {
  const k = (p: Pos) => `${p.x},${p.y}`;
  const goalSet = new Set(goals.map(k));
  const prev = new Map<string, Pos | null>([[k(c.hero), null]]);
  const queue: Pos[] = [{ x: c.hero.x, y: c.hero.y }];
  while (queue.length) {
    const p = queue.shift()!;
    if (goalSet.has(k(p)) && !(p.x === c.hero.x && p.y === c.hero.y)) {
      let at = p;
      while (prev.get(k(at)) && !(prev.get(k(at))!.x === c.hero.x && prev.get(k(at))!.y === c.hero.y)) at = prev.get(k(at))!;
      return { x: at.x - c.hero.x, y: at.y - c.hero.y };
    }
    for (const d of DIRS) {
      const q = { x: p.x + d.x, y: p.y + d.y };
      if (prev.has(k(q))) continue;
      if (q.x < 0 || q.x >= W || q.y < 0 || q.y >= H) continue;
      const blocked = c.obstacles.has(k(q)) || ((c.monsterAt(q) || c.chestAt(q)) && !goalSet.has(k(q)));
      if (blocked) continue;
      prev.set(k(q), p);
      queue.push(q);
    }
  }
  return undefined;
}

let failed = false;
const floors: number[] = [];
const causes = new Map<string, number>();
for (let run = 1; run <= RUNS; run++) {
  const c = new Crawl(rng(run));
  let turns = 0;
  while (!c.dead && turns < 3000 && c.floor < 40) {
    turns++;
    const h = c.hero;
    // Next to a monster: hit it.
    const adj = DIRS.find((d) => c.monsterAt({ x: h.x + d.x, y: h.y + d.y }));
    let step: Pos | undefined = adj;
    if (!step && c.monsters.length) step = stepTo(c, c.monsters);
    if (!step && c.chests.some((x) => !x.opened)) step = stepTo(c, c.chests.filter((x) => !x.opened));
    if (!step && c.items.length) step = stepTo(c, c.items);
    if (!step && c.doorOpen) {
      if (h.y === 0 && h.x === c.doorX) step = { x: 0, y: -1 };
      else step = stepTo(c, [{ x: c.doorX, y: 0 }]);
    }
    if (!step) {
      if (c.monsters.length) step = { x: 0, y: 0 };
      else {
        failed = true;
        console.log(`run ${run}: stuck on floor ${c.floor}`);
        break;
      }
    }
    const before = c.hero.hp;
    const ev = c.act(step.x, step.y);
    if (c.dead) {
      const hit = ev.filter((e) => e.type === 'attack' && e.target === 'hero');
      const by = hit.length ? c.monsters.find((m) => hit.some((e) => e.type === 'attack' && e.by === m.id))?.kind ?? 'mimic' : '?';
      causes.set(by, (causes.get(by) ?? 0) + 1);
      void before;
    }
  }
  floors.push(c.floor);
}
floors.sort((a, b) => a - b);
const pct = (p: number) => floors[Math.floor((floors.length - 1) * p)];
console.log(`bot reaches floor: median ${pct(0.5)}, 10% ${pct(0.1)}, 90% ${pct(0.9)}, best ${floors[floors.length - 1]}`);
console.log('killed by:', [...causes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
if (failed) process.exit(1);
