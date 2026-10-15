/**
 * Writes src/words.txt, the dictionary the game checks words against: SCOWL's English, British
 * and American lists up to size 70 (common words plus plenty of less common ones, with plurals
 * and verb forms), 3 to 9 letters, lowercase a-z only. SCOWL's licence asks for its notice to
 * travel with copies, so the whole of it heads the file as # comments.
 *
 *   node games/word-drop/scripts/make-words.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve('wordlist-english/package.json'));
const SIZES = [10, 20, 35, 40, 50, 55, 60, 70];
const words = new Set<string>();
for (const region of ['english', 'british', 'american']) {
  for (const size of SIZES) {
    const list = JSON.parse(readFileSync(join(pkg, `${region}-words-${size}.json`), 'utf8')) as string[];
    for (const w of list) if (/^[a-z]{3,9}$/.test(w)) words.add(w);
  }
}
const notice = readFileSync(join(pkg, 'Copyright'), 'utf8').trimEnd().split('\n').map((l) => `# ${l}`.trimEnd());
const out = [
  '# Word list from SCOWL (http://wordlist.aspell.net/) via the wordlist-english package.',
  ...notice,
  ...[...words].sort(),
].join('\n');
writeFileSync(new URL('../src/words.txt', import.meta.url), out + '\n');
console.log(`${words.size} words`);
