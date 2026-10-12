import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { readGameManifests } from './games.ts';

const MIME: Record<string, string> = {
  '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.json': 'application/json',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary',
};

/** URL prefix every Kenney asset is served under, in dev and in the built output. */
export const KENNEY_PREFIX = 'kenney';

interface KenneyPluginOptions {
  /** Absolute path to the "Kenney Game Assets All-in-1" folder. */
  root: string;
  /** Asset globs used by shared code (fonts, launcher art) rather than one game. */
  sharedAssets?: string[];
}

/**
 * Serves files from the Kenney asset bundle at /kenney/<path> during dev, and copies
 * only the files games declare (game.json "assets" globs) into the build output.
 * Dev requests for undeclared files still work but warn, since they'd 404 once built.
 */
export function kenney({ root, sharedAssets = [] }: KenneyPluginOptions): Plugin {
  if (!fs.existsSync(root)) {
    throw new Error(`Kenney asset root not found: ${root}\nSet KENNEY_ROOT to the "Kenney Game Assets" folder.`);
  }

  const declaredGlobs = () => [
    ...sharedAssets,
    ...readGameManifests().flatMap((g) => [...g.assets, ...(g.thumbnail ? [g.thumbnail] : [])]),
  ];

  const warned = new Set<string>();

  return {
    name: 'kenney-assets',

    configureServer(server) {
      server.middlewares.use(`/${KENNEY_PREFIX}/`, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const file = path.resolve(root, rel);
        if (!file.startsWith(root + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
          return next();
        }
        if (!declaredGlobs().some((g) => path.matchesGlob(rel, g)) && !warned.has(rel)) {
          warned.add(rel);
          server.config.logger.warn(`[kenney] "${rel}" is not declared in any game.json assets; it won't be in the build.`);
        }
        res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },

    generateBundle() {
      const files = new Set<string>();
      for (const pattern of declaredGlobs()) {
        const matches = fs.globSync(pattern, { cwd: root });
        if (matches.length === 0) this.error(`[kenney] asset glob matched nothing: "${pattern}"`);
        matches.forEach((m) => files.add(m));
      }
      for (const rel of files) {
        const abs = path.join(root, rel);
        if (!fs.statSync(abs).isFile()) continue;
        this.emitFile({ type: 'asset', fileName: `${KENNEY_PREFIX}/${rel}`, source: fs.readFileSync(abs) });
      }
    },
  };
}
