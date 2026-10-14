import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { SFX, createShared, preloadAssets } from './assets';
import { LEVELS } from './levels';
import { isUnlocked, loadProgress } from './progress';
import { GROUND, HEIGHT, TEXT, WIDTH, drawBackdrop, makeButton, starRow } from './ui';

/** Title and level select. */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  preload() {
    const bar = this.add.rectangle(WIDTH / 2 - 200, HEIGHT / 2, 0, 16, 0xffffff).setOrigin(0, 0.5);
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, 404, 22).setStrokeStyle(3, 0xffffff);
    this.load.on('progress', (v: number) => (bar.width = 400 * v));
    this.load.once('complete', () => this.children.removeAll(true));
    preloadAssets(this);
  }

  create() {
    createShared(this);
    drawBackdrop(this, 'grass');
    this.decorate();

    const title = this.add.text(WIDTH / 2, 102, 'TOPPLE', { ...TEXT, fontSize: '104px', strokeThickness: 18 }).setOrigin(0.5);
    title.setScale(0);
    this.tweens.add({ targets: title, scale: 1, duration: 500, ease: 'Back.easeOut' });
    this.tweens.add({ targets: title, angle: { from: -2, to: 2 }, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.easeInOut' });
    this.add.text(WIDTH / 2, 216, 'pull back, let go, knock the aliens off', { ...TEXT, fontSize: '28px', strokeThickness: 7 }).setOrigin(0.5);

    const progress = loadProgress();
    const cols = 4;
    LEVELS.forEach((_level, i) => {
      const x = WIDTH / 2 + ((i % cols) - (cols - 1) / 2) * 190;
      const y = 315 + Math.floor(i / cols) * 150;
      const open = isUnlocked(i);
      const stars = progress.stars[i] ?? 0;
      const btn = makeButton(this, x, y, open ? String(i + 1) : '🔒', () => this.startLevel(i), {
        w: 150,
        h: 110,
        size: open ? 56 : 40,
        color: stars ? 0x3aa55c : 0xf0a830,
        disabled: !open,
      });
      if (open) starRow(this, x, y + 64, stars, 0.55, 40);
      if (!open) btn.zone.setInteractive().on('pointerup', () => playSfx(this, SFX, 'fail', { volume: 0.4 }));
      this.tweens.add({ targets: btn.parts, alpha: { from: 0, to: open ? 1 : 0.6 }, delay: 150 + i * 60, duration: 250 });
    });
    const total = progress.stars.reduce((a, b) => a + (b ?? 0), 0);
    if (total > 0) {
      const label = this.add.text(WIDTH - 24, 40, `${total} / ${LEVELS.length * 3}`, { ...TEXT, fontSize: '30px', strokeThickness: 7 }).setOrigin(1, 0.5);
      this.add.image(label.x - label.width - 26, 40, 'tiles', 'starGold.png').setCrop(2, 2, 66, 66).setScale(0.7);
    }
  }

  private decorate() {
    // A little stack and its smug residents, wobbling on the left and right of the menu.
    const props: [string, string, number, number][] = [
      ['elements', 'elementWood016.png', 90, GROUND - 42],
      ['elements', 'elementWood012.png', 90, GROUND - 105],
      ['aliens', 'alienGreen_round.png', 90, GROUND - 147],
      ['elements', 'elementStone020.png', WIDTH - 90, GROUND - 66],
      ['aliens', 'alienPink_square.png', WIDTH - 90, GROUND - 153],
      ['elements', 'elementGlass012.png', WIDTH - 170, GROUND - 21],
      ['aliens', 'alienYellow_square.png', WIDTH - 170, GROUND - 63],
    ];
    for (const [atlas, frame, x, y] of props) {
      const img = this.add.image(x, y, atlas, frame).setScale(0.6);
      if (atlas === 'aliens') {
        this.tweens.add({ targets: img, scaleY: 0.52, scaleX: 0.64, y: y + 3, yoyo: true, repeat: -1, duration: 700 + x / 3, ease: 'Sine.easeInOut' });
      }
    }
  }

  private startLevel(i: number) {
    this.cameras.main.fadeOut(200, 47, 111, 143);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('level', { level: i }));
  }
}
