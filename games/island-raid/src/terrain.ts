/**
 * The sea and islands scrolling under the planes, with no Phaser in it so scripts can check it.
 *
 * Land is decided on a coarse grid of 2×2-tile cells. Built from whole cells, every land tile is
 * one corner of its cell and only has to look outwards: sideways, up or down, and diagonally. That
 * always matches one of the pack's thirteen shore tiles (four outer corners, four edges, four inner
 * corners and solid ground), so coastlines join up without gaps or seams.
 *
 * World y grows downwards and the planes fly up, so new terrain appears at ever smaller y.
 */

export const TILE = 16;
export const CELL = TILE * 2;
/** A chunk is this many cells tall, and the map is this many cells either side of the middle. */
export const CHUNK_CELLS = 8;
export const CHUNK = CHUNK_CELLS * CELL;
export const HALF_CELLS = 12;
export const CHUNK_COLS = HALF_CELLS * 4;

/** Pack tile numbers. Dirt islands use the same layout six tiles along. */
export const WATER = 42;
const DIRT = 6;
const GRASS = { full: 50, tl: 37, top: 38, tr: 39, left: 49, right: 51, bl: 61, bottom: 62, br: 63, notchBR: 40, notchBL: 41, notchTR: 52, notchTL: 53 };
/** Islets dotted about the open sea: a lone tile of each kind of island, and specks of both. */
const ISLETS = [64, 65, 70, 71];
/** Things growing or standing on solid ground, drawn as whole tiles. */
const TREES = { grass: [36, 48, 60], dirt: [54, 66] };
const HOUSES = { grass: [72, 84], dirt: [78, 90] };
const FARM = { grass: [109, 109, 109, 96], dirt: [115, 115, 115, 102] };

export interface ChunkData {
  /** Chunk number: rows of cells from cy = index × CHUNK_CELLS downwards. */
  index: number;
  /** Tile numbers, row by row, CHUNK_CELLS × 2 rows of CHUNK_COLS. */
  tiles: number[][];
  /** Left edge of the tiles in world x. */
  x: number;
  /** Top edge in world y. */
  y: number;
  /** Centres of plain open ground, where tanks and guns can go, in world pixels. */
  spots: { x: number; y: number; dirt: boolean }[];
}

function hash(seed: number, x: number, y: number) {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise between 0 and 1. */
function noise(seed: number, x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(seed, ix, iy);
  const b = hash(seed, ix + 1, iy);
  const c = hash(seed, ix, iy + 1);
  const d = hash(seed, ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export class Terrain {
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Island-ness of a cell before tidying: big blobs, with stretches of open sea between groups. */
  private raw(cx: number, cy: number) {
    const n = noise(this.seed, cx * 0.27, cy * 0.27) * 0.7 + noise(this.seed + 1, cx * 0.6, cy * 0.6) * 0.3;
    // Slow swells of more and less land as you fly, so there's open sea now and then.
    const swell = noise(this.seed + 2, 0.5, cy * 0.045);
    // More land down the middle, where even a phone's narrow view sees it, and mostly sea far out.
    const off = Math.abs(cx + 0.5);
    const edge = Math.max(0, off - 6) * 0.05 - Math.max(0, 3 - off) * 0.025;
    // Open water at the start, so the first seconds are just you and the sea.
    const start = cy > -8 ? 1 : 0;
    return n > 0.53 + (0.5 - swell) * 0.3 + edge + start;
  }

  private dirt(cx: number, cy: number) {
    return noise(this.seed + 3, cx * 0.08, cy * 0.06) > 0.58;
  }

  /** Whether a cell is land, and dirt. Dirt cells touching grass go under, so the two never meet. */
  land(cx: number, cy: number): false | 'grass' | 'dirt' {
    if (!this.raw(cx, cy)) return false;
    if (!this.dirt(cx, cy)) return 'grass';
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && this.raw(cx + dx, cy + dy) && !this.dirt(cx + dx, cy + dy)) return false;
      }
    }
    return 'dirt';
  }

  /** The tile at tile coordinates (tx, ty), and whether it's open ground something could stand on. */
  tile(tx: number, ty: number): { frame: number; open: boolean; dirt: boolean } {
    const cx = Math.floor(tx / 2);
    const cy = Math.floor(ty / 2);
    const kind = this.land(cx, cy);
    if (!kind) {
      // The odd islet, well away from any shore.
      let clear = true;
      for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1 && clear; dx++) clear = !this.land(cx + dx, cy + dy);
      const r = hash(this.seed + 4, tx, ty);
      return { frame: clear && r < 0.007 ? ISLETS[Math.floor(r * 1000) % ISLETS.length] : WATER, open: false, dirt: false };
    }
    // Which way is out of the cell from this corner.
    const sx = tx - cx * 2 === 0 ? -1 : 1;
    const sy = ty - cy * 2 === 0 ? -1 : 1;
    const h = !!this.land(cx + sx, cy);
    const v = !!this.land(cx, cy + sy);
    const d = !!this.land(cx + sx, cy + sy);
    const off = kind === 'dirt' ? DIRT : 0;
    const dirt = kind === 'dirt';
    const shore = (frame: number) => ({ frame: frame + off, open: false, dirt });
    if (!h && !v) return shore(sy < 0 ? (sx < 0 ? GRASS.tl : GRASS.tr) : sx < 0 ? GRASS.bl : GRASS.br);
    if (!v) return shore(sy < 0 ? GRASS.top : GRASS.bottom);
    if (!h) return shore(sx < 0 ? GRASS.left : GRASS.right);
    if (!d) return shore(sy < 0 ? (sx < 0 ? GRASS.notchTL : GRASS.notchTR) : sx < 0 ? GRASS.notchBL : GRASS.notchBR);
    // Solid ground: woods in patches, and villages of houses with fields round them.
    const r = hash(this.seed + 5, tx, ty);
    const woods = noise(this.seed + 6, tx * 0.3, ty * 0.3);
    const village = noise(this.seed + 7, tx * 0.22, ty * 0.22);
    const pick = (set: { grass: number[]; dirt: number[] }, salt: number) => {
      const list = set[kind];
      return { frame: list[Math.floor(r * salt) % list.length], open: false, dirt };
    };
    if (village > 0.68) {
      if (r < 0.3) return pick(HOUSES, 997);
      if (r < 0.4) return pick(FARM, 991);
    } else if (village > 0.6 && r < 0.12) return pick(FARM, 991);
    if (r < (woods - 0.35) * 0.9) return pick(TREES, 997);
    return { frame: GRASS.full + off, open: true, dirt };
  }

  chunk(index: number): ChunkData {
    const ty0 = index * CHUNK_CELLS * 2;
    const tx0 = -HALF_CELLS * 2;
    const tiles: number[][] = [];
    const spots: ChunkData['spots'] = [];
    for (let r = 0; r < CHUNK_CELLS * 2; r++) {
      const row: number[] = [];
      for (let c = 0; c < CHUNK_COLS; c++) {
        const t = this.tile(tx0 + c, ty0 + r);
        row.push(t.frame);
        if (t.open) spots.push({ x: (tx0 + c) * TILE + TILE / 2, y: (ty0 + r) * TILE + TILE / 2, dirt: t.dirt });
      }
      tiles.push(row);
    }
    return { index, tiles, x: tx0 * TILE, y: ty0 * TILE, spots };
  }
}
