import type * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';
import { COLOURS, SPECIALS } from './field';

/** The pack's double-size PNGs, drawn at half scale so they stay crisp when the field is zoomed. */
const DIR = '2D assets/Brick Pack/PNG/Double';
const UI = 'Audio/Interface Sounds/Audio';
const IMPACT = 'Audio/Impact Sounds/Audio';
const DIGI = 'Audio/Digital Audio/Audio';
const RETRO = 'Audio/Retro Sounds 2/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Male)';
const JINGLE = 'Audio/Music Jingles/Audio (Steeldrum)';

export const SIZES = [1, 2, 4, 6];
export const brickKey = (colour: string, units: number) => `brick:${colour}:${units}`;
export const specialKey = (frame: string) => `special:${frame}`;
export const BALL = 'ball';

export const SFX = {
  click: [`${UI}/select_002.ogg`],
  launch: [`${UI}/pluck_001.ogg`, `${UI}/pluck_002.ogg`],
  paddle: [0, 1, 2].map((n) => `${IMPACT}/impactSoft_medium_00${n}.ogg`),
  wall: [`${UI}/tick_001.ogg`, `${UI}/tick_004.ogg`],
  hit: [0, 1, 2].map((n) => `${IMPACT}/impactPlate_light_00${n}.ogg`),
  crack: [0, 1].map((n) => `${IMPACT}/impactPlate_heavy_00${n}.ogg`),
  stone: [0, 1].map((n) => `${IMPACT}/impactMining_00${n}.ogg`),
  pop: [1, 2, 3, 4].map((n) => `${UI}/drop_00${n}.ogg`),
  boom: [1, 2].map((n) => `${RETRO}/explosion${n}.ogg`),
  power: [`${DIGI}/powerUp2.ogg`, `${DIGI}/powerUp7.ogg`],
  release: [`${UI}/maximize_006.ogg`],
  lost: [`${DIGI}/phaserDown2.ogg`],
  combo: [`${RETRO}/coin2.ogg`],
  powerVoice: [`${VOICE}/power_up.ogg`],
  levelUp: [`${VOICE}/level_up.ogg`],
  go: [`${VOICE}/go.ogg`],
  gameOver: [`${VOICE}/game_over.ogg`],
  best: [`${VOICE}/new_highscore.ogg`],
  clear: [`${JINGLE}/jingles-steel_04.ogg`],
  done: [`${JINGLE}/jingles-steel_09.ogg`],
} satisfies SfxGroups;

export function preloadAssets(scene: Phaser.Scene) {
  for (const colour of Object.values(COLOURS)) {
    for (const n of SIZES) scene.load.image(brickKey(colour, n), kenney(`${DIR}/${colour}/brick_low_${n}.png`));
  }
  const frames = new Set([...Object.values(SPECIALS).map((s) => s.frame), 'extra_character_e']);
  for (const f of frames) scene.load.image(specialKey(f), kenney(`${DIR}/Special/${f}.png`));
  preloadSfx(scene, SFX);
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Alpha Dance.ogg'));
}

/** A white plastic ball, drawn at 4× its field size so it stays round when zoomed. */
export function makeBallTexture(scene: Phaser.Scene, r: number) {
  if (scene.textures.exists(BALL)) return;
  const s = 4;
  const R = r * s;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xb8c7d6, 1).fillCircle(R + 1, R + 1, R);
  g.fillStyle(0xffffff, 1).fillCircle(R + 1, R - 1, R - 3);
  g.fillStyle(0xffffff, 0.9).fillCircle(R - R * 0.3, R - R * 0.35, R * 0.28);
  g.generateTexture(BALL, R * 2 + 2, R * 2 + 2);
  g.destroy();
}
