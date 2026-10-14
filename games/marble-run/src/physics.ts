import RAPIER from '@dimforge/rapier3d-compat';
import type { Triangles } from '../../../shared/glb.ts';
import type { Shape, Placed } from './track.ts';
import { turn } from './track.ts';

/**
 * The run as one static triangle mesh, the ground, and the marbles rolling on them. Rapier,
 * no three.js, so scripts can roll marbles down a run under Node.
 */

export const MARBLE_RADIUS = 0.11;
export const STEP = 1 / 240;
/** Gravity is a little strong: at this toy's size, real gravity makes marbles look sluggish. */
const GRAVITY = 14;
const SAFE_SPEED = 4.5;
const DRAG = 1.0;

let ready: Promise<void> | undefined;
export const initPhysics = () => (ready ??= RAPIER.init());

export interface MarbleEvent {
  kind: 'clack';
  speed: number;
}

/**
 * Each piece is a closed solid, so where two pieces meet their end caps sit face to face over
 * the groove's seam. Rapier can only smooth an edge with two triangles on it, so the caps (any
 * triangle lying flat in the plane of one of the piece's ports) are left out.
 */
function isEndCap(tri: Triangles, shape: Shape, a: number, b: number, c: number) {
  const p = tri.positions;
  for (const port of shape.ports) {
    const axis = port.dx !== 0 ? 0 : 2;
    const plane = axis === 0 ? port.x : port.z;
    if ([a, b, c].every((i) => Math.abs(p[i * 3 + axis] - plane) < 1e-3)) return true;
  }
  return false;
}

export class RunPhysics {
  readonly world: RAPIER.World;
  private track?: RAPIER.Collider;
  private marbles = new Map<number, RAPIER.RigidBody>();
  private nextId = 1;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = STEP;
    // A big floor for marbles that leave the track.
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0).setFriction(0.8).setRestitution(0.3));
  }

  /** Replaces the track with these pieces. */
  setTrack(pieces: Placed[], triangles: (model: string) => Triangles, shapes: (model: string) => Shape) {
    if (this.track) this.world.removeCollider(this.track, false);
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
    for (const piece of pieces) {
      const tri = triangles(piece.model);
      const shape = shapes(piece.model);
      const local: number[] = [];
      for (let i = 0; i < tri.positions.length; i += 3) {
        const w = turn(tri.positions[i], tri.positions[i + 2], piece.angle);
        local.push(vertex(piece.x + w.x, piece.y + tri.positions[i + 1], piece.z + w.z));
      }
      for (let i = 0; i < tri.indices.length; i += 3) {
        if (isEndCap(tri, shape, tri.indices[i], tri.indices[i + 1], tri.indices[i + 2])) continue;
        const [a, b, c] = [local[tri.indices[i]], local[tri.indices[i + 1]], local[tri.indices[i + 2]]];
        if (a !== b && b !== c && a !== c) indices.push(a, b, c);
      }
    }
    if (!indices.length) {
      this.track = undefined;
      return;
    }
    const flags = RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES;
    this.track = this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices), flags).setFriction(0.25).setRestitution(0.35),
    );
  }

  /** Adds a marble moving at (vx, vz); returns its id. */
  addMarble(x: number, y: number, z: number, vx: number, vz: number) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinvel(vx, 0, vz).setCcdEnabled(true).setLinearDamping(0.02).setAngularDamping(0.03),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(MARBLE_RADIUS).setDensity(2500).setFriction(0.25).setRestitution(0.4).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
      body,
    );
    const id = this.nextId++;
    this.marbles.set(id, body);
    return id;
  }

  removeMarble(id: number) {
    const body = this.marbles.get(id);
    if (body) this.world.removeRigidBody(body);
    this.marbles.delete(id);
  }

  marble(id: number) {
    return this.marbles.get(id);
  }

  get marbleIds() {
    return [...this.marbles.keys()];
  }

  step(): MarbleEvent[] {
    const events: MarbleEvent[] = [];
    // Air drag that only bites above a comfortable speed, growing with the excess. Without it,
    // drop after drop builds speeds that throw marbles out of spirals.
    for (const body of this.marbles.values()) {
      const v = body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed <= SAFE_SPEED) continue;
      const keep = Math.max(0.5, 1 - DRAG * (speed - SAFE_SPEED) * STEP);
      body.setLinvel({ x: v.x * keep, y: v.y * keep, z: v.z * keep }, true);
    }
    const queue = new RAPIER.EventQueue(true);
    this.world.step(queue);
    queue.drainContactForceEvents((e) => {
      const speed = e.maxForceMagnitude() / 150;
      if (speed > 0.6) events.push({ kind: 'clack', speed });
    });
    queue.free();
    return events;
  }

  free() {
    this.world.free();
  }
}
