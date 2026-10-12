import * as Phaser from 'phaser';
import { FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { SFX } from './assets';
import type { Level } from './levels';

export const WIDTH = 1280;
export const HEIGHT = 720;
/** Top of the ground; level coordinates are measured up from here. */
export const GROUND = 640;

export const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#24506a',
  strokeThickness: 10,
  align: 'center',
};

const GROUND_TILE: Record<Level['backdrop'], string> = { grass: 'grass.png', land: 'grass.png', desert: 'sand.png', shroom: 'sand.png' };
const DECOR: Record<Level['backdrop'], [string, number][]> = {
  grass: [['bush.png', 120], ['bush.png', 560], ['rock.png', 660]],
  land: [['bush.png', 90], ['rock.png', 520], ['bush.png', 640]],
  desert: [['cactus.png', 80], ['rock.png', 470], ['cactus.png', 600]],
  shroom: [['rock.png', 110], ['bush.png', 500], ['rock.png', 640]],
};

/** Sky, distant hills and the ground strip. */
export function drawBackdrop(scene: Phaser.Scene, backdrop: Level['backdrop']) {
  // The backgrounds tile sideways; their hill line sits about two thirds of the way down.
  for (const x of [0, 1024]) scene.add.image(x, -150, `bg:${backdrop}`).setOrigin(0);
  for (const [frame, x] of DECOR[backdrop]) {
    scene.add.image(x, GROUND + 6, 'tiles', frame).setOrigin(0.5, 1).setScale(0.8);
  }
  const ground = scene.add.tileSprite(0, GROUND, WIDTH + 200, HEIGHT - GROUND + 80, 'tiles', GROUND_TILE[backdrop]).setOrigin(0);
  ground.setTileScale(80 / 70);
  return ground;
}

export interface Button {
  zone: Phaser.GameObjects.Zone;
  parts: Phaser.GameObjects.GameObject[];
}

/** A chunky rounded button. Returns its parts so callers can put them in an overlay container. */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: { w?: number; h?: number; color?: number; size?: number; disabled?: boolean } = {},
): Button {
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
    .text(x, y, label, { ...TEXT, fontSize: `${opts.size ?? 34}px`, strokeThickness: 6, stroke: '#1d3b4c' })
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
      playSfx(scene, SFX, 'click');
      onClick();
    });
  }
  return { zone, parts: [g, text, zone] };
}

/** Three stars in a row, gold for earned ones. */
export function starRow(scene: Phaser.Scene, x: number, y: number, earned: number, scale: number, gap: number) {
  return [0, 1, 2].map((i) =>
    scene.add
      .image(x + (i - 1) * gap, y - (i === 1 ? gap * 0.15 : 0), 'tiles', i < earned ? 'starGold.png' : 'starSilver.png')
      // Trim the frame edge: scaled up, the neighbouring atlas frames bleed in as thin lines.
      .setCrop(2, 2, 66, 66)
      .setScale(scale)
      .setAlpha(i < earned ? 1 : 0.55),
  );
}
