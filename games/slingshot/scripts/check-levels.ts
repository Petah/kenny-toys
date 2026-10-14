/**
 * Flies every launch on a grid of aim angles and stretches through each level, with the game's
 * own sim, and fails a level unless enough of them dock with all three stars. A level with
 * moving parts is tried at several moments, since where they are at launch changes the path.
 *
 *   node games/slingshot/scripts/check-levels.ts            check every level
 *   node games/slingshot/scripts/check-levels.ts --paths 3    print docking paths through level 3
 *   node games/slingshot/scripts/check-levels.ts --suggest 3  pick a curvy, forgiving docking path through level 3 and
 *                                                             print three star spots along it
 */
import { LEVELS } from '../src/levels.ts';
import { DOCK_R, FIELD_H, FIELD_W, fly, hasMovers, launchVelocity, placeAt, type Level, type Point } from '../src/sim.ts';

const ANGLE_STEP = 0.5;
const POWER_STEP = 0.025;
/** Three-star launches a level needs on the grid, so a player's aim needn't be pixel perfect. */
const MIN_PERFECT = 4;
const MOMENTS = [0, 1.5, 3, 4.5, 6, 7.5];

interface Shot {
  angle: number;
  power: number;
  t0: number;
  stars: number;
  time: number;
}

function scan(level: Level) {
  const docked: Shot[] = [];
  for (const t0 of hasMovers(level) ? MOMENTS : [0]) {
    for (let deg = 0; deg < 360; deg += ANGLE_STEP) {
      for (let power = 0; power <= 1.0001; power += POWER_STEP) {
        const v = launchVelocity((deg * Math.PI) / 180, power);
        const { flight } = fly(level, t0, v.x, v.y);
        if (flight.outcome === 'docked') docked.push({ angle: deg, power, t0, stars: flight.stars.length, time: flight.t });
      }
    }
  }
  return docked;
}

/** Things placed where they can't be reached or seen. */
function layoutProblems(level: Level) {
  const problems: string[] = [];
  const inField = (p: Point, pad: number) => p.x >= pad && p.x <= FIELD_W - pad && p.y >= pad && p.y <= FIELD_H - pad;
  if (level.stars.length !== 3) problems.push(`has ${level.stars.length} stars`);
  for (const [name, p] of [['start', level.start], ['station', placeAt(level.station, 0)], ...level.stars.map((s, i) => [`star ${i + 1}`, s] as const)] as const) {
    if (!inField(p, 30)) problems.push(`${name} is off the field`);
    for (const planet of level.planets) {
      const at = placeAt(planet, 0);
      // The star's art is about 20 pixels across from its centre.
      if (!planet.orbit && Math.hypot(p.x - at.x, p.y - at.y) < planet.r + 20) problems.push(`${name} overlaps a planet`);
    }
  }
  return problems;
}

function check() {
  let failed = false;
  LEVELS.forEach((level, i) => {
    const docked = scan(level);
    const perfect = docked.filter((s) => s.stars === 3).length;
    const problems = layoutProblems(level);
    if (perfect < MIN_PERFECT) problems.push(`only ${perfect} three-star launches`);
    failed ||= problems.length > 0;
    const total = (360 / ANGLE_STEP) * (1 / POWER_STEP + 1) * (hasMovers(level) ? MOMENTS.length : 1);
    const pct = (n: number) => `${((n / total) * 100).toFixed(2)}%`;
    console.log(
      `${problems.length ? '✗' : '✓'} ${String(i + 1).padStart(2)}. ${level.name.padEnd(18)} docks ${pct(docked.length).padStart(7)}  three stars ${pct(perfect).padStart(7)} (${perfect})` +
        (problems.length ? `  ${problems.join('; ')}` : ''),
    );
  });
  if (failed) process.exit(1);
}

