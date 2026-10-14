import type { Level, Rock } from './sim.ts';

/** A line of asteroids from one point to another, leaving out the ones listed in `gaps`. */
function belt(x0: number, y0: number, x1: number, y1: number, count: number, gaps: number[] = []): Rock[] {
  const rocks: Rock[] = [];
  for (let i = 0; i < count; i++) {
    if (gaps.includes(i)) continue;
    const t = count === 1 ? 0 : i / (count - 1);
    rocks.push({ x: Math.round(x0 + (x1 - x0) * t), y: Math.round(y0 + (y1 - y0) * t), r: 24 + ((i * 7) % 3) * 4 });
  }
  return rocks;
}

// Positions are on a 1280 x 720 field; portrait screens play each level mirrored on its diagonal.
// scripts/check-levels.ts flies every launch and checks each level can be finished with three stars.
export const LEVELS: Level[] = [
  {
    name: 'First Flight',
    preview: 2,
    start: { x: 170, y: 400 },
    station: { x: 1110, y: 400 },
    planets: [{ x: 640, y: 570, r: 70, skin: 3 }],
    rocks: [],
    stars: [{ x: 380, y: 562 }, { x: 621, y: 669 }, { x: 861, y: 587 }],
  },
  {
    name: 'Over the Top',
    preview: 1.5,
    start: { x: 170, y: 470 },
    station: { x: 1110, y: 470 },
    planets: [{ x: 640, y: 440, r: 120, skin: 9 }],
    rocks: [],
    stars: [{ x: 352, y: 254 }, { x: 619, y: 157 }, { x: 886, y: 227 }],
  },
  {
    name: 'Hairpin',
    preview: 1.3,
    start: { x: 170, y: 570 },
    station: { x: 280, y: 170 },
    planets: [{ x: 680, y: 370, r: 95, skin: 4, mass: 2.5 }],
    rocks: belt(70, 370, 470, 370, 7),
    stars: [{ x: 496, y: 664 }, { x: 780, y: 473 }, { x: 661, y: 180 }],
  },
  {
    name: 'The Gap',
    preview: 1.2,
    start: { x: 150, y: 150 },
    station: { x: 1130, y: 590 },
    planets: [
      { x: 620, y: 170, r: 95, skin: 6 },
      { x: 660, y: 560, r: 95, skin: 1 },
    ],
    rocks: [],
    stars: [{ x: 374, y: 284 }, { x: 624, y: 363 }, { x: 877, y: 436 }],
  },
  {
    name: 'Asteroid Belt',
    preview: 1.1,
    start: { x: 150, y: 360 },
    station: { x: 1130, y: 600 },
    planets: [{ x: 940, y: 520, r: 85, skin: 7, mass: 1.2 }],
    rocks: belt(560, 0, 720, 720, 13, [3, 4]),
    stars: [{ x: 425, y: 259 }, { x: 714, y: 230 }, { x: 989, y: 315 }],
  },
  {
    name: 'Moon Dance',
    preview: 1.1,
    start: { x: 150, y: 580 },
    station: { x: 1130, y: 150 },
    planets: [
      { x: 640, y: 360, r: 85, skin: 2 },
      { x: 640, y: 360, r: 30, skin: 0, mass: 1.5, orbit: { cx: 640, cy: 360, radius: 200, period: 6, phase: 0 } },
    ],
    rocks: [],
    stars: [{ x: 287, y: 318 }, { x: 508, y: 132 }, { x: 794, y: 78 }],
  },
  {
    name: 'Moving Target',
    preview: 1,
    start: { x: 160, y: 360 },
    station: { x: 840, y: 360, orbit: { cx: 840, cy: 360, radius: 200, period: 9, phase: 0.5 } },
    planets: [{ x: 840, y: 360, r: 75, skin: 5 }],
    rocks: [],
    stars: [{ x: 389, y: 446 }, { x: 624, y: 498 }, { x: 862, y: 462 }],
  },
  {
    name: 'Twin Pull',
    preview: 1,
    start: { x: 640, y: 640 },
    station: { x: 640, y: 90 },
    planets: [
      { x: 430, y: 360, r: 70, skin: 8, mass: 1.6 },
      { x: 850, y: 360, r: 70, skin: 3, mass: 1.6 },
    ],
    rocks: belt(560, 360, 720, 360, 3),
    stars: [{ x: 331, y: 633 }, { x: 159, y: 385 }, { x: 290, y: 113 }],
  },
  {
    name: 'Pinball',
    preview: 0.9,
    start: { x: 140, y: 360 },
    station: { x: 1140, y: 360 },
    planets: [
      { x: 380, y: 220, r: 40, skin: 0, mass: 1.4 },
      { x: 420, y: 520, r: 36, skin: 6, mass: 1.4 },
      { x: 640, y: 360, r: 48, skin: 4, mass: 1.4 },
      { x: 860, y: 200, r: 38, skin: 7, mass: 1.4 },
      { x: 880, y: 520, r: 40, skin: 1, mass: 1.4 },
    ],
    rocks: [],
    stars: [{ x: 384, y: 329 }, { x: 621, y: 259 }, { x: 855, y: 306 }],
  },
  {
    name: 'Grand Tour',
    preview: 0.9,
    start: { x: 150, y: 140 },
    station: { x: 1140, y: 600 },
    planets: [
      { x: 620, y: 380, r: 110, skin: 9, mass: 1.2 },
      { x: 620, y: 380, r: 28, skin: 5, mass: 1.5, orbit: { cx: 620, cy: 380, radius: 210, period: 7, phase: 0.25 } },
    ],
    rocks: belt(960, 380, 1260, 380, 6),
    stars: [{ x: 276, y: 415 }, { x: 502, y: 611 }, { x: 802, y: 668 }],
  },
];
