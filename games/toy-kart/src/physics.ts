import RAPIER from '@dimforge/rapier3d-compat';
import type { Triangles } from '../../../shared/glb.ts';
import { DECK, PIECES, type Built, type Placed } from './track.ts';

/**
 * The track as one static triangle mesh, the floor under it, and the cars. Rapier, no three.js,
 * so scripts can drive cars round circuits in Node.
 *
 * Cars are arcade cars on a real rigid body: four rays hold the body up on springs, and each step
 * sets its velocity along and across its heading (drive, drag, grip) and its spin (steering and
 * staying level with the deck under it). Collisions with walls and other cars stay physical.
 */

export const STEP = 1 / 120;
const GRAVITY = 16;
/** The floor's top surface, a little under the lowest deck. */
export const FLOOR_Y = -0.1;

/** Half sizes of a car's body, which floats RIDE above the deck. */
const HALF = { x: 0.24, y: 0.1, z: 0.4 };
const RIDE = 0.12;
const SPRING = 900;
const DAMPER = 45;

export const TOP_SPEED = 9;
const ACCEL = 14;
const BRAKE = 22;
const REVERSE_SPEED = 3;
const ROLL_DRAG = 0.15;
/** How fast sideways sliding dies away, per second. Lower drifts more. */
const GRIP = 9;
/** Top turning rate in radians per second, reached from TURN_FULL speed up. */
const TURN = 2.6;
const TURN_FULL = 3;

let ready: Promise<void> | undefined;
export const initPhysics = () => (ready ??= RAPIER.init());

export interface Controls {
  /** -1 (brake or reverse) to 1. */
  throttle: number;
  /** -1 (left) to 1 (right). */
  steer: number;
}

export interface Car {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controls: Controls;
  /** Touching the track (not the floor, not in the air). */
  grounded: boolean;
  onFloor: boolean;
  /** Seconds since last on the track. */
  airTime: number;
  /** Speed along the heading. */
  speed: number;
  /** Multiplies the top speed and acceleration: boosts, coins. */
  power: number;
  /** While above 0 the car spins out and won't steer or drive. */
  spin: number;
  /** Sideways slide, for skid sounds and smoke. */
  slide: number;
}

/**
 * Pieces are closed solids, so where two meet their end faces sit back to back across the deck's
 * seam. Rapier only smooths an edge with exactly two triangles on it, so cars would clip every
 * seam; the end faces (any triangle lying in the plane of either end) are left out.
 */
function isEndFace(tri: Triangles, p: Placed, a: number, b: number, c: number) {
  const exit = PIECES[p.piece].exit;
  const pos = tri.positions;
  const planes = [
    { x: 0, z: 0, hx: 0, hz: 1 },
    { x: exit.x, z: exit.z, hx: Math.sin(exit.yaw), hz: Math.cos(exit.yaw) },
  ];
  return planes.some((pl) => [a, b, c].every((i) => Math.abs((pos[i * 3] - pl.x) * pl.hx + (pos[i * 3 + 2] - pl.z) * pl.hz) < 1e-3));
}

export class RacePhysics {
  readonly world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  readonly cars: Car[] = [];
  private floor: RAPIER.Collider;

