import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { SFX, createShared, preloadAssets } from './assets';
import { LEVELS } from './levels';
import { isUnlocked, loadProgress } from './progress';
import { BUTTON_COLOUR, GOLD, TEXT, button, drawSpace, starRow } from './ui';

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
    createShared(this);
    const { width, height } = this.scale;
    const portrait = height > width;
    this.cameras.main.setBackgroundColor(0x3a2e3f);
    drawSpace(this, 'title');

    // A probe looping round a planet.
    const top = portrait ? 150 : 90;
    const cx = width / 2;
    const cy = top + 110;
    this.add.image(cx, cy, 'glow').setDisplaySize(300, 300).setTint(0x9f8cff).setAlpha(0.25);
    const planet = this.add.image(cx, cy, 'planet:9').setDisplaySize(150, 150);
    this.tweens.add({ targets: planet, angle: 360, duration: 40000, repeat: -1 });
    const probe = this.add.image(0, 0, 'probe').setScale(0.4);
    const orbit = { a: 0 };
    this.tweens.add({
      targets: orbit,
      a: Math.PI * 2,
      duration: 3600,
      repeat: -1,
      onUpdate: () => {
        // An ellipse, tipped so the probe passes in front of the planet low down and behind it up top.
        const x = Math.cos(orbit.a) * 190;
        const y = Math.sin(orbit.a) * 46;
        probe.setPosition(cx + x, cy + y - x * 0.18).setRotation(orbit.a + Math.PI);
        probe.setDepth(Math.sin(orbit.a) > 0 ? 2 : 0);
        planet.setDepth(1);
      },
    });

    const title = this.add.text(width / 2, top + 260, 'SLINGSHOT', { ...TEXT, fontSize: portrait ? '76px' : '96px', strokeThickness: portrait ? 12 : 16 }).setOrigin(0.5);
    title.setScale(0);
    this.tweens.add({ targets: title, scale: 1, duration: 500, ease: 'Back.easeOut' });
    this.add
      .text(width / 2, top + (portrait ? 356 : 352), portrait ? 'swing round the planets\nto reach the station' : 'swing round the planets to reach the station', {
        ...TEXT,
        fontSize: portrait ? '26px' : '30px',
        strokeThickness: 7,
        color: GOLD,
      })
      .setOrigin(0.5);

    const progress = loadProgress();
    const total = progress.stars.reduce((a, b) => a + (b ?? 0), 0);
    if (total > 0) {
      const label = this.add.text(width - 28, 40, `${total} / ${LEVELS.length * 3}`, { ...TEXT, fontSize: '32px', strokeThickness: 7 }).setOrigin(1, 0.5);
      this.add.image(label.x - label.width - 26, 40, 'star').setScale(1.1);
    }

    const cols = portrait ? 3 : 5;
    const gapX = portrait ? 190 : 180;
    const gapY = 150;
    const gridTop = top + (portrait ? 530 : 470);
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
        color: stars === 3 ? 0xe0a526 : cleared ? 0x2ecc71 : BUTTON_COLOUR,
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
    this.cameras.main.fadeOut(180, 58, 46, 63);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('level', { level: i }));
  }
}
