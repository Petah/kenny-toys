import * as Phaser from 'phaser';

/** A number drawn with the pack's outlined digits, centred on its position. */
export class SpriteNumber extends Phaser.GameObjects.Container {
  private value?: string;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    scene.add.existing(this);
  }

  set(value: number) {
    const text = String(value);
    if (text === this.value) return this;
    this.value = text;
    this.removeAll(true);
    let x = 0;
    for (const ch of text) {
      const img = this.scene.add.image(x, 0, `number${ch}.png`).setOrigin(0, 0.5);
      this.add(img);
      x += img.width - 4;
    }
    const offset = -(x + 4) / 2;
    this.each((c: Phaser.GameObjects.Image) => (c.x += offset));
    return this;
  }
}
