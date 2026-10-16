import type * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

const DIR = '2D assets/Puzzle Pack 2/Spritesheet';
const UI = 'Audio/Interface Sounds/Audio';
const DIGI = 'Audio/Digital Audio/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

/** Each kind of gem: its colour's sheet and a shape all its own, so colour isn't the only clue. The orange sheet is numbered one behind the others. */
export const GEMS = [
  { sheet: 'Red', frame: 'tileRed', shape: 36, colour: 0xe8473a },
  { sheet: 'Oranges', frame: 'tileOrange', shape: 34, colour: 0xf28a24 },
  { sheet: 'Yellow', frame: 'tileYellow', shape: 33, colour: 0xf5c400 },
  { sheet: 'Green', frame: 'tileGreen', shape: 28, colour: 0x5cb83a },
  { sheet: 'Blue', frame: 'tileBlue', shape: 34, colour: 0x3a9ae8 },
  { sheet: 'Pink', frame: 'tilePink', shape: 31, colour: 0xf06ab0 },
];
/** The same shapes with a white outline (row 5 of each sheet), for special gems. */
export const OUTLINED = 24;
export const RAINBOW = { sheet: 'Grey', frame: 'tileGrey', shape: 57 };

export const gemFrame = (kind: number, outlined = false) => {
  const g = GEMS[kind];
  return { key: `tiles${g.sheet}`, frame: `${g.frame}_${String(g.shape + (outlined ? OUTLINED : 0)).padStart(2, '0')}.png` };
};

export const SFX = {
  pick: [`${UI}/select_001.ogg`],
  swap: [`${UI}/select_004.ogg`],
  nope: [`${UI}/error_004.ogg`],
  pop: [1, 2, 3].map((n) => `${UI}/glass_00${n}.ogg`),
  made: [`${DIGI}/powerUp4.ogg`],
  blast: [`${DIGI}/phaserUp3.ogg`],
  boom: [0, 1, 2].map((n) => `Audio/Impact Sounds/Audio/impactSoft_heavy_00${n}.ogg`),
  rainbow: [`${DIGI}/zapThreeToneUp.ogg`],
  cascade: [`${DIGI}/powerUp9.ogg`],
  land: [`${UI}/click_001.ogg`, `${UI}/click_002.ogg`],
  tick: [`${UI}/tick_002.ogg`],
  shuffle: [`${UI}/maximize_003.ogg`],
  buzzer: [`${DIGI}/lowThreeTone.ogg`],
  go: [`${VOICE}/go.ogg`],
  hurry: [`${VOICE}/hurry_up.ogg`],
  timeOver: [`${VOICE}/time_over.ogg`],
  best: [`${VOICE}/new_highscore.ogg`],
  done: ['Audio/Music Jingles/Audio (Pizzicato)/jingles-pizzicato_02.ogg'],
  meh: ['Audio/Music Jingles/Audio (Pizzicato)/jingles-pizzicato_05.ogg'],
} satisfies SfxGroups;

export function preloadAssets(scene: Phaser.Scene) {
  for (const sheet of [...GEMS.map((g) => g.sheet), 'Grey']) {
    scene.load.atlasXML(`tiles${sheet}`, kenney(`${DIR}/spritesheet_tiles${sheet}.png`), kenney(`${DIR}/spritesheet_tiles${sheet}.xml`));
  }
  scene.load.atlasXML('particles', kenney(`${DIR}/spritesheet_particles.png`), kenney(`${DIR}/spritesheet_particles.xml`));
  preloadSfx(scene, SFX);
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Wacky Waiting.ogg'));
}
