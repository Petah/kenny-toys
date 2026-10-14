import * as Phaser from 'phaser';
import { ICONS } from './icons';

export interface Button {
  zone: Phaser.GameObjects.Zone;
  parts: Phaser.GameObjects.GameObject[];
}

export interface ButtonOptions {
  /** The label's style; fontSize, strokeThickness and stroke are set here. */
  textStyle: Phaser.Types.GameObjects.Text.TextStyle;
  w?: number;
  h?: number;
  color?: number;
  size?: number;
  disabled?: boolean;
  /** Draw this frame from the shared icon atlas (see icons.ts) instead of the label. */
  icon?: string;
  /** Called on every press, before onClick. Usually a click sound. */
  onPress?: () => void;
}

/** A chunky rounded button. Returns its parts so callers can put them in an overlay container. */
export function makeButton(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void, opts: ButtonOptions): Button {
  const w = opts.w ?? 200;
  const h = opts.h ?? 76;
  const color = opts.color ?? 0x3aa55c;
  const g = scene.add.graphics();
  const draw = (pressed: boolean) => {
    g.clear();
    g.fillStyle(0x000000, 0.3).fillRoundedRect(x - w / 2, y - h / 2 + 6, w, h, 18);
    g.fillStyle(opts.disabled ? 0x7a8a94 : color).fillRoundedRect(x - w / 2, y - h / 2 + (pressed ? 4 : 0), w, h, 18);
    g.lineStyle(4, 0xffffff, 0.35).strokeRoundedRect(x - w / 2 + 3, y - h / 2 + 3 + (pressed ? 4 : 0), w - 6, h - 6, 15);
  };
  draw(false);
  const size = opts.size ?? 34;
  const text = opts.icon
    ? iconLabel(scene, x, y, opts.icon, size)
    : scene.add.text(x, y, label, { ...opts.textStyle, fontSize: `${size}px`, strokeThickness: 6, stroke: '#1d3b4c' }).setOrigin(0.5);
  text.setAlpha(opts.disabled ? 0.6 : 1);
  const zone = scene.add.zone(x, y, w, h);
  if (!opts.disabled) {
    zone.setInteractive({ useHandCursor: true });
    zone.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      draw(true);
      text.y = y + 4;
    });
    zone.on('pointerout', () => {
      draw(false);
      text.y = y;
    });
    zone.on('pointerup', () => {
      draw(false);
      text.y = y;
      opts.onPress?.();
      onClick();
    });
  }
  return { zone, parts: [g, text, zone] };
}

/** An icon with a dark shadow under it, standing in for a text label's outline. Sized to `size` pixels. */
function iconLabel(scene: Phaser.Scene, x: number, y: number, frame: string, size: number) {
  const scale = (size * 1.25) / 100;
  const shadow = scene.add.image(0, 3, ICONS, frame).setScale(scale).setTint(0x1d3b4c).setAlpha(0.8);
  const icon = scene.add.image(0, 0, ICONS, frame).setScale(scale);
  return scene.add.container(x, y, [shadow, icon]);
}
