import '@shared/theme.css';
import './launcher.css';
import { loadKenneyFonts } from '@shared/fonts';
import { kenney } from '@shared/kenney';
import type { GameManifest } from '@shared/manifest';

const manifests = import.meta.glob<GameManifest>('../games/*/game.json', { eager: true, import: 'default' });

const list = document.querySelector<HTMLUListElement>('#games')!;

for (const [file, game] of Object.entries(manifests)) {
  const id = file.split('/').at(-2)!;
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = `${import.meta.env.BASE_URL}games/${id}/`;
  a.className = 'card';
  if (game.thumbnail) {
    const img = document.createElement('img');
    img.src = kenney(game.thumbnail);
    img.alt = '';
    a.append(img);
  }
  const h2 = document.createElement('h2');
  h2.textContent = game.title;
  const p = document.createElement('p');
  p.textContent = game.description;
  a.append(h2, p);
  li.append(a);
  list.append(li);
}

loadKenneyFonts();
