import * as Phaser from 'phaser';

/** Glaze frames and the colour their splat should be. Colours are sampled from the art. */
const GLAZES: [frame: string, color: number][] = [
  ['glazing_1.png', 0xff9ccf],
  ['glazing_2.png', 0xf4f4f4],
  ['glazing_3.png', 0x5c4632],
  ['glazing_4.png', 0xdcb07c],
  ['glazing_5.png', 0x66cc99],
  ['glazing_6.png', 0xffcc00],
  ['glazing_zigzag_1.png', 0xff9ccf],
  ['glazing_zigzag_2.png', 0xf4f4f4],
  ['glazing_zigzag_3.png', 0x5c4632],
  ['glazing_zigzag_4.png', 0xdcb07c],
];
const BASES = ['donut_1.png', 'donut_2.png', 'donut_3.png'];
const TOPPINGS = ['sprinkles_1.png', 'sprinkles_2.png', 'sprinkles_3.png', 'sprinkles_4.png', 'sprinkles_5.png', 'stripes_1.png', 'stripes_2.png', 'stripes_3.png', 'stripes_4.png'];
const DOUGH_COLOR = 0xe2bd8a;

export const DONUT_SIZE = 264;

export interface DonutType {
  key: string;
  color: number;
}

const pick = <T,>(xs: readonly T[]) => xs[Phaser.Math.Between(0, xs.length - 1)];

/**
 * Bakes random base + glaze + topping combinations into single textures, so a donut
 * is one image that can be cropped into halves when sliced.
 */
export function bakeDonuts(scene: Phaser.Scene, count: number): DonutType[] {
  const c = DONUT_SIZE / 2;
  return Array.from({ length: count }, (_, i) => {
    const key = `donut-${i}`;
    const texture = scene.textures.addDynamicTexture(key, DONUT_SIZE, DONUT_SIZE)!;
    texture.stamp('donuts', pick(BASES), c, c);

    // A few plain ones keep the box looking like a real bakery's.
    let color = DOUGH_COLOR;
    if (Math.random() < 0.9) {
      const [glaze, glazeColor] = pick(GLAZES);
      color = glazeColor;
      texture.stamp('donuts', glaze, c, c, { rotation: Math.random() * Math.PI * 2 });
      if (Math.random() < 0.75) texture.stamp('donuts', pick(TOPPINGS), c, c, { rotation: Math.random() * Math.PI * 2 });
    }
    texture.render();
    return { key, color };
  });
}
