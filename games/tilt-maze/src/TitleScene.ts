import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { SFX, preloadAssets } from './assets';
import { LEVELS } from './levels';
import { isUnlocked, loadProgress } from './progress';
import { TEXT, button, starRow } from './ui';

/** Title and level select. */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  preload() {
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2 - 200, height / 2, 0, 16, 0xffffff).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2, 404, 24).setStrokeStyle(3, 0xffffff);
    this.load.on('progress', (v: number) => (bar.width = 400 * v));
    this.load.once('complete', () => this.children.removeAll(true));
    preloadAssets(this);
  }

  create() {
    const { width, height } = this.scale;
    const portrait = height > width;
    this.add.tileSprite(0, 0, width, height, 'rb', 'background_blue.png').setOrigin(0);
    this.cameras.main.setBackgroundColor(0x3498db);

    // A ball rolling to and fro along a little track, about to drop into a goal.
    const top = portrait ? 150 : 90;
    const track = this.add.nineslice(width / 2, top + 150, 'rb', 'block_square.png', Math.min(width - 120, 560), 40, 14, 14, 14, 14);
    const goal = this.add.image(width / 2 + track.width / 2 - 50, top + 60, 'rb', 'hole_large_end.png').setScale(0.8);
    const ball = this.add.image(width / 2 - track.width / 2 + 40, top + 112, 'rb', 'ball_red_large.png').setScale(0.56);
    this.tweens.add({ targets: ball, x: goal.x - 70, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: track, angle: { from: -3, to: 3 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const title = this.add.text(width / 2, top + 250, 'TILT MAZE', { ...TEXT, fontSize: portrait ? '68px' : '96px', strokeThickness: portrait ? 12 : 16 }).setOrigin(0.5);
    title.setScale(0);
    this.tweens.add({ targets: title, scale: 1, duration: 500, ease: 'Back.easeOut' });
    this.add
      .text(width / 2, top + 330, portrait ? 'tilt your phone to roll home' : 'tilt the board to roll the ball home', {
        ...TEXT,
        fontSize: portrait ? '24px' : '30px',
        strokeThickness: 7,
        color: '#ffe27a',
      })
      .setOrigin(0.5);

    const progress = loadProgress();
    const total = progress.stars.reduce((a, b) => a + (b ?? 0), 0);
    if (total > 0) {
      const label = this.add.text(width - 28, 40, `${total} / ${LEVELS.length * 3}`, { ...TEXT, fontSize: '32px', strokeThickness: 7 }).setOrigin(1, 0.5);
      this.add.image(label.x - label.width - 26, 40, 'rb', 'star.png').setScale(1.3);
    }

    const cols = portrait ? 3 : 5;
    const gapX = portrait ? 190 : 180;
    const gapY = 150;
    const gridTop = top + (portrait ? 470 : 440);
    LEVELS.forEach((_level, i) => {
      const x = width / 2 + ((i % cols) - (cols - 1) / 2) * gapX;
      const y = gridTop + Math.floor(i / cols) * gapY;
      const open = isUnlocked(i);
      const stars = progress.stars[i] ?? 0;
      const cleared = (progress.best[i] ?? 0) > 0;
      const btn = button(this, String(i + 1), () => this.startLevel(i), {
        icon: open ? undefined : 'locked.png',
        w: 150,
        h: 104,
        size: open ? 54 : 38,
        color: stars === 3 ? 0xe0a526 : cleared ? 0x2ecc71 : 0x2a78b5,
        disabled: !open,
      });
      btn.setPosition(x, y);
      const parts: Phaser.GameObjects.GameObject[] = [btn];
      if (cleared) parts.push(this.add.container(x, y + 60, starRow(this, stars, 1, 36)));
      if (!open) {
        const zone = this.add.zone(x, y, 150, 104).setInteractive();
        zone.on('pointerup', () => playSfx(this, SFX, 'fail', { volume: 0.4 }));
        parts.push(zone);
      }
      this.tweens.add({ targets: parts, alpha: { from: 0, to: open ? 1 : 0.6 }, delay: 150 + i * 50, duration: 250 });
    });
  }

  private startLevel(i: number) {
    this.cameras.main.fadeOut(180, 52, 152, 219);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('level', { level: i }));
  }
}
