import RAPIER from '@dimforge/rapier3d-compat';
import { FLOOR, type Course, type Placement } from './course.ts';
import type { Triangles } from './glb.ts';

/**
 * The course as one static triangle mesh, and the ball. Rapier, no three.js, so the hole
 * checker runs the very same physics in Node.
 */

export const BALL_RADIUS = 0.03;
/** Fastest putt, metres per second. Enough to cross about eight flat tiles. */
export const MAX_POWER = 3.8;
export const STEP = 1 / 240;

/** Rolling resistance on the green, m/s². Rapier has none, so it's applied by hand while the ball touches down. */
const ROLL_DECEL = 0.3;
const STOP_SPEED = 0.025;
/** The cup's radius; a ball whose centre is inside it and low enough is in. */
const CUP_RADIUS = 0.06;
/** The pond's surface sits this far under the lowest tile; a ball below it has splashed in. */
export const OUT_DEPTH = 0.08;

let ready: Promise<void> | undefined;
export const initPhysics = () => (ready ??= RAPIER.init());

/** Where a tile-local point ends up in the world. */
export function tilePoint(t: Placement, lx: number, ly: number, lz: number) {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  return { x: t.x + lx * c + lz * s, y: t.y + ly, z: t.z - lx * s + lz * c };
}

/**
 * Tiles are closed solids, so each has faces standing on its edges under the floor. Where two
 * tiles meet, those faces share the floor's seam, and Rapier can only smooth an edge with
 * exactly two triangles on it, so the ball clipped every seam and hopped. Those faces are
 * always buried or underneath the course, so they're left out.
 */
function isBuriedSide(tri: Triangles, a: number, b: number, c: number) {
  const p = tri.positions;
  const onEdge = (axis: 0 | 2) =>
    [a, b, c].every((i) => Math.abs(Math.abs(p[i * 3 + axis]) - 0.5) < 1e-4) && Math.sign(p[a * 3 + axis]) === Math.sign(p[b * 3 + axis]) && Math.sign(p[b * 3 + axis]) === Math.sign(p[c * 3 + axis]);
  const low = [a, b, c].every((i) => p[i * 3 + 1] <= FLOOR + 1e-3);
  return low && (onEdge(0) || onEdge(2));
}

export type BallEvent = { kind: 'wall'; speed: number } | { kind: 'sunk' } | { kind: 'out' } | { kind: 'stopped' };

export class CoursePhysics {
  readonly world: RAPIER.World;
  readonly ball: RAPIER.RigidBody;
  readonly cup: { x: number; y: number; z: number };
  readonly tee: { x: number; y: number; z: number };
  private ballCollider: RAPIER.Collider;
  private lowest: number;
  private stillFor = 0;
  moving = false;

  constructor(course: Course, meshes: (model: string, skip?: string[]) => Triangles) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;

