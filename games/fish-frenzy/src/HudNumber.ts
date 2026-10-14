import * as Phaser from 'phaser';
import { SHEET, frameBounds } from './assets';

const GLYPH: Record<string, string> = { '.': 'hud_dot', '+': 'hud_plus' };
for (let d = 0; d <= 9; d++) GLYPH[String(d)] = `hud_number_${d}`;

/** Gap between glyphs in frame pixels; the outlines overlap a little. */
const KERN = -2;

/**
 * A number in the pack's chunky yellow digits, grouped in thousands with the pack's dot
 * ("2.000"), as in its sample image. `align` says which edge sits on the position.
 */
export class HudNumber extends Phaser.GameObjects.Container {
  private text?: string;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private align: 'left' | 'center' | 'right' = 'center',
    private prefix = '',
  ) {
    super(scene, x, y);
    scene.add.existing(this);
  }

  set(value: number) {
    const text = this.prefix + group(Math.max(0, Math.round(value)));
    if (text === this.text) return this;
    this.text = text;
    this.removeAll(true);
    let x = 0;
    for (const ch of text) {
      const frame = GLYPH[ch];
      const b = frameBounds(this.scene, frame);
      // Line glyphs up on their visible edges. The dot's frame already sits it on the baseline.
      const img = this.scene.add.image(x - b.x, 0, SHEET, frame).setOrigin(0.5);
      this.add(img);
      x += b.w + KERN;
    }
    const width = x - KERN;
    const shift = this.align === 'left' ? 0 : this.align === 'right' ? -width : -width / 2;
    this.each((c: Phaser.GameObjects.Image) => (c.x += shift));
    return this;
  }
}

function group(n: number) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
