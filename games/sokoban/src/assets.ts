import * as Phaser from 'phaser';
import { preloadIcons } from '@shared/icons';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';
import type { Dir, Color } from './sokoban';
import type { Theme } from './levels';

const PACK = '2D assets/Sokoban Pack/Spritesheet/sokoban_spritesheet';
const IMPACT = 'Audio/Impact Sounds/Audio';
const UI = 'Audio/Interface Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';
const five = (name: string) => [0, 1, 2, 3, 4].map((n) => `${IMPACT}/${name}_00${n}.ogg`);

export const SFX = {
  step: five('footstep_concrete'),
  push: five('impactWood_medium'),
  bump: five('impactSoft_medium'),
  home: [`${UI}/confirmation_002.ogg`],
  unhome: [`${UI}/drop_002.ogg`],
  undo: [`${UI}/back_001.ogg`, `${UI}/back_002.ogg`],
  click: [`${UI}/click_001.ogg`, `${UI}/click_002.ogg`],
  fail: [`${UI}/error_004.ogg`],
  coin: ['a', 'b'].map((v) => `2D assets/Desert Shooter Pack/Sounds/coin-${v}.ogg`),
} satisfies SfxGroups;

export const JINGLES = {
  win: 'Audio/Music Jingles/Audio (Retro)/jingles-retro_04.ogg',
  finale: 'Audio/Music Jingles/Audio (Retro)/jingles-retro_10.ogg',
};

export const VOICES = ['level', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'objective_achieved', 'congratulations', 'new_highscore'] as const;
export type Voice = (typeof VOICES)[number];

/** Atlas frames, picked out of the pack's numbered sheet. */
export const FRAMES = {
  wall: { brick: 'block_01.png', stone: 'block_02.png', wood: 'block_03.png' } satisfies Record<Theme, string>,
  ground: { brick: 'ground_03.png', stone: 'ground_01.png', wood: 'ground_05.png' } satisfies Record<Theme, string>,
  crate: { plain: 'crate_02.png', red: 'crate_03.png', blue: 'crate_04.png', green: 'crate_05.png' } satisfies Record<Color, string>,
  /** The same crates, darker: how the pack shows one that's been put away. */
  crateHome: { plain: 'crate_07.png', red: 'crate_08.png', blue: 'crate_09.png', green: 'crate_10.png' } satisfies Record<Color, string>,
  target: { plain: 'environment_02.png', red: 'environment_05.png', blue: 'environment_08.png', green: 'environment_10.png' } satisfies Record<Color, string>,
  coin: 'environment_11.png',
  face: 'playerFace.png',
  /** Standing frame first, then the two stepping frames. */
  player: {
    down: ['player_01.png', 'player_23.png', 'player_24.png'],
    up: ['player_02.png', 'player_03.png', 'player_04.png'],
    right: ['player_11.png', 'player_12.png', 'player_13.png'],
    left: ['player_14.png', 'player_15.png', 'player_16.png'],
  } satisfies Record<Dir, string[]>,
};

export function preloadAssets(scene: Phaser.Scene) {
  preloadIcons(scene);
  scene.load.atlasXML('soko', kenney(`${PACK}.png`), kenney(`${PACK}.xml`));
  scene.load.image('sparkle', kenney('2D assets/Particle Pack/PNG (Transparent)/star_06.png'));
  scene.load.image('puff', kenney('2D assets/Smoke Particles/PNG/White puff/whitePuff00.png'));
  preloadSfx(scene, SFX);
  for (const [name, file] of Object.entries(JINGLES)) scene.load.audio(`jingle:${name}`, kenney(file));
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Mishief Stroll.ogg'));
}

/** Walk cycles, made once at boot. */
export function createAnims(scene: Phaser.Scene) {
  for (const [dir, [stand, a, b]] of Object.entries(FRAMES.player)) {
    if (scene.anims.exists(`walk-${dir}`)) continue;
    scene.anims.create({ key: `walk-${dir}`, frames: [a, stand, b, stand].map((frame) => ({ key: 'soko', frame })), frameRate: 14, repeat: -1 });
  }
}
