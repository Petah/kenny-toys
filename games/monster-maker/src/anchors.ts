import * as Phaser from 'phaser';
import { categorize } from './catalog';

/**
 * Works out each limb's pivot from its pixels so arms swing from the shoulder, legs
 * from the hip and horns from their base, without hand-tuning ~100 frames.
 * Shoulders and hips are the round blob at the top of the art; horns, ears and
 * antennae attach at their bottom edge.
 */
export function computeAnchors(textures: Phaser.Textures.TextureManager, key: string) {
  const texture = textures.get(key);
  const source = texture.getSourceImage() as HTMLImageElement;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);

  const anchors = new Map<string, { x: number; y: number }>();
  for (const name of texture.getFrameNames()) {
    const category = categorize(name);
    const frame = texture.get(name);
    const { cutX, cutY, cutWidth: w, cutHeight: h } = frame;

    let band: [number, number] | undefined;
    if (category === 'arms' || category === 'legs') band = [0, Math.round(Math.min(w, h) * 0.5)];
    else if (category === 'extras') band = [Math.round(h * 0.75), h];
    if (!band) continue;

    const { data } = ctx.getImageData(cutX, cutY + band[0], w, band[1] - band[0]);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 128) continue;
      const p = (i - 3) / 4;
      sx += p % w;
      sy += Math.floor(p / w);
      n++;
    }
    if (n) anchors.set(name, { x: sx / n / w, y: (band[0] + sy / n) / h });
  }
  return anchors;
}
