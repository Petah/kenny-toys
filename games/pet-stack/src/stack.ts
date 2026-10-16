import RAPIER from '@dimforge/rapier3d-compat';

/**
 * The tower: a grass pedestal and the pets dropped on it, in Rapier with no three.js, so the
 * stack checker can drop pets in Node.
 *
 * Each pet is a compound of convex hulls, one per part of its model (body and head, each leg, a
 * tail or trunk), so a bunny's ears and a crab's claws really are in the way. Pets only move in
 * the picture's plane and only turn about the axis facing the camera, so what you see is what
 * stands or falls.
 */

export const STEP = 1 / 120;
const GRAVITY = 14;
/** How far above the tower a pet hangs before it's let go. */
export const DROP_GAP = 0.7;
/**
 * Physics feel, in one place so the stack checker can try other values. Pets fall no faster than
 * `maxFall` until they land, so a drop sets them down rather than slams; `crown` is how far a
 * head's top slopes from its middle to its edges, as a share of its height.
 */
export const FEEL = { angularDamping: 5, linearDamping: 0.6, friction: 1.2, pedestalFriction: 1, crown: 0.04, maxFall: 4 };
/** The pedestal's top is at y = 0; its half width and its height. */
export const PEDESTAL_HALF = 1.66;
export const PEDESTAL_HEIGHT = 3.2;
/** A pet whose centre sinks this far below the pedestal's top has fallen off. */
const FALLEN_Y = -1.2;
/** Speeds under which a pet counts as still. */
const STILL_SPEED = 0.12;
const STILL_SPIN = 0.2;
const STILL_TIME = 0.3;

let ready: Promise<void> | undefined;
export const initPhysics = () => (ready ??= RAPIER.init());

/** A pet's shape: its convex parts, in model space. */
export interface PetShape {
  parts: Float32Array[];
}

export type PetState = 'falling' | 'landed' | 'fallen';

export interface Pet {
  kind: string;
  body: RAPIER.RigidBody;
  state: PetState;
  /** Seconds it has been still for. */
  still: number;
  /** Seconds since it was dropped. */
  age: number;
  /** Seconds since it fell. */
  fallenFor: number;
  /** Vertical speed last step, to hear it land. */
  vy: number;
  /** How hard it hit something this step (0 when it didn't). */
  thump: number;
}

/** The highest and lowest points of a shape turned by `angle` about the facing axis. */
export function extent(shape: PetShape, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const part of shape.parts) {
    for (let i = 0; i < part.length; i += 3) {
      const x = part[i] * c - part[i + 1] * s;
      const y = part[i] * s + part[i + 1] * c;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY };
}

export class Stack {
  world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  pets: Pet[] = [];
  shapes: Record<string, PetShape>;

