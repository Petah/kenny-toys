/** Every Cube Pet, by its model name after `animal-`. */
export const PETS = [
  'beaver', 'bee', 'bunny', 'cat', 'caterpillar', 'chick', 'cow', 'crab', 'deer', 'dog', 'elephant', 'fish',
  'fox', 'giraffe', 'hog', 'koala', 'lion', 'monkey', 'panda', 'parrot', 'penguin', 'pig', 'polar', 'tiger',
] as const;
export type PetKind = (typeof PETS)[number];
