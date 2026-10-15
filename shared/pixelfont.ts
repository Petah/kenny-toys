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
    c.xAdvance = c.width - 2;
  }
  // Sheets have no space: borrow a letter's entry with nothing to draw.
  const any = Object.values(chars)[0];
  chars[32] = { ...any, width: 0, height: 0, xAdvance: 5 };
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
