import * as Phaser from 'phaser';

/** A number drawn with the pack's chunky HUD digits, optionally prefixed with "+". */
export class SpriteNumber extends Phaser.GameObjects.Container {
  private value?: string;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private small = false,
    private align: 'left' | 'center' | 'right' = 'left',
  ) {
    super(scene, x, y);
    scene.add.existing(this);
  }

  set(value: number | string, plus = false) {
    const text = `${plus ? '+' : ''}${value}`;
    if (text === this.value) return this;
    this.value = text;
    this.removeAll(true);
    const suffix = this.small ? '_small' : '';
    const name = (ch: string) => (ch === '+' ? 'plus' : ch === ':' ? 'dots' : ch);
    let x = 0;
    for (const ch of text) {
      const img = this.scene.add.image(x, 0, 'hud', `text_${name(ch)}${suffix}.png`).setOrigin(0, 0.5);
      this.add(img);
      x += img.width - (this.small ? 3 : 5);
    }
    const offset = this.align === 'left' ? 0 : this.align === 'center' ? -x / 2 : -x;
    this.each((c: Phaser.GameObjects.Image) => (c.x += offset));
    return this;
  }
}
