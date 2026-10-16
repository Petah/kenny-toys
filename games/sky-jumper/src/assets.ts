import type * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

export const SHEET = 'jumper';
const DIR = '2D assets/Jumper Pack';
const UI = 'Audio/Interface Sounds/Audio';
const DIGI = 'Audio/Digital Audio/Audio';
const RETRO = 'Audio/Retro Sounds 2/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  jump: [1, 2, 3].map((n) => `${DIGI}/phaseJump${n}.ogg`),
  spring: [`${DIGI}/highUp.ogg`],
  carrot: [1, 2, 3].map((n) => `${RETRO}/coin${n}.ogg`),
  power: [`${DIGI}/powerUp2.ogg`, `${DIGI}/powerUp7.ogg`],
  stomp: [`${RETRO}/hit2.ogg`],
  hurt: [`${RETRO}/hurt3.ogg`],
  fall: [`${RETRO}/fall2.ogg`],
  crack: [0, 1, 2].map((n) => `Audio/Impact Sounds/Audio/impactWood_medium_00${n}.ogg`),
  land: [0, 1, 2].map((n) => `Audio/Impact Sounds/Audio/impactSoft_medium_00${n}.ogg`),
  poof: [`${UI}/drop_002.ogg`],
  pop: [`${UI}/glass_002.ogg`],
  shield: ['Audio/Sci-Fi Sounds/Audio/forceField_001.ogg'],
  jet: ['Audio/Sci-Fi Sounds/Audio/thrusterFire_000.ogg'],
  flap: [1, 2, 3].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  over: [`${DIGI}/lowDown.ogg`],
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [`${UI}/tick_002.ogg`],
  record: [`${DIGI}/zapTwoTone.ogg`],
  go: [`${VOICE}/go.ogg`],
  voiceOver: [`${VOICE}/game_over.ogg`],
  voiceBest: [`${VOICE}/new_highscore.ogg`],
} satisfies SfxGroups;

export function preloadAssets(scene: Phaser.Scene) {
  scene.load.atlasXML(`${SHEET}-raw`, kenney(`${DIR}/Spritesheets/spritesheet_jumper.png`), kenney(`${DIR}/Spritesheets/spritesheet_jumper.xml`));
  for (const n of [2, 3, 4]) scene.load.image(`bg${n}`, kenney(`${DIR}/PNG/Background/bg_layer${n}.png`));
  preloadSfx(scene, SFX);
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Cheerful Annoyance.ogg'));
}
