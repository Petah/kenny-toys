import * as Phaser from 'phaser';

/** Layer images are 1024² with the eye centred; these are measured from the art. */
const SOURCE_SIZE = 1024;
export const WHITE_RADIUS = 486;
const PUPIL_TRAVEL = 190;

/**
 * A googly eye whose pupil is a damped spring: it lags behind when the eye moves,
 * bounces off the rim, and drifts towards the pointer (or falls under gravity).
 */
export class GooglyEye extends Phaser.GameObjects.Container {
  private pupil: Phaser.GameObjects.Image;
  private offset = new Phaser.Math.Vector2(0, PUPIL_TRAVEL * 0.6);
  private velocity = new Phaser.Math.Vector2();
  private lastPos?: Phaser.Math.Vector2;
  // Each eye gets slightly different springiness so pairs don't move in lockstep.
  private stiffness = Phaser.Math.FloatBetween(40, 90);
  private damping = Phaser.Math.FloatBetween(3, 6);

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    const white = scene.add.image(0, 0, 'googly-white');
    this.pupil = scene.add.image(0, 0, 'googly-pupil');
    const shine = scene.add.image(0, 0, 'googly-shine');
    this.add([white, this.pupil, shine]);
    this.setSize(SOURCE_SIZE, SOURCE_SIZE);
    scene.add.existing(this);
  }

  /** A circle hit area in the container's local space, which Phaser measures from its top-left. */
  enableInput() {
    const c = SOURCE_SIZE / 2;
    this.setInteractive({
      hitArea: new Phaser.Geom.Circle(c, c, WHITE_RADIUS),
      hitAreaCallback: Phaser.Geom.Circle.Contains,
      draggable: true,
      useHandCursor: true,
    });
  }

  /** Advances the pupil. `lookAt` is a world point to gaze at, or null to let gravity win. */
  step(dt: number, lookAt: Phaser.Math.Vector2 | null) {
    const pos = new Phaser.Math.Vector2(this.x, this.y);
    const toLocal = (v: Phaser.Math.Vector2) =>
      v.rotate(-this.rotation).set(v.x / (this.scaleX || 1), v.y / (this.scaleY || 1));

    // Inertia: when the eye moves, the pupil stays put in the world and so slides back in the eye.
    if (this.lastPos) {
      const moved = toLocal(pos.clone().subtract(this.lastPos));
      this.offset.subtract(moved.scale(0.9));
    }
    this.lastPos = pos;

    let target: Phaser.Math.Vector2;
    if (lookAt) {
      const toPointer = toLocal(lookAt.clone().subtract(pos));
      const reach = Math.min(1, toPointer.length() / 300);
      target = toPointer.normalize().scale(PUPIL_TRAVEL * 0.8 * reach);
    } else {
      target = toLocal(new Phaser.Math.Vector2(0, PUPIL_TRAVEL));
    }

    const accel = target.subtract(this.offset).scale(this.stiffness).subtract(this.velocity.clone().scale(this.damping));
    this.velocity.add(accel.scale(dt));
    this.offset.add(this.velocity.clone().scale(dt));

    // Bounce off the rim of the eye.
    if (this.offset.length() > PUPIL_TRAVEL) {
      const normal = this.offset.clone().normalize();
      this.offset.copy(normal.clone().scale(PUPIL_TRAVEL));
      const outward = this.velocity.dot(normal);
      if (outward > 0) this.velocity.subtract(normal.scale(outward * 1.5));
    }

    this.pupil.setPosition(this.offset.x, this.offset.y);
  }
}
