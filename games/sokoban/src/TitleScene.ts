import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { FRAMES, SFX, createAnims, preloadAssets } from './assets';
import { LEVELS } from './levels';
import { isUnlocked, loadProgress } from './progress';
import { TEXT, button, coinRow } from './ui';

/** The title and level select are laid out in this box, then scaled to fit the page. */
const BOX_W = 640;
const BOX_H = 760;

/** Title and level select. */
export class TitleScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;

  constructor() {
    super('title');
  }

  preload() {
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2 - 150, height / 2, 0, 14, 0xffffff).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2, 304, 22).setStrokeStyle(3, 0xffffff);
    this.load.on('progress', (v: number) => (bar.width = 300 * v));
    this.load.once('complete', () => this.children.removeAll(true));
    preloadAssets(this);
  }

  create() {
    createAnims(this);
    this.root = this.add.container(0, 0);
    this.buildTitle();
    this.buildLevels();
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  private layout() {
    const { width, height } = this.scale;
    // Leave room for the "All toys" link above, and a little air at the sides.
    const top = width < 700 ? 52 : 0;
    const scale = Math.min((width - 24) / BOX_W, (height - top - 12) / BOX_H, 1.15);
    this.root.setScale(scale).setPosition(width / 2, top + (height - top) / 2);
  }

  private buildTitle() {
    const face = this.add.image(0, -BOX_H / 2 + 70, 'soko', FRAMES.face).setScale(1.6);
    // Scaled up, the neighbouring atlas frame bleeds in along the edge; trim a pixel.
    face.setCrop(1, 1, face.width - 2, face.height - 2);
    this.tweens.add({ targets: face, y: face.y - 8, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
    const crates = (['red', 'plain', 'green', 'blue'] as const).map((color, i) => {
      const x = (i < 2 ? -1 : 1) * (150 + (i % 2) * 70);
      const img = this.add.image(x, -BOX_H / 2 + 80, 'soko', FRAMES.crate[color]).setScale(0.8).setAngle(i % 2 ? 8 : -8);
      this.tweens.add({ targets: img, angle: -img.angle, yoyo: true, repeat: -1, duration: 900 + i * 120, ease: 'Sine.easeInOut' });
      return img;
    });
    const title = this.add.text(0, -BOX_H / 2 + 170, 'SOKOBAN', { ...TEXT, fontSize: '80px', strokeThickness: 13 }).setOrigin(0.5);
    title.setScale(0);
    this.tweens.add({ targets: title, scale: 1, duration: 500, ease: 'Back.easeOut' });
    const sub = this.add
      .text(0, -BOX_H / 2 + 238, 'push every crate onto its spot', { ...TEXT, fontSize: '23px', strokeThickness: 6, color: '#ffe27a' })
      .setOrigin(0.5);
    this.root.add([face, ...crates, title, sub]);

    const total = loadProgress().stars.reduce((a, b) => a + (b ?? 0), 0);
    if (total > 0) {
      const label = this.add.text(BOX_W / 2 - 10, -BOX_H / 2 + 300, `${total} / ${LEVELS.length * 3}`, { ...TEXT, fontSize: '26px', strokeThickness: 6 }).setOrigin(1, 0.5);
      const coin = this.add.image(label.x - label.width - 22, label.y, 'soko', FRAMES.coin).setScale(1.2);
      this.root.add([label, coin]);
    }
  }

  private buildLevels() {
    const progress = loadProgress();
    const cols = 4;
    const gapX = 148;
    const gapY = 128;
    const rows = Math.ceil(LEVELS.length / cols);
    const top = BOX_H / 2 - rows * gapY + 30;
    LEVELS.forEach((_level, i) => {
      const x = ((i % cols) - (cols - 1) / 2) * gapX;
      const y = top + Math.floor(i / cols) * gapY;
      const open = isUnlocked(i);
      const coins = progress.stars[i] ?? 0;
      const btn = button(this, open ? String(i + 1) : '🔒', () => this.startLevel(i), {
        w: 124,
        h: 92,
        size: open ? 48 : 34,
        color: coins === 3 ? 0xe0a526 : coins ? 0x3aa55c : 0x3d7fb8,
        disabled: !open,
      });
      btn.setPosition(x, y);
      const parts: Phaser.GameObjects.GameObject[] = [btn];
      if (open && coins) {
        const row = this.add.container(x, y + 50, coinRow(this, coins, 0.85, 30));
        parts.push(row);
      }
      if (!open) {
        const zone = this.add.zone(x, y, 124, 92).setInteractive();
        zone.on('pointerup', () => playSfx(this, SFX, 'fail', { volume: 0.4 }));
        parts.push(zone);
      }
      this.root.add(parts);
      this.tweens.add({ targets: parts, alpha: { from: 0, to: open ? 1 : 0.6 }, delay: 150 + i * 50, duration: 250 });
    });
  }

  private startLevel(i: number) {
    this.cameras.main.fadeOut(180, 78, 91, 102);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('level', { level: i }));
  }
}
