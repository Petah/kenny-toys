import { kenney } from './kenney';

export const FONT_HEADING = 'Kenney Bold';
export const FONT_BODY = 'Kenney Future';

let loading: Promise<void> | undefined;

/** Registers the Kenney fonts with the document. Await before drawing text to a canvas. */
export function loadKenneyFonts(): Promise<void> {
  loading ??= Promise.all(
    [FONT_HEADING, FONT_BODY].map(async (family) => {
      const face = new FontFace(family, `url("${kenney(`Other/Fonts/${family}.ttf`)}")`);
      document.fonts.add(await face.load());
    }),
  ).then(() => undefined);
  return loading;
}

/** Registers one more font from `Other/Fonts` (declare the file in game.json's assets). */
export async function loadKenneyFont(family: string): Promise<void> {
  const face = new FontFace(family, `url("${kenney(`Other/Fonts/${family}.ttf`)}")`);
  document.fonts.add(await face.load());
}
