import * as Phaser from 'phaser';

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
  const text = scene.add
    .text(x, y, label, { ...opts.textStyle, fontSize: `${opts.size ?? 34}px`, strokeThickness: 6, stroke: '#1d3b4c' })
    .setOrigin(0.5)
    .setAlpha(opts.disabled ? 0.6 : 1);
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
