/**
 * Builds some coasters from moves and rides them with the game's own physics: each should get
 * home (or fly off or stall when it ought to), and the frames along the track should be sound
 * (unit length, up at right angles to the way along, no sudden flips).
 *
 *   node games/coaster-builder/scripts/check-rides.ts
 */
import { METRES, Ride, buildTrack, poses, type MoveName } from '../src/coaster.ts';

const RIDES: { name: string; moves: MoveName[]; close: boolean; expect: string }[] = [
  { name: 'kiddie', moves: ['up', 'right', 'down', 'right', 'straight', 'right', 'right'], close: true, expect: 'home' },
  { name: 'classic', moves: ['lift', 'drop', 'hill', 'right', 'right', 'up', 'down', 'right'], close: true, expect: 'home' },
  { name: 'looper', moves: ['lift', 'drop', 'loop', 'wideRight', 'hill', 'wideRight', 'straight'], close: true, expect: 'home' },
  { name: 'double loop', moves: ['lift', 'straight', 'drop', 'loop', 'loop', 'left', 'left', 'straight'], close: true, expect: 'home' },
  { name: 'too flat', moves: ['straight', 'up', 'up', 'straight'], close: true, expect: 'stalled' },
  { name: 'open end', moves: ['lift', 'drop', 'straight'], close: false, expect: 'flew' },
];

let failed = false;
for (const r of RIDES) {
  const track = buildTrack(r.moves, r.close);
  // Frames.
  let worst = 0;
  for (let i = 1; i < track.points.length; i++) {
    const a = track.points[i - 1];
    const b = track.points[i];
    const dotTU = Math.abs(b.t.x * b.u.x + b.t.y * b.u.y + b.t.z * b.u.z);
    const flip = 1 - (a.u.x * b.u.x + a.u.y * b.u.y + a.u.z * b.u.z);
    worst = Math.max(worst, flip);
    if (dotTU > 0.05) {
      failed = true;
      console.log(`  ${r.name}: up not square to the track at ${b.s.toFixed(1)}`);
      break;
    }
  }
  if (worst > 0.05) {
    failed = true;
    console.log(`  ${r.name}: up jumps by ${worst.toFixed(3)} between points`);
  }
  const ride = new Ride(track);
  let t = 0;
  while (!ride.ended && t < 300) {
    ride.step(1 / 120);
    t += 1 / 120;
  }
  const st = ride.stats;
  const { stars, word } = ride.rating();
  const ok = ride.ended === r.expect;
  if (!ok) failed = true;
  const end = poses(r.moves).at(-1)!;
  console.log(`${ok ? '✓' : '✗'} ${r.name.padEnd(12)} ${String(ride.ended).padEnd(8)} ${t.toFixed(0)}s  ${track.length.toFixed(0)}u  top ${(st.topSpeed * METRES * 3.6).toFixed(0)}km/h  drop ${(st.biggestDrop * METRES).toFixed(0)}m  g ${st.minG.toFixed(1)}..${st.maxG.toFixed(1)}  air ${st.airtime.toFixed(1)}s  ${stars}★ ${word}  (ends at y=${end.p.y.toFixed(1)})`);
}
if (failed) process.exit(1);
