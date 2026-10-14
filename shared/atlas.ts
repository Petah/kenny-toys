import * as Phaser from 'phaser';

/**
 * Copies a loaded atlas into a new texture with clear gaps between frames, under the same frame
 * names, then drops the original. Many Kenney sheets pack frames edge to edge, so scaled sprites
 * pick up hairlines of their neighbours; the gaps stop that.
 */
export function padAtlas(scene: Phaser.Scene, rawKey: string, key: string, pad = 4) {
  if (scene.textures.exists(key)) return;
  const raw = scene.textures.get(rawKey);
  const frames = raw.getFrameNames().map((name) => ({ name, f: raw.get(name) }));
  const cellW = Math.max(...frames.map(({ f }) => f.cutWidth)) + pad * 2;
  const cellH = Math.max(...frames.map(({ f }) => f.cutHeight)) + pad * 2;
  const cols = Math.ceil(Math.sqrt(frames.length));
  const tex = scene.textures.createCanvas(key, cols * cellW, Math.ceil(frames.length / cols) * cellH)!;
  frames.forEach(({ name, f }, i) => {
    const x = (i % cols) * cellW + pad;
    const y = Math.floor(i / cols) * cellH + pad;
    tex.context.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, x, y, f.cutWidth, f.cutHeight);
    tex.add(name, 0, x, y, f.cutWidth, f.cutHeight);
  });
  tex.refresh();
  scene.textures.remove(rawKey);
}
