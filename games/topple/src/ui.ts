import * as Phaser from 'phaser';
import { FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { makeButton as sharedButton, type ButtonOptions } from '@shared/ui';
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

/** The shared button in Topple's lettering, with a click on every press. */
export function makeButton(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void, opts: Omit<ButtonOptions, 'textStyle'> = {}) {
  return sharedButton(scene, x, y, label, onClick, { textStyle: TEXT, onPress: () => playSfx(scene, SFX, 'click'), ...opts });
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
