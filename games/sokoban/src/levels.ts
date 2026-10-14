export type Theme = 'brick' | 'stone' | 'wood';

export interface Level {
  name: string;
  theme: Theme;
  /** Fewest moves that solve it, from scripts/check-levels.ts. Matching it earns three coins. */
  par: number;
  rows: string[];
}

// The first two are hand-made tutorials. The rest came out of scripts/generate.ts and were
// picked for a steady climb: plain crates, then colours, then more of both.
export const LEVELS: Level[] = [
  {
    name: 'First Push',
    theme: 'brick',
    par: 3,
    rows: [
      '#######',
      '#     #',
      '#@ $ .#',
      '#     #',
      '#######',
    ],
  },
  {
    name: 'Round the Back',
    theme: 'brick',
    par: 17,
    rows: [
      ' ######',
      ' #    #',
      '##$## #',
      '#. @  #',
      '#######',
    ],
  },
  {
    name: 'Side by Side',
    theme: 'stone',
    par: 19,
    rows: [
      '######',
      '#  #@##',
      '# $#$.#',
      '#   . #',
      '# #   #',
      '####  #',
      '   ####',
    ],
  },
  {
    name: 'Three Tidy',
    theme: 'stone',
    par: 10,
    rows: [
      '########',
      '# ##   #',
      '#  #. ##',
      '#  . $@#',
      '#   $ ##',
      '# . $ #',
      '#######',
    ],
  },
  {
    name: 'The Long Way',
    theme: 'wood',
    par: 21,
    rows: [
      '########',
      '#.  ##.#',
      '##  # $#',
      '## .   #',
      '#  ##$ #',
      '# $    #',
      '# @    #',
      '########',
    ],
  },
  {
    name: 'Red and Green',
    theme: 'brick',
    par: 18,
    rows: [
      '   #####',
      '  ##   #',
      '###@r  #',
      '#  g ###',
      '#   G  #',
      '#      #',
      '#   R  #',
      '########',
    ],
  },
  {
    name: 'Bottleneck',
    theme: 'stone',
    par: 19,
    rows: [
      '########',
      '#     .#',
      '# $ @$##',
      '# $ #  #',
      '#  ## ##',
      '# .  . #',
      '########',
    ],
  },
  {
    name: 'Swap Shop',
    theme: 'wood',
    par: 17,
    rows: [
      '########',
      '# #  # #',
      '#    g@#',
      '# G  r #',
      '# R   ##',
      '# ###  #',
      '##     #',
      ' #######',
    ],
  },
  {
    name: 'Stockroom',
    theme: 'brick',
    par: 25,
    rows: [
      '#########',
      '#  #    #',
      '#       #',
      '#   .#$.#',
      '#.#  #. #',
      '#$ $$# ##',
      '#   @###',
      '######',
    ],
  },
  {
    name: 'Primary Colours',
    theme: 'stone',
    par: 20,
    rows: [
      ' ######',
      ' #    ###',
      ' #B   # #',
      ' ##     #',
      '##    b@#',
      '#   r g #',
      '# R  G  #',
      '#########',
    ],
  },
  {
    name: 'Colour Clash',
    theme: 'brick',
    par: 24,
    rows: [
      '#########',
      '#R      #',
      '##  B ###',
      '## b  ###',
      '# g r G #',
      '# # @#  #',
      '#    ####',
      '######',
    ],
  },
  {
    name: 'Grand Finale',
    theme: 'wood',
    par: 19,
    rows: [
      ' ########',
      '##.     #',
      '#       #',
      '### $ $.#',
      '# @$    #',
      '#  $ .# #',
      '##  . # #',
      ' ########',
    ],
  },
];
