import * as Phaser from 'phaser';
import { kenney } from './kenney';

const SHEET = 'Icons/Game Icons/Spritesheet/sheet_white2x';

/** The texture key for Kenney's white Game Icons (frames like 'return.png', 'menuList.png', 'locked.png'). */
export const ICONS = 'icons';

/**
 * Loads the icon atlas. Button symbols come from here rather than text: the Kenney fonts
 * have no ↻ or ☰, and the fallback font draws them off-centre.
 */
export function preloadIcons(scene: Phaser.Scene) {
  scene.load.atlasXML(ICONS, kenney(`${SHEET}.png`), kenney(`${SHEET}.xml`));
}
