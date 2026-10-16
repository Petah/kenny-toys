/** What the trains carry: each cargo has its own colour and shed. */
export interface Cargo {
  name: string;
  /** The carriage model it rides in. */
  wagon: string;
  colour: number;
  css: string;
}

export const CARGO: Cargo[] = [
  { name: 'red', wagon: 'train-carriage-container-red', colour: 0xe0473c, css: '#e0473c' },
  { name: 'blue', wagon: 'train-carriage-container-blue', colour: 0x3f86e0, css: '#3f86e0' },
  { name: 'green', wagon: 'train-carriage-container-green', colour: 0x4cb04a, css: '#4cb04a' },
  { name: 'yellow', wagon: 'train-carriage-tank', colour: 0xf2c230, css: '#f2c230' },
  { name: 'wood', wagon: 'train-carriage-lumber', colour: 0xa8683a, css: '#a8683a' },
  { name: 'coal', wagon: 'train-carriage-coal', colour: 0x4a4a58, css: '#4a4a58' },
];

/** Engines at the front, picked at random. */
export const ENGINES = ['train-diesel-a', 'train-diesel-b', 'train-diesel-c', 'train-locomotive-a', 'train-locomotive-b', 'train-locomotive-c'];

/** Lengths along the track, from the models' bounding boxes. */
export const ENGINE_LENGTH = 2.8;
export const WAGON_LENGTH = 2.7;
export const COUPLING = 0.2;
export const MAX_WAGONS = 3;
export const trainLength = (wagons: number) => ENGINE_LENGTH + wagons * (WAGON_LENGTH + COUPLING);
export const LONGEST_TRAIN = trainLength(MAX_WAGONS);