    // Every tile's triangles, placed and merged into one mesh, so the ball rolls across the
    // seams between tiles. FIX_INTERNAL_EDGES stops it catching on those seams.
    // Vertices are welded on a 0.1mm grid: turning a tile leaves tiny float errors, and
    // neighbouring tiles only share an edge (which is what lets Rapier smooth it) if their
    // corners land on exactly the same point.
    const positions: number[] = [];
    const indices: number[] = [];
    const weld = new Map<string, number>();
    const vertex = (x: number, y: number, z: number) => {
      const q = (n: number) => Math.round(n * 1e4);
      const key = `${q(x)},${q(y)},${q(z)}`;
      let index = weld.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        weld.set(key, index);
        positions.push(q(x) / 1e4, q(y) / 1e4, q(z) / 1e4);
      }
      return index;
    };
    for (const t of course.tiles) {
      const tri = meshes(t.def.model, t.def.skipNodes);
      const local: number[] = [];
      for (let i = 0; i < tri.positions.length; i += 3) {
        const p = tilePoint(t, tri.positions[i], tri.positions[i + 1], tri.positions[i + 2]);
        local.push(vertex(p.x, p.y, p.z));
      }
      for (let i = 0; i < tri.indices.length; i += 3) {
        if (isBuriedSide(tri, tri.indices[i], tri.indices[i + 1], tri.indices[i + 2])) continue;
        const [a, b, c] = [local[tri.indices[i]], local[tri.indices[i + 1]], local[tri.indices[i + 2]]];
        if (a !== b && b !== c && a !== c) indices.push(a, b, c);
      }
    }
    const flags = RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES;
    const ground = RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices), flags).setFriction(0.6).setRestitution(0.5);
    this.world.createCollider(ground);
    this.lowest = Math.min(...course.tiles.map((t) => t.y));

    this.cup = tilePoint(course.cup, 0, FLOOR, 0);
    this.tee = tilePoint(course.tee, 0, FLOOR + BALL_RADIUS + 0.002, -0.15);
    this.ball = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(this.tee.x, this.tee.y, this.tee.z).setCcdEnabled(true).setLinearDamping(0.04).setAngularDamping(0.6),
    );
    this.ballCollider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS).setDensity(1100).setFriction(0.6).setRestitution(0.55).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
      this.ball,
    );
  }

  get position() {
    return this.ball.translation();
  }

  /** Hits the ball along (dx, dz) at `power` from 0 to 1. */
  putt(dx: number, dz: number, power: number) {
    const len = Math.hypot(dx, dz) || 1;
    const speed = Math.max(0.05, Math.min(1, power)) * MAX_POWER;
    this.ball.setLinvel({ x: (dx / len) * speed, y: 0, z: (dz / len) * speed }, true);
    // Start it rolling rather than sliding.
    this.ball.setAngvel({ x: ((dz / len) * speed) / BALL_RADIUS, y: 0, z: (-(dx / len) * speed) / BALL_RADIUS }, true);
    this.moving = true;
    this.stillFor = 0;
  }

  /** Puts the ball back somewhere, at rest. */
  place(x: number, y: number, z: number) {
    this.ball.setTranslation({ x, y, z }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.moving = false;
  }

  /** Is the ball resting on (or very near) the ground below it? */
  private grounded() {
    const p = this.position;
    const hit = this.world.castRay(new RAPIER.Ray(p, { x: 0, y: -1, z: 0 }), BALL_RADIUS + 0.006, true, undefined, undefined, this.ballCollider);
    return hit !== null;
  }

  /** Advances one fixed step and reports what happened to the ball. */
  step(): BallEvent[] {
    const events: BallEvent[] = [];
    if (this.moving && this.grounded()) {
      const v = this.ball.linvel();
      const flat = Math.hypot(v.x, v.z);
      if (flat > 0) {
        const keep = Math.max(0, flat - ROLL_DECEL * STEP) / flat;
        this.ball.setLinvel({ x: v.x * keep, y: v.y, z: v.z * keep }, true);
      }
    }
    const queue = new RAPIER.EventQueue(true);
    this.world.step(queue);
    queue.drainContactForceEvents((e) => {
      // Mostly sideways force means a wall; the floor pushes up.
      if (Math.abs(e.maxForceDirection().y) > 0.7) return;
      const speed = e.maxForceMagnitude() / 40;
      if (speed > 0.2) events.push({ kind: 'wall', speed });
    });
    queue.free();
    if (!this.moving) return events;

    const p = this.position;
    const v = this.ball.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (Math.hypot(p.x - this.cup.x, p.z - this.cup.z) < CUP_RADIUS && p.y < this.cup.y + BALL_RADIUS - 0.012) {
      this.moving = false;
      events.push({ kind: 'sunk' });
    } else if (p.y < this.lowest - OUT_DEPTH) {
      this.moving = false;
      events.push({ kind: 'out' });
    } else if (speed < STOP_SPEED) {
      this.stillFor += STEP;
      if (this.stillFor > 0.3) {
        this.place(p.x, p.y, p.z);
        events.push({ kind: 'stopped' });
      }
    } else {
      this.stillFor = 0;
    }
    return events;
  }

  free() {
    this.world.free();
  }
}
