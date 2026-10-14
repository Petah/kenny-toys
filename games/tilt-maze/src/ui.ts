import * as Phaser from 'phaser';
import { FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { makeButton as sharedButton, type ButtonOptions } from '@shared/ui';
import { CELL, COLS, ROWS } from './maze';
import { SFX } from './assets';

export const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#1f5f8b',
  strokeThickness: 8,
  align: 'center',
};

/** Room above the board for the title; portrait leaves extra so the "All toys" link doesn't cover it. */
export const hudHeight = (portrait: boolean) => (portrait ? 124 : 76);
/** Room below the board for the stars, buttons and timer. */
export const FOOT_H = 84;
/** Gap around the board, for its frame. */
export const PAD = 24;

/** Game size for a landscape or portrait screen. Portrait plays every level mirrored on its diagonal. */
export function gameSize(portrait: boolean) {
  const boardW = (portrait ? ROWS : COLS) * CELL;
  const boardH = (portrait ? COLS : ROWS) * CELL;
  return { width: boardW + PAD * 2, height: hudHeight(portrait) + boardH + PAD * 2 + FOOT_H };
}

export const isPortrait = () => window.innerHeight > window.innerWidth;

/** A button drawn around (0, 0) inside a container, so it's easy to place. */
export function button(scene: Phaser.Scene, label: string, onClick: () => void, opts: Omit<ButtonOptions, 'textStyle'> = {}) {
  const { parts } = sharedButton(scene, 0, 0, label, onClick, { textStyle: TEXT, onPress: () => playSfx(scene, SFX, 'click'), ...opts });
  return scene.add.container(0, 0, parts);
}

/** Three stars in a row, outlines for the ones not collected. */
export function starRow(scene: Phaser.Scene, earned: number, scale: number, gap: number) {
  return [0, 1, 2].map((i) =>
    scene.add.image((i - 1) * gap, i === 1 ? -gap * 0.12 : 0, 'rb', i < earned ? 'star.png' : 'star_outline.png').setScale(scale),
  );
}

/** Seconds as m:ss.t */
export function formatTime(tenths: number) {
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}
