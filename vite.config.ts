import path from 'node:path';
import { defineConfig } from 'vite';
import { kenney } from './build/kenney-plugin.ts';
import { GAMES_DIR, readGameManifests } from './build/games.ts';

const KENNEY_ROOT = path.resolve(process.env.KENNEY_ROOT ?? path.join(import.meta.dirname, '../Kenney Game Assets All-in-1 3.7.0'));

export default defineConfig({
  resolve: {
    alias: { '@shared': path.resolve(import.meta.dirname, 'shared') },
  },
  plugins: [
    kenney({
      root: KENNEY_ROOT,
      sharedAssets: ['Other/Fonts/Kenney Future.ttf', 'Other/Fonts/Kenney Bold.ttf'],
    }),
  ],
  build: {
    // Phaser alone is ~1.3 MB; it gets its own chunk so the browser caches it once for every game.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'phaser', test: /node_modules[\\/]phaser/ }] },
      },
      // One page per game, plus the launcher at the root.
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        ...Object.fromEntries(readGameManifests().map((g) => [g.id, path.join(GAMES_DIR, g.id, 'index.html')])),
      },
    },
  },
});
