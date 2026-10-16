/**
 * The yards, one per stage, drawn as box-drawing maps (see `rail.ts` for the glyphs). Each
 * stage adds a shed. `scripts/check-layouts.ts` parses every map and checks the timing.
 */
export interface Stage {
  name: string;
  map: string[];
  /** Trains to send this stage. */
  trains: number;
  /** Track speed in world units a second, and seconds between trains leaving the tunnel. */
  speed: number;
  every: number;
  /** Most wagons behind an engine. */
  wagons: number;
}

export const STAGES: Stage[] = [
  {
    name: 'Two Sheds',
    map: [
      '      ┌──a',
      'T─────┤   ',
      '      └──b',
    ],
    trains: 6, speed: 3.6, every: 5.8, wagons: 1,
  },
  {
    name: 'Three Sheds',
    map: [
      '        ┌──a',
      'T───┬───┤   ',
      '    │   └──b',
      '    └──────c',
    ],
    trains: 8, speed: 3.8, every: 5.4, wagons: 1,
  },
  {
    name: 'Four Sheds',
    map: [
      'a──┐     b ',
      '   │     │ ',
      'T──┴──┬──┘ ',
      '      │    ',
      '      ├──c ',
      '      └──d ',
    ],
    trains: 10, speed: 4, every: 4.9, wagons: 2,
  },
  {
    name: 'Five Sheds',
    map: [
      '   a     ┌──b ',
      '   │     │    ',
      'T──┴──┬──┴──┐ ',
      '      │     │ ',
      '   d──┤     c ',
      '      │       ',
      '      └───e   ',
    ],
    trains: 12, speed: 4.2, every: 4.5, wagons: 2,
  },
  {
    name: 'Six Sheds',
    map: [
      ' a──┐     ┌──b ',
      '    │     │    ',
      ' c──┤     ├──d ',
      '    │     │    ',
      '    └──┬──┘    ',
      '       │       ',
      '  e────┤       ',
      '       ├────f  ',
      '       │       ',
      '       │       ',
      '       T       ',
    ],
    trains: 14, speed: 4.4, every: 4.2, wagons: 2,
  },
  {
    name: 'The Junction',
    map: [
      '   a    b       ',
      '   │    │       ',
      '   ├──┐ └─┬───T ',
      '   │  │   │     ',
      ' c─┘  └┬──┘     ',
      '       │        ',
      ' d─────┤  ┌───e ',
      '       └──┤     ',
      '          └───f ',
    ],
    trains: 16, speed: 4.6, every: 4.2, wagons: 2,
  },
];

/** After the last stage the yards come round again, faster each time. */
export function stageFor(n: number): Stage & { lap: number } {
  const lap = Math.floor(n / STAGES.length);
  const base = STAGES[n % STAGES.length];
  if (!lap) return { ...base, lap };
  // Trains keep the same spacing on the track, so there's less time between them as they speed up.
  const faster = 1 + lap * 0.2;
  return { ...base, lap, speed: base.speed * faster, every: base.every / faster };
}