  constructor(built: Built, triangles: (model: string) => Triangles) {
    this.world.timestep = STEP;
    this.floor = this.world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, FLOOR_Y - 0.5, 0).setFriction(0.4));

    // Every piece's triangles placed into one welded mesh, so cars cross the seams smoothly.
    const positions: number[] = [];
    const indices: number[] = [];
    const weld = new Map<string, number>();
    const vertex = (x: number, y: number, z: number) => {
      const q = (n: number) => Math.round(n * 1e4);
      const key = `${q(x)},${q(y)},${q(z)}`;
      let i = weld.get(key);
      if (i === undefined) {
        i = positions.length / 3;
        weld.set(key, i);
        positions.push(q(x) / 1e4, q(y) / 1e4, q(z) / 1e4);
      }
      return i;
    };
    for (const p of built.pieces) {
      const tri = triangles(p.model);
      const m = p.mirror ? -1 : 1;
      const c = Math.cos(p.at.yaw);
      const s = Math.sin(p.at.yaw);
      const local: number[] = [];
      for (let i = 0; i < tri.positions.length; i += 3) {
        const lx = tri.positions[i] * m;
        const lz = tri.positions[i + 2];
        local.push(vertex(p.at.x + lx * c + lz * s, p.at.y + DECK + tri.positions[i + 1], p.at.z - lx * s + lz * c));
      }
      for (let i = 0; i < tri.indices.length; i += 3) {
        const [ia, ib, ic] = [tri.indices[i], tri.indices[i + 1], tri.indices[i + 2]];
        if (isEndFace(tri, { ...p, mirror: false }, ia, ib, ic)) continue;
        const [a, b, cc] = [local[ia], local[ib], local[ic]];
        if (a === b || b === cc || a === cc) continue;
        // Mirroring turns triangles inside out; swap two corners to keep them facing out.
        if (p.mirror) indices.push(a, cc, b);
        else indices.push(a, b, cc);
      }
    }
    const flags = RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES;
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices), flags).setFriction(0).setRestitution(0.1));
  }

  addCar(x: number, y: number, z: number, yaw: number): Car {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y + RIDE + HALF.y + 0.02, z)
        .setRotation(yawQuat(yaw))
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(2),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(HALF.x - 0.04, HALF.y - 0.04, HALF.z - 0.04, 0.04).setDensity(60).setFriction(0).setRestitution(0.25),
      body,
    );
    const car: Car = { body, collider, controls: { throttle: 0, steer: 0 }, grounded: false, onFloor: false, airTime: 0, speed: 0, power: 1, spin: 0, slide: 0 };
    this.cars.push(car);
    return car;
  }

  /** Puts a car down at rest somewhere, facing `yaw`. */
  reset(car: Car, x: number, y: number, z: number, yaw: number) {
    car.body.setTranslation({ x, y: y + RIDE + HALF.y + 0.05, z }, true);
    car.body.setRotation(yawQuat(yaw), true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    car.spin = 0;
    car.airTime = 0;
  }

  step() {
    for (const car of this.cars) this.drive(car);
    this.world.step();
  }

  private drive(car: Car) {
    const dt = STEP;
    const body = car.body;
    const q = body.rotation();
    const up = rotate(q, 0, 1, 0);
    const fwd = rotate(q, 0, 0, 1);
    const right = rotate(q, -1, 0, 0);
    const p = body.translation();
    const v = body.linvel();
    const mass = body.mass();

    // Suspension: a ray down from each corner. Each one compressed pushes the body up its own spot.
    let hits = 0;
    let normal = { x: 0, y: 0, z: 0 };
    let floorHits = 0;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const o = {
        x: p.x + right.x * sx * HALF.x * 0.8 + fwd.x * sz * HALF.z * 0.8,
        y: p.y + right.y * sx * HALF.x * 0.8 + fwd.y * sz * HALF.z * 0.8,
        z: p.z + right.z * sx * HALF.x * 0.8 + fwd.z * sz * HALF.z * 0.8,
      };
      const reach = HALF.y + RIDE * 1.8;
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(o, { x: -up.x, y: -up.y, z: -up.z }), reach, true, undefined, undefined, car.collider);
      if (!hit) continue;
      hits++;
      if (hit.collider === this.floor) floorHits++;
      normal = { x: normal.x + hit.normal.x, y: normal.y + hit.normal.y, z: normal.z + hit.normal.z };
      const compress = HALF.y + RIDE - hit.timeOfImpact;
      const pv = body.velocityAtPoint(o);
      const along = pv.x * up.x + pv.y * up.y + pv.z * up.z;
      const f = Math.max(0, compress * SPRING - along * DAMPER) * (mass / 4) * dt;
      body.applyImpulseAtPoint({ x: up.x * f, y: up.y * f, z: up.z * f }, o, true);
    }
    car.grounded = hits > 0 && floorHits < hits;
    car.onFloor = floorHits > 0;
    car.airTime = car.grounded ? 0 : car.airTime + dt;
    car.spin = Math.max(0, car.spin - dt);

    const vf = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
    const vr = v.x * right.x + v.y * right.y + v.z * right.z;
    car.speed = vf;
    car.slide = vr;
    let yawRate = 0;
    if (hits > 0) {
      const { throttle, steer } = car.spin > 0 ? { throttle: 0, steer: 0 } : car.controls;
      const top = TOP_SPEED * car.power;
      let dvf = 0;
      if (throttle > 0) dvf = vf < 0 ? BRAKE * dt : throttle * ACCEL * car.power * Math.max(0, 1 - vf / top) * dt;
      else if (throttle < 0) dvf = vf > 0.2 ? -BRAKE * dt : vf > -REVERSE_SPEED ? throttle * ACCEL * 0.6 * dt : 0;
      // Rolling drag, and anything over the top speed (after a boost wears off) eases back down.
      dvf -= vf * ROLL_DRAG * dt + Math.max(0, vf - top) * 2 * dt;
      // Grip kills sideways slide; a spinning car slides more.
      const dvr = -vr * (1 - Math.exp(-(car.spin > 0 ? 2 : GRIP) * dt));
      body.applyImpulse(
        { x: (fwd.x * dvf + right.x * dvr) * mass, y: (fwd.y * dvf + right.y * dvr) * mass, z: (fwd.z * dvf + right.z * dvr) * mass },
        true,
      );
      // Steering turns harder the faster you go up to TURN_FULL, and reverses when backing up.
      // A positive yaw turns towards +x, which is left of a car facing +z.
      const grip = Math.min(1, Math.abs(vf) / TURN_FULL);
      yawRate = -steer * TURN * grip * Math.sign(vf || 1);
    }
    if (car.spin > 0) yawRate = 9 * Math.min(1, car.spin * 2);

    // Spin: yaw from steering about the car's up, plus a correction tipping up towards the deck's
    // normal (or the sky in the air), so cars stay upright and follow hills and bumps.
    const n = hits > 0 ? norm(normal) : { x: 0, y: 1, z: 0 };
    const tip = cross(up, n);
    const level = hits > 0 ? 14 : 3;
    const w = body.angvel();
    const yawNow = w.x * up.x + w.y * up.y + w.z * up.z;
    const yawWant = hits > 0 || car.spin > 0 ? yawRate : yawNow * 0.98 - car.controls.steer * 0.04;
    body.setAngvel(
      { x: tip.x * level + up.x * yawWant, y: tip.y * level + up.y * yawWant, z: tip.z * level + up.z * yawWant },
      true,
    );
  }

  free() {
    this.world.free();
  }
}

export function yawQuat(yaw: number) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** Heading of a car's body (0 = +z). */
export function yawOf(body: RAPIER.RigidBody) {
  const f = rotate(body.rotation(), 0, 0, 1);
  return Math.atan2(f.x, f.z);
}

export function rotate(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number) {
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function norm(a: { x: number; y: number; z: number }) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
