export interface Hole {
  name: string;
  par: number;
  /** Tile grid; see course.ts for the notation. The tee faces north (up the page). */
  rows: string[];
}

// Each hole is checked by scripts/check-holes.ts: the tiles must join up, and simulated putts
// must be able to sink the ball within par. Par is one more than the checker's best, which plays
// near-perfect shots, except where it found a hole in one.
export const HOLES: Hole[] = [
  {
    name: 'Warm-Up',
    par: 2,
    rows: [
      'H2',
      '|0',
      '|0',
      '|0',
      'S0',
    ],
  },
  {
    name: 'Dogleg',
    par: 3,
    rows: [
      'C2 |1 |1 H3',
      '|0 .  .  . ',
      '|0 .  .  . ',
      'S0 .  .  . ',
    ],
  },
  {
    name: 'Bumpy Ride',
    par: 3,
    rows: [
      'H2',
      'B0',
      '|0',
      'h0',
      '|0',
      'B0',
      'S0',
    ],
  },
  {
    name: 'Castle Gate',
    par: 3,
    rows: [
      '.  C2 |1 H3',
      '.  |0 .  . ',
      '.  c0 .  . ',
      'C2 L0 .  . ',
      'S0 .  .  . ',
    ],
  },
  {
    name: 'The Pond',
    par: 2,
    rows: [
      'L2 s3 s3 L3',
      's2 d0 O0 s0',
      's2 _0 b0 s0',
      'L1 _0 s1 L0',
      '.  |0 .  . ',
      '.  S0 .  . ',
    ],
  },
  {
    name: 'Windmill',
    par: 2,
    rows: [
      'H2',
      '|0',
      'w0',
      '|0',
      '|0',
      'S0',
    ],
  },
  {
    name: 'Up and Over',
    par: 3,
    rows: [
      'C2^7 |1^7 H3^7',
      '|0^7 .    .   ',
      'r2^2 .    .   ',
      '/2   .    .   ',
      '|0   .    .   ',
      'S0   .    .   ',
    ],
  },
  {
    name: 'Mind the Gap',
    par: 3,
    rows: [
      'H2 .  . ',
      '|0 .  . ',
      'C1 |1 C3',
      '.  .  g0',
      '.  .  o0',
      '.  .  |0',
      '.  .  S0',
    ],
  },
  {
    name: 'Grand Finale',
    par: 5,
    rows: [
      '.  C2 |1 |1 H3',
      '.  w0 .  .  . ',
      '.  |0 .  .  . ',
      'C2 L0 .  .  . ',
      'B0 .  .  .  . ',
      'u0 .  .  .  . ',
      'C1 |1 C3 .  . ',
      '.  .  h0 .  . ',
      '.  .  S0 .  . ',
    ],
  },
];
