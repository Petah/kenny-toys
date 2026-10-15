import * as Phaser from 'phaser';

export interface PixelFontOptions {
  /** The loaded sheet the letters are in. */
  image: string;
  /** Glyph cell size in pixels; letters are square tiles. */
  tile: number;
  /** The characters in sheet order, row by row. */
  chars: string;
  charsPerRow: number;
  /** Where the first glyph's tile starts in the sheet. */
  offset: { x: number; y: number };
  /** Colours to swap, as [from, to] RGB pairs, so letters lifted from one pack match another. */
  recolor?: [number, number][];
  /** How many columns neighbouring letters share; 2 for the Kenney sheets' two-pixel outline. */
  overlap?: number;
  /** How far a space moves along. */
  space?: number;
}

/**
 * Registers a sheet of pixel letters as a bitmap font named `key`. Each letter is trimmed to the
 * pixels it draws, and neighbours share their two-pixel outline, so words are spaced like real
 * lettering rather than one letter to a tile.
 */
export function createPixelFont(scene: Phaser.Scene, key: string, opts: PixelFontOptions) {
  if (scene.cache.bitmapFont.exists(key)) return;
  const { tile, chars: charList, charsPerRow } = opts;
  // The glyph rows, copied into their own texture so they can be recoloured and measured.
  const rows = Math.ceil(charList.length / charsPerRow);
  const src = scene.textures.get(opts.image).getSourceImage() as CanvasImageSource;
  const tex = scene.textures.createCanvas(`${key}:glyphs`, charsPerRow * tile, rows * tile)!;
  const ctx = tex.context;
  ctx.drawImage(src, opts.offset.x, opts.offset.y, charsPerRow * tile, rows * tile, 0, 0, charsPerRow * tile, rows * tile);
  const img = ctx.getImageData(0, 0, tex.width, tex.height);
  const px = img.data;
  if (opts.recolor) {
    for (let i = 0; i < px.length; i += 4) {
      const rgb = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
      const to = opts.recolor.find(([from]) => from === rgb)?.[1];
      if (to === undefined) continue;
      px[i] = to >> 16;
      px[i + 1] = (to >> 8) & 0xff;
      px[i + 2] = to & 0xff;
    }
    ctx.putImageData(img, 0, 0);
  }
  tex.refresh();

  // Phaser's types for RetroFont don't match what it takes and returns, hence the casts.
  const entry = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: `${key}:glyphs`,
    width: tile,
    height: tile,
    chars: charList,
    charsPerRow,
    offset: { x: 0, y: 0 },
    spacing: { x: 0, y: 0 },
    lineSpacing: 2,
  } as unknown as Phaser.Types.GameObjects.BitmapText.RetroFontConfig) as unknown as { data: { chars: Record<number, Glyph> } };
  const chars = entry.data.chars;
  for (const c of Object.values(chars)) {
    let x0 = tile;
    let x1 = -1;
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        if (px[((c.y + y) * tex.width + c.x + x) * 4 + 3] < 128) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    }
    if (x1 < 0) continue;
    c.x += x0;
    c.width = x1 - x0 + 1;
    c.centerX = Math.floor(c.width / 2);
    c.u0 = c.x / tex.width;
    c.u1 = (c.x + c.width) / tex.width;
    c.xAdvance = c.width - (opts.overlap ?? 2);
  }
  // Sheets have no space: borrow a letter's entry with nothing to draw.
  const any = Object.values(chars)[0];
  chars[32] = { ...any, width: 0, height: 0, xAdvance: opts.space ?? 5 };
  scene.cache.bitmapFont.add(key, entry);
}

interface Glyph {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  xAdvance: number;
  u0: number;
  u1: number;
}

export interface FontSheetOptions {
  /** A loaded CSS font family, drawn at a size where its pixels land on whole pixels (Kenney Pixel at 16). */
  family: string;
  size: number;
  chars: string;
  /** Square cell each glyph is drawn into, outline included. */
  tile: number;
  charsPerRow: number;
  /** Baseline within a cell. */
  baseline: number;
  /** Draws a one-pixel outline of this colour round each glyph. */
  outline?: string;
}

/**
 * Draws a pixel TTF's glyphs into a sheet texture with hard edges (canvas text comes out
 * antialiased, so alpha is thresholded) for `createPixelFont` to trim into a bitmap font.
 */
export function drawFontSheet(scene: Phaser.Scene, key: string, opts: FontSheetOptions) {
  if (scene.textures.exists(key)) return;
  const { tile, charsPerRow, chars } = opts;
  const rows = Math.ceil(chars.length / charsPerRow);
  const tex = scene.textures.createCanvas(key, charsPerRow * tile, rows * tile)!;
  const ctx = tex.context;
  ctx.font = `${opts.size}px "${opts.family}"`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  [...chars].forEach((ch, i) => ctx.fillText(ch, (i % charsPerRow) * tile + 1, Math.floor(i / charsPerRow) * tile + opts.baseline));
  const img = ctx.getImageData(0, 0, tex.width, tex.height);
  const px = img.data;
  const on = new Uint8Array(tex.width * tex.height);
  for (let i = 0; i < on.length; i++) on[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  const edge = opts.outline ? Phaser.Display.Color.HexStringToColor(opts.outline) : undefined;
  for (let y = 0; y < tex.height; y++) {
    for (let x = 0; x < tex.width; x++) {
      const i = y * tex.width + x;
      const o = i * 4;
      if (on[i]) {
        px.set([255, 255, 255, 255], o);
        continue;
      }
      // Outline pixels touch a glyph pixel side-on or corner to corner, within the same cell.
      let near = false;
      if (edge) {
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1 && !near; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (Math.floor(nx / tile) !== Math.floor(x / tile) || Math.floor(ny / tile) !== Math.floor(y / tile)) continue;
            near = on[ny * tex.width + nx] === 1;
          }
        }
      }
      if (near && edge) px.set([edge.red, edge.green, edge.blue, 255], o);
      else px[o + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
}
