import * as Phaser from 'phaser';
import { FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { makeButton as sharedButton, type ButtonOptions } from '@shared/ui';
import { SFX } from './assets';
import { FIELD_H, FIELD_W } from './sim';

export const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#2b1d4a',
  strokeThickness: 8,
  align: 'center',
};

export const GOLD = '#ffd54a';
export const BUTTON_COLOUR = 0x5b4bb7;

/** Room above the field for the title; portrait leaves extra so the "All toys" link doesn't cover it. */
export const hudHeight = (portrait: boolean) => (portrait ? 150 : 76);
/** Room below the field for the stars, buttons and launch count. */
export const FOOT_H = 84;

/** Game size for a landscape or portrait screen. Portrait plays every level mirrored on its diagonal. */
export function gameSize(portrait: boolean) {
  const fieldW = portrait ? FIELD_H : FIELD_W;
  const fieldH = portrait ? FIELD_W : FIELD_H;
  return { width: fieldW, height: hudHeight(portrait) + fieldH + FOOT_H };
}

export const isPortrait = () => window.innerHeight > window.innerWidth;

/** A button drawn around (0, 0) inside a container, so it's easy to place. */
export function button(scene: Phaser.Scene, label: string, onClick: () => void, opts: Omit<ButtonOptions, 'textStyle'> = {}) {
  const { parts } = sharedButton(scene, 0, 0, label, onClick, { textStyle: TEXT, onPress: () => playSfx(scene, SFX, 'click'), color: BUTTON_COLOUR, ...opts });
  return scene.add.container(0, 0, parts);
}

/** Three stars in a row, dim for the ones not collected. */
export function starRow(scene: Phaser.Scene, earned: number, scale: number, gap: number) {
  return [0, 1, 2].map((i) => {
    const star = scene.add.image((i - 1) * gap, i === 1 ? -gap * 0.12 : 0, 'star').setScale(scale);
    return i < earned ? star : dimStar(star);
  });
}

/** A star not collected: pale and see-through. A dark tint would turn the gold brown. */
export const dimStar = (star: Phaser.GameObjects.Image) => star.setTint(0xb8b0d8).setAlpha(0.35);

/** The space backdrop: the pack's purple tile with twinkling stars over it. */
export function drawSpace(scene: Phaser.Scene, seed: string) {
  const { width, height } = scene.scale;
  scene.add.tileSprite(0, 0, width, height, 'backdrop').setOrigin(0);
  const rnd = new Phaser.Math.RandomDataGenerator([seed]);
  const count = Math.round((width * height) / 9000);
  for (let i = 0; i < count; i++) {
    const big = rnd.frac() < 0.15;
    const s = scene.add
      .image(rnd.between(0, width), rnd.between(0, height), big ? 'twinkle' : 'speck')
      .setScale(big ? rnd.realInRange(0.18, 0.32) : rnd.realInRange(0.25, 0.5))
      .setAlpha(rnd.realInRange(0.3, 0.8))
      .setTint(rnd.pick([0xffffff, 0xffffff, 0xd8ccff, 0xfff1c4]));
    if (big || rnd.frac() < 0.3) {
      scene.tweens.add({ targets: s, alpha: 0.15, duration: rnd.between(700, 1800), yoyo: true, repeat: -1, delay: rnd.between(0, 2000), ease: 'Sine.easeInOut' });
    }
  }
}
