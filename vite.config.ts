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
      sharedAssets: ['Other/Fonts/Kenney Future.ttf', 'Other/Fonts/Kenney Bold.ttf', 'Icons/Game Icons/Spritesheet/sheet_white2x.{png,xml}'],
    }),
  ],
  server: {
    // The party relay (npm run party) for TV + phone games.
    proxy: { '/party': { target: 'http://127.0.0.1:8083', ws: true } },
  },
  build: {
    // Each engine gets its own chunk so the browser caches it once for every game that uses it.
    // Phaser is ~1.3 MB; Rapier's compat build inlines its WebAssembly and is ~2.9 MB (1.1 MB gzipped).
    chunkSizeWarningLimit: 3000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'phaser', test: /node_modules[\\/]phaser/ },
            { name: 'three', test: /node_modules[\\/]three/ },
            { name: 'rapier', test: /node_modules[\\/]@dimforge/ },
          ],
        },
      },
      // One page per game, plus the launcher at the root and the phones' join page.
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        join: path.resolve(import.meta.dirname, 'join/index.html'),
        ...Object.fromEntries(readGameManifests().map((g) => [g.id, path.join(GAMES_DIR, g.id, 'index.html')])),
      },
    },
  },
});
