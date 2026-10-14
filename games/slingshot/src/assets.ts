import * as Phaser from 'phaser';
import { preloadIcons } from '@shared/icons';
import { kenney } from '@shared/kenney';
import { preloadSfx, type SfxGroups } from '@shared/phaser';

const EXT = '2D assets/Space Shooter Extension/PNG/Sprites';
const REMASTERED = '2D assets/Space Shooter Remastered';
const SCIFI = 'Audio/Sci-Fi Sounds/Audio';
const DIGITAL = 'Audio/Digital Audio/Audio';
const UI = 'Audio/Interface Sounds/Audio';
const VOICE = 'Audio/Voiceover Pack/Audio (Female)';

export const SFX = {
  launch: [`${SCIFI}/thrusterFire_000.ogg`],
  boom: [0, 1].map((n) => `${SCIFI}/explosionCrunch_00${n}.ogg`),
  star: [`${DIGITAL}/powerUp2.ogg`],
  dock: [`${SCIFI}/doorClose_000.ogg`],
  lost: [`${DIGITAL}/lowDown.ogg`],
  respawn: [`${DIGITAL}/phaseJump2.ogg`],
  hum: [`${SCIFI}/forceField_001.ogg`],
  tick: [1, 2].map((n) => `${UI}/tick_00${n}.ogg`),
  click: [1, 2].map((n) => `${UI}/click_00${n}.ogg`),
  fail: [`${UI}/error_004.ogg`],
} satisfies SfxGroups;

export const JINGLES = {
  win: 'Audio/Music Jingles/Audio (Retro)/jingles-retro_01.ogg',
  finale: 'Audio/Music Jingles/Audio (Retro)/jingles-retro_15.ogg',
};

export const VOICES = ['level', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'mission_completed', 'congratulations', 'new_highscore'] as const;
export type Voice = (typeof VOICES)[number];

export const PLANET_SKINS = 10;
export const ROCK_FRAMES = ['meteorBrown_big1', 'meteorGrey_big2', 'meteorBrown_big3', 'meteorGrey_big4', 'meteorBrown_big2', 'meteorGrey_big1'];

export function preloadAssets(scene: Phaser.Scene) {
  preloadIcons(scene);
  for (let i = 0; i < PLANET_SKINS; i++) scene.load.image(`planet:raw:${i}`, kenney(`2D assets/Planets/Planets/planet0${i}.png`));
  scene.load.image('probe', kenney(`${EXT}/Building/spaceBuilding_014.png`));
  scene.load.image('station', kenney(`${EXT}/Station/spaceStation_021.png`));
  scene.load.image('backdrop', kenney(`${REMASTERED}/Backgrounds/darkPurple.png`));
  scene.load.image('star', kenney(`${REMASTERED}/PNG/Power-ups/star_gold.png`));
  for (const name of new Set(ROCK_FRAMES)) scene.load.image(name, kenney(`${REMASTERED}/PNG/Meteors/${name}.png`));
  scene.load.image('twinkle', kenney('2D assets/Simple Space/PNG/Default/star_small.png'));
  scene.load.image('speck', kenney('2D assets/Simple Space/PNG/Default/star_tiny.png'));
  scene.load.image('sparkle', kenney('2D assets/Particle Pack/PNG (Transparent)/star_06.png'));
  const boom = '2D assets/Explosion Pack/Spritesheets/spritesheet_regularExplosion';
  scene.load.atlasXML('boom', kenney(`${boom}.png`), kenney(`${boom}.xml`));

  preloadSfx(scene, SFX);
  for (const [name, file] of Object.entries(JINGLES)) scene.load.audio(`jingle:${name}`, kenney(file));
  for (const v of VOICES) scene.load.audio(`voice:${v}`, kenney(`${VOICE}/${v}.ogg`));
  scene.load.audio('music', kenney('Audio/Music Loops/Loops/Mission Plausible.ogg'));
}

/** Pixels across the planet textures the game draws. The pack's are 1280, far bigger than needed. */
const PLANET_PX = 320;

/**
 * Textures and animations built once at boot. The planets are shrunk in steps of half, which
 * keeps them smooth; drawn straight from 1280 pixels at a tenth of the size, they'd shimmer.
 */
export function createShared(scene: Phaser.Scene) {
  for (let i = 0; i < PLANET_SKINS; i++) {
    const key = `planet:${i}`;
    if (scene.textures.exists(key)) continue;
    let src = scene.textures.get(`planet:raw:${i}`).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    while (src.width > PLANET_PX) {
      const half = document.createElement('canvas');
      half.width = Math.max(PLANET_PX, Math.round(src.width / 2));
      half.height = half.width;
      const ctx = half.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, half.width, half.height);
      src = half;
    }
    scene.textures.addCanvas(key, src as HTMLCanvasElement);
    scene.textures.remove(`planet:raw:${i}`);
  }
  if (!scene.textures.exists('glow')) {
    // A soft round glow, for the pull around each planet and the station's beacon.
    const size = 256;
    const tex = scene.textures.createCanvas('glow', size, size)!;
    const g = tex.context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    tex.context.fillStyle = g;
    tex.context.fillRect(0, 0, size, size);
    tex.refresh();
  }
  if (!scene.textures.exists('dot')) {
    scene.make.graphics({}, false).fillStyle(0xffffff).fillCircle(8, 8, 8).generateTexture('dot', 16, 16).destroy();
  }
  if (!scene.anims.exists('boom')) {
    scene.anims.create({
      key: 'boom',
      frames: scene.anims.generateFrameNames('boom', { prefix: 'regularExplosion', start: 0, end: 8, zeroPad: 2, suffix: '.png' }),
      frameRate: 20,
    });
  }
}
