import type * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

export const SHEET = 'sports';
const IMPACT = 'Audio/Impact Sounds/Audio';
const UI = 'Audio/Interface Sounds/Audio';
const HIT = 'Audio/Music Jingles/Audio (Hit)';
const FIGHT = 'Audio/Voiceover Pack Fighter/Audio';

export const SFX = {
  kick: [0, 1].map((n) => `${IMPACT}/impactPunch_heavy_00${n}.ogg`),
  save: [0, 1].map((n) => `${IMPACT}/impactSoft_heavy_00${n}.ogg`),
  net: [0, 1].map((n) => `${IMPACT}/impactGeneric_light_00${n}.ogg`),
  post: [`${IMPACT}/impactMetal_heavy_000.ogg`],
  thud: [0, 1].map((n) => `${IMPACT}/impactPlate_heavy_00${n}.ogg`),
  whoosh: [1, 2, 3].map((n) => `Audio/Foley Sounds/Audio/Woosh/woosh${n}.ogg`),
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [`${UI}/tick_002.ogg`],
  nope: [`${UI}/error_004.ogg`],
  goal: [`${HIT}/jingles-hit_00.ogg`],
  saved: [`${HIT}/jingles-hit_04.ogg`],
  missed: [`${HIT}/jingles-hit_10.ogg`],
  conceded: [`${HIT}/jingles-hit_01.ogg`],
  round1: [`${FIGHT}/round_1.ogg`],
  round2: [`${FIGHT}/round_2.ogg`],
  round3: [`${FIGHT}/round_3.ogg`],
  round4: [`${FIGHT}/round_4.ogg`],
  round5: [`${FIGHT}/round_5.ogg`],
  sudden: [`${FIGHT}/sudden_death.ogg`],
  youWin: [`${FIGHT}/you_win.ogg`],
  youLose: [`${FIGHT}/you_lose.ogg`],
  winner: [`${FIGHT}/winner.ogg`],
} satisfies SfxGroups;

export function preloadAssets(scene: Phaser.Scene) {
  const dir = '2D assets/Sports Pack/Spritesheet';
  scene.load.atlasXML(SHEET, kenney(`${dir}/sheet_charactersEquipment.png`), kenney(`${dir}/sheet_charactersEquipment.xml`));
  preloadSfx(scene, SFX);
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Drumming Sticks.ogg'));
}
