import { ATLAS, CATEGORIES, GOOGLY_SIZES, GOOGLY_THUMB, categorize, type Category } from './catalog';
import type { MonsterScene, Op } from './MonsterScene';

const THUMB = 64;

const KEYS: Record<string, Op> = {
  q: 'rotate-left',
  e: 'rotate-right',
  '-': 'smaller',
  '=': 'bigger',
  '+': 'bigger',
  f: 'flip',
  ']': 'front',
  '[': 'back',
  d: 'duplicate',
  Delete: 'delete',
  Backspace: 'delete',
};

/** Wires the DOM chrome (palette, toolbars, keyboard) to the scene. */
export function mountUI(scene: MonsterScene) {
  const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
  const tabs = $('#tabs');
  const items = $('#items');
  const selectionBar = $('#selection');
  const hint = $('#hint');
  const danceBtn = $('#dance');

  const byCategory = new Map<Category, string[]>(CATEGORIES.map((c) => [c.id, []]));
  for (const frame of scene.frameNames()) byCategory.get(categorize(frame)!)?.push(frame);
  byCategory.set('googly', Object.keys(GOOGLY_SIZES));

  function thumb(frame: string) {
    const el = document.createElement('span');
    el.className = 'thumb';
    if (frame.startsWith('googly:')) {
      const px = (GOOGLY_SIZES[frame as keyof typeof GOOGLY_SIZES] / 84) * THUMB;
      el.style.cssText = `width:${px}px;height:${px}px;background:url("${GOOGLY_THUMB}") center/contain no-repeat`;
      return el;
    }
    // CSS sprite straight from the atlas, so thumbnails need no extra files.
    const r = scene.frameRect(frame);
    const k = Math.min(THUMB / r.w, THUMB / r.h);
    el.style.cssText = [
      `width:${r.w * k}px`,
      `height:${r.h * k}px`,
      `background-image:url("${ATLAS.image}")`,
      `background-size:${r.sheetW * k}px ${r.sheetH * k}px`,
      `background-position:${-r.x * k}px ${-r.y * k}px`,
    ].join(';');
    return el;
  }

  function showCategory(id: Category) {
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.category === id)));
    items.replaceChildren(
      ...byCategory.get(id)!.map((frame) => {
        const button = document.createElement('button');
        button.className = 'item';
        button.title = frame.replace('.png', '').replaceAll('_', ' ');
        button.append(thumb(frame));
        button.addEventListener('click', () => scene.pick(frame));
        return button;
      }),
    );
    items.scrollLeft = 0;
  }

  for (const { id, label } of CATEGORIES) {
    const button = document.createElement('button');
    button.role = 'tab';
    button.dataset.category = id;
    button.textContent = label;
    button.addEventListener('click', () => showCategory(id));
    tabs.append(button);
  }
  showCategory('body');

  $('#random').addEventListener('click', () => scene.randomize());
  $('#clear').addEventListener('click', () => scene.clear());
  $('#save').addEventListener('click', () => scene.save());
  danceBtn.addEventListener('click', () => scene.toggleDance());
  selectionBar.addEventListener('click', (e) => {
    const op = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.op as Op | undefined;
    if (op) scene.op(op);
  });

  scene.events.on('selection', (sel: { category: Category } | null) => {
    selectionBar.hidden = !sel;
    // Jump the palette to the selected part's kind, so clicking an item swaps it.
    if (sel && sel.category !== 'body') showCategory(sel.category);
  });
  scene.events.on('parts', (count: number) => hint.classList.toggle('hidden', count > 0));
  scene.events.on('dance', (on: boolean) => danceBtn.setAttribute('aria-pressed', String(on)));

  // Mouse clicks shouldn't leave buttons focused, or Space would press them instead of dancing.
  document.addEventListener('click', (e) => {
    if (e.detail > 0) (e.target as HTMLElement).closest('button')?.blur();
  });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      scene.toggleDance();
    } else if (e.key === 'r') {
      scene.randomize();
    } else if (KEYS[e.key]) {
      e.preventDefault();
      scene.op(KEYS[e.key]);
    }
  });
}
