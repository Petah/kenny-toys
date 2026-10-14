import * as Phaser from 'phaser';
import { padAtlas } from '@shared/atlas';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

const UFO = '2D assets/Alien UFO Pack/Spritesheets';
const ANIMALS = '2D assets/Animal Pack Remastered/Spritesheet/round';
const SCENERY = '2D assets/Background Elements Remastered';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';
const UI = 'Audio/Interface Sounds/Audio';

export const SFX = {
  beamOn: ['Audio/Sci-Fi Sounds/Audio/forceField_000.ogg'],
  abduct: [1, 2, 3].map((n) => `Audio/Digital Audio/Audio/phaserUp${n}.ogg`),
  land: [0, 1, 2].map((n) => `Audio/Impact Sounds/Audio/impactSoft_medium_00${n}.ogg`),
  ram: ['Audio/Impact Sounds/Audio/impactMetal_heavy_000.ogg'],
  clang: [0, 2].map((n) => `Audio/Sci-Fi Sounds/Audio/impactMetal_00${n}.ogg`),
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  tick: [1, 2].map((n) => `${UI}/tick_00${n}.ogg`),
  wanted: [`${UI}/confirmation_001.ogg`],
  order: ['Audio/Music Jingles/Audio (Retro)/jingles-retro_04.ogg'],
  record: ['Audio/Music Jingles/Audio (Retro)/jingles-retro_10.ogg'],
} satisfies SfxGroups;

export const VOICES = ['go', 'hurry_up', 'time_over', 'new_highscore'] as const;
export type Voice = (typeof VOICES)[number];

/** Texture keys. Each atlas is repacked with gaps between frames (see padAtlas). */
export const SHIPS = 'ships';
export const LASERS = 'lasers';
export const ZOO = 'animals';
export const PROPS = 'props';

export function preloadAssets(scene: Phaser.Scene) {
  scene.load.atlasXML(`${SHIPS}:raw`, kenney(`${UFO}/spritesheet_spaceships.png`), kenney(`${UFO}/spritesheet_spaceships.xml`));
  scene.load.atlasXML(`${LASERS}:raw`, kenney(`${UFO}/spritesheet_lasers.png`), kenney(`${UFO}/spritesheet_lasers.xml`));
  scene.load.atlasXML(`${ZOO}:raw`, kenney(`${ANIMALS}.png`), kenney(`${ANIMALS}.xml`));
  scene.load.atlasXML(`${PROPS}:raw`, kenney(`${SCENERY}/Spritesheet/spritesheet_default.png`), kenney(`${SCENERY}/Spritesheet/spritesheet_default.xml`));
  for (const layer of ['hills', 'hillsLarge', 'groundLayer1', 'cloudLayer1']) {
    scene.load.image(layer, kenney(`${SCENERY}/Backgrounds/Elements/${layer}.png`));
  }
  preloadSfx(scene, SFX);
  scene.load.audio('hum', kenney('Audio/Sci-Fi Sounds/Audio/spaceEngineLow_000.ogg'));
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Space Cadet.ogg'));
}

export function unpackAtlases(scene: Phaser.Scene) {
  for (const key of [SHIPS, LASERS, ZOO, PROPS]) padAtlas(scene, `${key}:raw`, key);
}

/** One kind of farm animal. The pack draws each as a round face, sometimes with ears or horns above it. */
export interface Animal {
  name: string;
  /** Diameter of the round face in world units. */
  size: number;
  /** How fast the beam lifts it, in units a second. */
  rise: number;
  points: number;
  /** How often it turns up, relative to the others. */
  weight: number;
  /** The bull: beam it aboard and it rams the ship. */
  angry?: boolean;
}

export const ANIMAL_TYPES: Animal[] = [
  { name: 'chick', size: 38, rise: 300, points: 10, weight: 3 },
  { name: 'chicken', size: 46, rise: 260, points: 15, weight: 2 },
  { name: 'duck', size: 46, rise: 260, points: 15, weight: 2 },
  { name: 'rabbit', size: 46, rise: 250, points: 20, weight: 2 },
  { name: 'pig', size: 58, rise: 190, points: 30, weight: 2 },
  { name: 'cow', size: 66, rise: 140, points: 50, weight: 2 },
  { name: 'horse', size: 66, rise: 145, points: 50, weight: 1.2 },
  // No goat: brown with horns, it's too easily mistaken for the bull.
  { name: 'buffalo', size: 72, rise: 160, points: 0, weight: 0, angry: true },
];

/** Face circle in an animal frame: the bottom 128px of the frame, centred across it. */
export const FACE_PX = 128;

export const SHIP_COLOURS = ['Green', 'Yellow', 'Blue', 'Beige', 'Pink'] as const;
export type ShipColour = (typeof SHIP_COLOURS)[number];

/** The unmanned damage frames, numbered the pack's slightly irregular way for each colour. */
export const DAMAGE_FRAMES: Record<ShipColour, [string, string]> = {
  Green: ['shipGreen_damage1.png', 'shipGreen_damage2.png'],
  Yellow: ['shipYellow_damage1.png', 'shipYellow_damage2.png'],
  Blue: ['shipBlue_damage1.png', 'shipBlue_damage2.png'],
  Beige: ['shipBeige_damage1.png', 'shipBeige_damage2.png'],
  Pink: ['shipPink_damage.png', 'shipPink_damage1.png'],
};
