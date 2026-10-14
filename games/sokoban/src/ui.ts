import * as Phaser from 'phaser';
import { FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { makeButton as sharedButton, type ButtonOptions } from '@shared/ui';
import { FRAMES, SFX } from './assets';

export const BG = 0x4e5b66;

export const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#2b343c',
  strokeThickness: 8,
  align: 'center',
};

/**
 * A button drawn around (0, 0) inside a container, so it can be moved when the page resizes.
 * The parts are built at the origin and the container carries the position.
 */
export function button(scene: Phaser.Scene, label: string, onClick: () => void, opts: Omit<ButtonOptions, 'textStyle'> = {}) {
  const { parts } = sharedButton(scene, 0, 0, label, onClick, { textStyle: TEXT, onPress: () => playSfx(scene, SFX, 'click'), ...opts });
  return scene.add.container(0, 0, parts);
}

/** Three coins in a row; the unearned ones are dark. */
export function coinRow(scene: Phaser.Scene, earned: number, scale: number, gap: number) {
  return [0, 1, 2].map((i) =>
    scene.add
      .image((i - 1) * gap, i === 1 ? -gap * 0.15 : 0, 'soko', FRAMES.coin)
      .setScale(scale)
      .setTint(i < earned ? 0xffffff : 0x3a434b)
      .setAlpha(i < earned ? 1 : 0.7),
  );
}
