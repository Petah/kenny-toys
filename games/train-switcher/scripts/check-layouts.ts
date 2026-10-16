/**
 * Parses every yard, checks the track joins up into one tree from the tunnel, that a train's
 * path runs smoothly from tile to tile, and that a perfect player has time to set each switch
 * between one train clearing it and the next arriving.
 *
 *   node games/train-switcher/scripts/check-layouts.ts
 */
import { STAGES, stageFor } from '../src/layouts.ts';
import { Route, TILE, parseLayout } from '../src/rail.ts';
import { trainLength } from '../src/trains.ts';

let failed = false;
const fail = (msg: string) => {
  failed = true;
  console.log(`  ✗ ${msg}`);
};

for (const [i, stage] of STAGES.entries()) {
  console.log(`${i + 1}. ${stage.name}`);
  let layout;
  try {
    layout = parseLayout(stage.map);
  } catch (e) {
    fail((e as Error).message);
    continue;
  }
  console.log(`  ${layout.cols}×${layout.rows} tiles, ${layout.switches.length} switches, ${layout.stations.length} sheds`);
  if (i > 0 && layout.stations.length < parseLayout(STAGES[i - 1].map).stations.length) fail('fewer sheds than the stage before');

  // Every way through: each setting of the switches reaches some shed, and every shed is reachable.
  const reached = new Set<number>();
  let shortestToSwitch = Infinity;
  for (let combo = 0; combo < 1 << layout.switches.length; combo++) {
    layout.switches.forEach((s, k) => (s.set = (combo >> k) & 1));
    const route = new Route(layout, 3);
    route.extendTo(400);
    reached.add(route.station);
    // Smooth joins: each segment starts where the last one ended, heading the same way.
    for (let k = 1; k < route.segs.length; k++) {
      const end = route.at(route.starts[k] - 1e-6);
      const start = route.at(route.starts[k] + 1e-6);
      const gap = Math.hypot(end.x - start.x, end.z - start.z);
      const bend = Math.hypot(end.hx - start.hx, end.hz - start.hz);
      if (gap > 1e-3 || bend > 1e-3) fail(`kink between segments ${k - 1} and ${k} (gap ${gap.toFixed(3)}, bend ${bend.toFixed(3)})`);
    }
    for (let k = 0; k < route.segs.length; k++) {
      if (route.segs[k].cell?.kind === 'switch') {
        shortestToSwitch = Math.min(shortestToSwitch, route.starts[k] - route.mouth);
        break;
      }
    }
  }
  if (reached.size !== layout.stations.length) fail(`only ${reached.size} of ${layout.stations.length} sheds can be reached`);
  console.log(`  tunnel mouth to first switch: ${(shortestToSwitch / TILE).toFixed(1)} tiles`);
  if (shortestToSwitch < TILE * 1.5) fail('the first switch is too close to the tunnel to see the train coming');

  // Between one train clearing a switch and the next reaching it.
  for (let lap = 0; lap < 3; lap++) {
    const s = stageFor(i + lap * STAGES.length);
    const window = s.every - (TILE + trainLength(s.wagons)) / s.speed;
    const line = `  lap ${lap + 1}: ${s.speed.toFixed(1)} u/s, a train every ${s.every.toFixed(1)}s, ${window.toFixed(2)}s to throw a switch between trains`;
    console.log(line);
    if (window < 0.7) fail('not enough time to throw a switch between trains');
  }
}

if (failed) process.exit(1);
console.log('all yards OK');