/** Prints a spread of docking launches with their paths, to place a level's stars along. */
function paths(levelNo: number) {
  const level = LEVELS[levelNo - 1];
  const docked = scan(level).sort((a, b) => b.stars - a.stars || b.time - a.time);
  console.log(`${level.name}: ${docked.length} docking launches. Station dock radius ${DOCK_R}.`);
  const picked: Shot[] = [];
  for (const s of docked) {
    if (picked.every((p) => Math.abs(p.angle - s.angle) > 6 || Math.abs(p.power - s.power) > 0.15)) picked.push(s);
    if (picked.length === 8) break;
  }
  for (const s of picked) {
    const v = launchVelocity((s.angle * Math.PI) / 180, s.power);
    const { path } = fly(level, s.t0, v.x, v.y, undefined, 48);
    const pts = path.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' ');
    console.log(`\n${s.angle}° power ${s.power.toFixed(3)} t0 ${s.t0} stars ${s.stars} ${s.time.toFixed(1)}s\n  ${pts}`);
  }
}

/** How much a path turns in all, in radians. */
function turning(path: Point[]) {
  let total = 0;
  for (let i = 2; i < path.length; i++) {
    const a = Math.atan2(path[i - 1].y - path[i - 2].y, path[i - 1].x - path[i - 2].x);
    const b = Math.atan2(path[i].y - path[i - 1].y, path[i].x - path[i - 1].x);
    total += Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
  }
  return total;
}

/**
 * Picks the docking launch that turns the most, among short ones whose neighbours on the grid
 * mostly dock too, and prints star spots a quarter, half and three quarters of the way along it.
 */
function suggest(levelNo: number) {
  const level = { ...LEVELS[levelNo - 1], stars: [] };
  const docked = scan(level);
  const key = (s: Shot) => `${s.t0}:${s.angle}:${Math.round(s.power / POWER_STEP)}`;
  const set = new Set(docked.map(key));
  // Long loops are dull to watch, so only flights of five seconds or less.
  const steady = docked.filter((s) => s.time <= 5).filter((s) =>
    [[ANGLE_STEP, 0], [-ANGLE_STEP, 0], [0, 1], [0, -1]].filter(([da, dp]) => set.has(`${s.t0}:${s.angle + da}:${Math.round(s.power / POWER_STEP) + dp}`)).length >= 3,
  );
  const scored = steady.map((s) => {
    const v = launchVelocity((s.angle * Math.PI) / 180, s.power);
    const { path } = fly(level, s.t0, v.x, v.y, undefined, 4);
    return { s, path, turn: turning(path) };
  });
  // Stars go on the path, so keep it clear of the edges, where they'd be hard to see.
  const inside = (p: Point) => p.x > 50 && p.x < FIELD_W - 50 && p.y > 50 && p.y < FIELD_H - 50;
  scored.splice(0, scored.length, ...scored.filter(({ path }) => path.slice(0, -1).every(inside)));
  scored.sort((a, b) => b.turn - a.turn);
  console.log(`${level.name}: ${docked.length} docking launches, ${steady.length} steady.`);
  for (const { s, path, turn } of scored.filter((x, i, all) => all.findIndex((y) => Math.abs(y.s.angle - x.s.angle) < 4 && y.s.t0 === x.s.t0) === i).slice(0, 6)) {
    let length = 0;
    const along = [0];
    for (let i = 1; i < path.length; i++) along.push((length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)));
    const spots = [0.25, 0.5, 0.75].map((f) => path[along.findIndex((d) => d >= length * f)]);
    console.log(
      `${s.angle}° power ${s.power.toFixed(3)} t0 ${s.t0} turns ${((turn * 180) / Math.PI).toFixed(0)}° ${s.time.toFixed(1)}s  stars: ` +
        spots.map((p) => `{ x: ${Math.round(p.x)}, y: ${Math.round(p.y)} }`).join(', '),
    );
  }
}

const mode = process.argv[2];
if (mode === '--paths') paths(Number(process.argv[3]));
else if (mode === '--suggest') suggest(Number(process.argv[3]));
else check();
