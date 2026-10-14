import * as Phaser from 'phaser';
import { kenney } from './kenney';

/** A Phaser game that fills its parent element and resizes with it. */
export function createGame(parent: HTMLElement, scenes: Phaser.Types.Scenes.SceneType[], extra: Phaser.Types.Core.GameConfig = {}) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    transparent: true,
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
    scene: scenes,
    ...extra,
  });
}

/** Named groups of interchangeable sound files; playing a group picks one at random. */
export type SfxGroups = Record<string, string[]>;

export function preloadSfx(scene: Phaser.Scene, groups: SfxGroups) {
  for (const [name, files] of Object.entries(groups)) {
    files.forEach((file, i) => scene.load.audio(`sfx:${name}:${i}`, kenney(file)));
  }
}

/** Plays a random variant from a preloaded group with slight pitch variation so repeats don't grate. */
export function playSfx(scene: Phaser.Scene, groups: SfxGroups, name: string, config: Phaser.Types.Sound.SoundConfig = {}) {
  const variants = groups[name];
  if (!variants?.length) return;
  const key = `sfx:${name}:${Phaser.Math.Between(0, variants.length - 1)}`;
  scene.sound.play(key, { detune: Phaser.Math.Between(-150, 150), volume: 0.6, ...config });
}

/**
 * Matter steps at a fixed rate whatever the display does. At its default 60 steps a second, a
 * 120Hz screen (MacBook Pro, newer phones) draws every position twice, so anything moving
 * judders. 120 steps is one per frame there and two on a 60Hz screen, which these small
 * scenes can easily afford. Velocities from getVelocity/setVelocity keep the same units;
 * a body's raw .velocity and .speed are per step, so read them through getVelocity/getSpeed.
 */
export const MATTER_RUNNER = { fps: 120 };

/** A game with a fixed design resolution, letterboxed to fit its parent. For arcade-style layouts. */
export function createFixedGame(parent: HTMLElement, scenes: Phaser.Types.Scenes.SceneType[], width: number, height: number, extra: Phaser.Types.Core.GameConfig = {}) {
  return createGame(parent, scenes, {
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width, height },
    ...extra,
  });
}
