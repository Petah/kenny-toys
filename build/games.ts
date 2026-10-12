import fs from 'node:fs';
import path from 'node:path';
import type { GameManifest } from '../shared/manifest.ts';

export const GAMES_DIR = path.resolve(import.meta.dirname, '../games');

/** Every games/<id>/game.json, read fresh so dev picks up edits without a restart. */
export function readGameManifests(): (GameManifest & { id: string })[] {
  return fs
    .readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(GAMES_DIR, d.name, 'game.json')))
    .map((d) => ({ id: d.name, ...JSON.parse(fs.readFileSync(path.join(GAMES_DIR, d.name, 'game.json'), 'utf8')) }));
}
