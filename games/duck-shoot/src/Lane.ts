import * as Phaser from 'phaser';

export type Kind = 'duck' | 'duckTarget' | 'target' | 'gold';

interface Spec {
  kind: Kind;
  face: string;
  back: string;
  stick: string;
}

const pick = <T,>(xs: readonly T[]) => xs[Phaser.Math.Between(0, xs.length - 1)];

function duckSpec(): Spec {
  const color = pick(['yellow', 'brown', 'white']);
  const painted = Math.random() < 0.3;
  return {
    kind: painted ? 'duckTarget' : 'duck',
    face: painted ? `duck_outline_target_${color}.png` : `duck_outline_${color}.png`,
    back: 'duck_outline_back.png',
    stick: 'stick_wood_outline.png',
  };
}

function targetSpec(): Spec {
  const gold = Math.random() < 0.1;
  return {
    kind: gold ? 'gold' : 'target',
    face: gold ? 'target_colored_outline.png' : `target_${pick(['red1', 'red2', 'red3', 'white'])}_outline.png`,
    back: 'target_back_outline.png',
    stick: 'stick_metal_outline.png',
  };
}

export interface Hit {
  target: Target;
  points: number;
  /** Where the shot landed, in the target's local space, for the bullet hole. */
  local: Phaser.Math.Vector2;
  bullseye: boolean;
}

/** A duck or target on a stick. The face is the shootable part. */
export class Target extends Phaser.GameObjects.Container {
  readonly kind: Kind;
  alive = true;
  private face: Phaser.GameObjects.Image;
  private readonly phase = Math.random() * Math.PI * 2;
  private bobY = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    private baseY: number,
    private spec: Spec,
  ) {
    super(scene, x, baseY);
    this.kind = spec.kind;
    const isDuck = spec.kind === 'duck' || spec.kind === 'duckTarget';
    const stick = scene.add.image(0, isDuck ? 20 : 45, 'objects', spec.stick).setOrigin(0.5, 0);
    this.face = scene.add.image(0, 0, 'objects', spec.face);
    this.add([stick, this.face]);
    scene.add.existing(this);
  }

  /** Ducks bob and rock on the water; targets sway on their poles. */
  bob(time: number) {
    if (!this.alive) return;
    const t = time / 1000 + this.phase;
    const isDuck = this.kind === 'duck' || this.kind === 'duckTarget';
    this.bobY = isDuck ? Math.sin(t * 4) * 5 : 0;
    this.y = this.baseY + this.bobY;
    this.rotation = isDuck ? Math.sin(t * 3) * 0.06 : Math.sin(t * 1.5) * 0.02;
  }

  /** Tests a world point against the face's opaque pixels and scores it. */
  hitTest(x: number, y: number): Hit | null {
    if (!this.alive) return null;
    const local = this.face.getWorldTransformMatrix().applyInverse(x, y);
    const px = local.x + this.face.displayOriginX;
    const py = local.y + this.face.displayOriginY;
    if (px < 0 || py < 0 || px >= this.face.width || py >= this.face.height) return null;
    if (this.scene.textures.getPixelAlpha(Math.floor(px), Math.floor(py), 'objects', this.spec.face) < 128) return null;

    const dist = local.length();
    let points = 10;
    let bullseye = false;
    if (this.kind === 'duckTarget') points = 25;
    if (this.kind === 'target' || this.kind === 'gold') {
      bullseye = dist < 13;
      points = bullseye ? 50 : dist < 38 ? 25 : 10;
      if (this.kind === 'gold') points *= 2;
    }
    return { target: this, points, local: new Phaser.Math.Vector2(local.x, local.y), bullseye };
  }

  /** Bullet hole, flip to the back, then drop out of sight. */
  knockDown(hit: Hit, onGone: () => void) {
    this.alive = false;
    const hole = this.scene.add.image(hit.local.x, hit.local.y, 'objects', 'shot_brown_small.png');
    this.add(hole);
    this.scene.tweens.chain({
      targets: this,
      tweens: [
        { scaleX: 0, duration: 110, ease: 'Sine.easeIn', delay: 80 },
        {
          scaleX: this.scaleY,
          duration: 110,
          ease: 'Sine.easeOut',
          onStart: () => {
            this.face.setFrame(this.spec.back);
            hole.setVisible(false);
          },
        },
        { y: this.y + 220, angle: Phaser.Math.Between(-25, 25), duration: 420, ease: 'Back.easeIn', delay: 150 },
      ],
      onComplete: () => {
        this.destroy();
        onGone();
      },
    });
  }
}

export interface LaneConfig {
  y: number;
  direction: 1 | -1;
  speed: number;
  depth: number;
  gap: [number, number];
  /** Shots below this y hit the scenery in front of the lane instead. */
  coverTop: number;
  kind: 'ducks' | 'targets';
  scale?: number;
}

/** A conveyor row of targets moving across the stall. */
export class Lane {
  readonly targets: Target[] = [];
  private untilNext = 0;

  constructor(
    private scene: Phaser.Scene,
    readonly config: LaneConfig,
    private width: number,
  ) {
    // Pre-fill so the gallery isn't empty when the round starts.
    for (let x = 80; x < width; x += Phaser.Math.Between(...config.gap)) this.spawn(x);
    this.untilNext = Phaser.Math.Between(...config.gap);
  }

  private spawn(x?: number) {
    const { direction, y, kind, depth, scale = 1 } = this.config;
    const startX = x ?? (direction === 1 ? -100 : this.width + 100);
    const target = new Target(this.scene, startX, y, kind === 'ducks' ? duckSpec() : targetSpec());
    target.setDepth(depth).setScale(scale);
    if (direction === -1 && target.kind !== 'target' && target.kind !== 'gold') target.scaleX *= -1;
    this.targets.push(target);
  }

  update(time: number, dt: number, speedFactor: number) {
    const step = this.config.speed * speedFactor * dt;
    this.untilNext -= step;
    if (this.untilNext <= 0) {
      this.spawn();
      this.untilNext = Phaser.Math.Between(...this.config.gap);
    }
    for (const t of [...this.targets]) {
      t.x += step * this.config.direction;
      t.bob(time);
      if (t.x < -150 || t.x > this.width + 150) this.remove(t, true);
    }
  }

  remove(target: Target, destroy = false) {
    const i = this.targets.indexOf(target);
    if (i >= 0) this.targets.splice(i, 1);
    if (destroy) target.destroy();
  }
}
