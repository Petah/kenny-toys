import * as Phaser from 'phaser';
import { EEL, PUFFER, SHEET, frameBounds, type Bounds, type Species } from './assets';

/** The swimmable band of water, in world units. */
export interface Water {
  width: number;
  top: number;
  bottom: number;
}

/** A body's hit area: an ellipse in world units. */
export interface Hit {
  x: number;
  y: number;
  a: number;
  b: number;
}

/** Hit ellipses are a little inside the drawn fish so fins and tails don't count. */
const BODY_A = 0.82;
const BODY_B = 0.72;

/**
 * True if two hit ellipses touch. Treated as one ellipse grown by the other's axes, which is
 * exact head-on and side-on and a touch generous on the diagonals. `fair` < 1 shrinks it further.
 */
export function touching(p: Hit, q: Hit, fair = 1) {
  const dx = (p.x - q.x) / ((p.a + q.a) * fair);
  const dy = (p.y - q.y) / ((p.b + q.b) * fair);
  return dx * dx + dy * dy < 1;
}

/** The hit ellipse of an image of `frame` at (x, y), drawn at `scale` and facing `dir`. */
export function bodyHit(bounds: Bounds, x: number, y: number, scale: number, dir: number): Hit {
  return {
    x: x + (bounds.x + bounds.w / 2) * scale * dir,
    y: y + (bounds.y + bounds.h / 2) * scale,
    a: (bounds.w / 2) * scale * BODY_A,
    b: (bounds.h / 2) * scale * BODY_B,
  };
}

export type Kind = 'fish' | 'puffer' | 'eel';

/** A fish, pufferfish or eel crossing the screen from one side to the other. */
export class Swimmer {
  readonly view: Phaser.GameObjects.Image | Phaser.GameObjects.Container;
  readonly dir: 1 | -1;
  x: number;
  y: number;
  /** The depth it swims at, which it bobs around and steers by. */
  private baseY: number;
  private speed: number;
  private phase = Math.random() * Math.PI * 2;
  private bob = Phaser.Math.FloatBetween(4, 12);
  private scale: number;
  private bounds: Bounds;
  /** 0 when relaxed, 1 when fully puffed up (pufferfish only). */
  puff = 0;
  /** Set once it's eaten, has swum away or is fading out; the scene drops it from its list. */
  gone = false;
  private head?: Phaser.GameObjects.Image;
  private tail?: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    readonly kind: Kind,
    readonly species: Species | undefined,
    water: Water,
    y: number,
    dir: 1 | -1,
  ) {
    this.dir = dir;
    this.y = this.baseY = y;
    if (kind === 'eel') {
      const tb = frameBounds(scene, EEL.tail);
      const hb = frameBounds(scene, EEL.head);
      // The tail piece runs off its cell's right edge and the head piece carries on from its left.
      const left = tb.x - 64;
      const right = 64 + hb.x + hb.w;
      this.scale = EEL.len / (right - left);
      // Both pieces hinge on the joint between them, so the eel can wiggle without a step there.
      this.tail = scene.add.image(0, 0, SHEET, EEL.tail).setOrigin(dir > 0 ? 1 : 0, 0.5).setFlipX(dir < 0);
      // Tucked a little under the tail, so no hairline shows at the joint.
      this.head = scene.add.image(-2 * dir, 0, SHEET, EEL.head).setOrigin(dir > 0 ? 0 : 1, 0.5).setFlipX(dir < 0);
      this.view = scene.add.container(0, 0, [this.tail, this.head]).setScale(this.scale);
      this.bounds = { x: left, y: Math.min(tb.y, hb.y), w: right - left, h: Math.max(tb.h, hb.h) };
      this.speed = EEL.speed;
    } else {
      const frame = kind === 'puffer' ? PUFFER.frame : species!.frame;
      this.bounds = frameBounds(scene, frame);
      this.scale = (kind === 'puffer' ? PUFFER.len : species!.len) / this.bounds.w;
      this.view = scene.add.image(0, 0, SHEET, frame).setScale(this.scale).setFlipX(dir < 0);
      const [lo, hi] = kind === 'puffer' ? PUFFER.speed : species!.speed;
      this.speed = Phaser.Math.FloatBetween(lo, hi);
    }
    this.x = dir > 0 ? -this.length / 2 - 20 : water.width + this.length / 2 + 20;
    this.view.setPosition(this.x, this.y);
  }

  get length() {
    return this.bounds.w * this.scale;
  }

  get hit(): Hit {
    const s = this.scale * (1 + this.puff * 0.5);
    return bodyHit(this.bounds, this.x, this.y, s, this.dir);
  }

  /**
   * Swims on across the screen. A predator drifts towards the player when it's ahead of it, and
   * prey darts away from them; neither ever turns round, so you can always outswim a chaser.
   */
  update(dt: number, time: number, water: Water, player: { x: number; y: number } | undefined, stance: 'prey' | 'predator' | 'neutral') {
    let speed = this.speed;
    if (player && this.kind === 'fish' && stance !== 'neutral') {
      const ahead = (player.x - this.x) * this.dir;
      const dy = player.y - this.baseY;
      if (stance === 'predator' && ahead > 0 && ahead < 260 && Math.abs(dy) < 200) {
        this.baseY += Math.sign(dy) * Math.min(Math.abs(dy), 70 * dt);
        speed *= 1.35;
      } else if (stance === 'prey' && Math.abs(ahead) < 110 && Math.abs(dy) < 80) {
        this.baseY -= (Math.sign(dy) || 1) * 60 * dt;
        speed *= 1.25;
      }
    }
    const margin = this.bounds.h * this.scale * 0.5;
    this.baseY = Phaser.Math.Clamp(this.baseY, water.top + margin, water.bottom - margin);

    const prevY = this.y;
    this.x += this.dir * speed * dt;
    const t = time / 1000 + this.phase;
    this.y = this.baseY + (this.kind === 'eel' ? 0 : Math.sin(t * 1.7) * this.bob);
    this.view.setPosition(this.x, this.y);

    if (this.kind === 'eel') {
      this.view.y += Math.sin(t * 11) * 2;
      this.head!.rotation = Math.sin(t * 11) * 0.05;
      this.tail!.rotation = Math.sin(t * 11 - 1.4) * 0.09;
    } else {
      const climb = dt > 0 ? (this.y - prevY) / dt : 0;
      this.view.rotation = Phaser.Math.Clamp(climb / speed, -0.3, 0.3) * this.dir;
      const s = this.scale * (1 + this.puff * 0.5);
      // A slight squash and stretch reads as swimming even though the sprite has one frame.
      this.view.setScale(s * (1 + Math.sin(t * 9) * 0.03), s * (1 - Math.sin(t * 9) * 0.03));
    }

    const off = this.length * (1 + this.puff * 0.5) / 2 + 40;
    if ((this.dir > 0 && this.x - off > water.width) || (this.dir < 0 && this.x + off < 0)) this.destroy();
  }

  destroy() {
    this.gone = true;
    this.view.destroy();
  }
}
