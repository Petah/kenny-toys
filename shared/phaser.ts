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