  constructor(shapes: Record<string, PetShape>) {
    this.shapes = shapes;
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // The pedestal, and the meadow it stands in.
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(PEDESTAL_HALF, PEDESTAL_HEIGHT / 2, PEDESTAL_HALF).setTranslation(0, -PEDESTAL_HEIGHT / 2, 0).setFriction(FEEL.pedestalFriction),
      ground,
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -PEDESTAL_HEIGHT - 0.5, 0).setFriction(0.9), ground);
  }

  /** Lets a pet go at (x, y), turned by `angle`. */
  drop(kind: string, x: number, y: number, angle: number): Pet {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, 0)
        .setRotation({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) })
        // Locking a translation as well as rotations stops Rapier's friction working, so only
        // rotations are locked here and step() pins pets to the plane.
        .enabledRotations(false, false, true)
        .setLinvel(0, -1.5, 0)
        .setLinearDamping(FEEL.linearDamping)
        .setAngularDamping(FEEL.angularDamping)
        .setCcdEnabled(true),
    );
    for (const part of this.shapes[kind].parts) {
      const desc = RAPIER.ColliderDesc.convexHull(part);
      if (desc) this.world.createCollider(desc.setFriction(FEEL.friction).setRestitution(0.02).setDensity(1), body);
    }
    const pet: Pet = { kind, body, state: 'falling', still: 0, age: 0, fallenFor: 0, vy: -1.5, thump: 0 };
    this.pets.push(pet);
    return pet;
  }

  /** A copy to try things in (the checker's bot looks ahead with these). */
  clone(): Stack {
    const copy = Object.create(Stack.prototype) as Stack;
    copy.world = RAPIER.World.restoreSnapshot(this.world.takeSnapshot());
    copy.shapes = this.shapes;
    copy.pets = this.pets.map((p) => ({ ...p, body: copy.world.getRigidBody(p.body.handle) }));
    return copy;
  }

  /** How far a pet leans from its nearest quarter turn. */
  lean(pet: Pet) {
    const r = pet.body.rotation();
    const a = 2 * Math.atan2(r.z, r.w);
    const q = Math.PI / 2;
    return Math.abs(a - Math.round(a / q) * q);
  }

  remove(pet: Pet) {
    this.world.removeRigidBody(pet.body);
    this.pets.splice(this.pets.indexOf(pet), 1);
  }

  step() {
    this.world.timestep = STEP;
    this.world.step();
    for (const pet of this.pets) {
      pet.age += STEP;
      if (pet.state === 'falling' && pet.body.linvel().y < -FEEL.maxFall) {
        const lv = pet.body.linvel();
        pet.body.setLinvel({ x: lv.x, y: -FEEL.maxFall, z: 0 }, true);
      }
      const at = pet.body.translation();
      if (at.z !== 0) pet.body.setTranslation({ x: at.x, y: at.y, z: 0 }, false);
      if (pet.body.linvel().z !== 0) {
        const lv = pet.body.linvel();
        pet.body.setLinvel({ x: lv.x, y: lv.y, z: 0 }, false);
      }
      const v = pet.body.linvel();
      const w = pet.body.angvel();
      // A sudden stop in a fall is a landing (or being landed on).
      pet.thump = pet.vy < -1 && v.y - pet.vy > 1.2 ? v.y - pet.vy : 0;
      pet.vy = v.y;
      const still = Math.hypot(v.x, v.y) < STILL_SPEED && Math.abs(w.z) < STILL_SPIN;
      pet.still = still ? pet.still + STEP : 0;
      if (pet.state === 'fallen') {
        pet.fallenFor += STEP;
        continue;
      }
      if (pet.body.translation().y < FALLEN_Y) {
        pet.state = 'fallen';
        continue;
      }
      if (pet.state === 'falling' && (pet.thump > 0 || pet.still > 0.05)) pet.state = 'landed';
    }
  }

  /** True once every pet on the tower has stopped moving. */
  settled() {
    return this.pets.every((p) => p.state === 'fallen' || (p.state === 'landed' && p.still >= STILL_TIME));
  }

  /** The highest point of a pet as it lies now. */
  top(pet: Pet) {
    const t = pet.body.translation();
    const r = pet.body.rotation();
    const angle = 2 * Math.atan2(r.z, r.w);
    return t.y + extent(this.shapes[pet.kind], angle).maxY;
  }

  /** The tower's height: the highest landed pet's top, from the pedestal's top. */
  height() {
    let h = 0;
    for (const p of this.pets) if (p.state === 'landed') h = Math.max(h, this.top(p));
    return h;
  }
}

/**
 * A pet's shape from its model's parts. The body (the head-sized cube with its ears, horns or
 * crest) collides as its bounding box, so pets don't snag and rock on each other's ears, but with
 * a low ridged top, so a pet dropped square in the middle still leans one way or the other. Legs,
 * wings, beaks and trunks keep their own shapes. Tails stick up behind, out of sight from the
 * front, so they don't collide: nothing should balance on a spike you can't see.
 */
export function shapeOf(parts: { name: string; positions: Float32Array }[]): PetShape {
  return {
    parts: parts
      .filter((p) => p.name !== 'tail' && p.positions.length >= 12)
      .map((p) => (p.name === 'body' ? box(p.positions, FEEL.crown) : p.positions)),
  };
}

function box(points: Float32Array, crown = 0) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], points[i + k]);
      max[k] = Math.max(max[k], points[i + k]);
    }
  }
  const out: number[] = [];
  // The top's edges sit `crown` (a share of the height) below its middle, so it's a low roof.
  const drop = crown * (max[1] - min[1]);
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1] - drop]) for (const z of [min[2], max[2]]) out.push(x, y, z);
  if (drop) for (const z of [min[2], max[2]]) out.push((min[0] + max[0]) / 2, max[1], z);
  return new Float32Array(out);
}
