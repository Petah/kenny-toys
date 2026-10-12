import * as Phaser from 'phaser';
import { ATLAS, ATLAS_RES, GOOGLY_SIZES, categorize, type Category, type GooglySize } from './catalog';
import { GooglyEye, WHITE_RADIUS } from './GooglyEye';

/** Where the user put a part. Animation is layered on top of this each frame, never written into it. */
export interface Placement {
  x: number;
  y: number;
  rotation: number;
  size: number;
  flip: 1 | -1;
}

/** Per-frame animation offsets, reset every update. */
export interface Motion {
  dx: number;
  dy: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export class Part {
  readonly category: Category;
  frame: string;
  obj: Phaser.GameObjects.Image | GooglyEye;
  base: Placement;
  motion: Motion = { dx: 0, dy: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  /** The mirrored partner of a left/right pair, if any. */
  twin?: Part;
  /** 0→1 scale multiplier tweened when a part appears. */
  pop = 1;
  /** Random phase so parts don't all blink or sway in unison. */
  readonly phase = Math.random() * Math.PI * 2;

  constructor(
    private scene: Phaser.Scene,
    frame: string,
    base: Placement,
    private anchors: Map<string, { x: number; y: number }>,
  ) {
    this.category = categorize(frame)!;
    this.frame = frame;
    this.base = { ...base };
    this.obj = this.createObject();
    this.apply();
  }

  /** Scale that turns the art into on-screen size at size = 1. */
  private get unitScale() {
    if (this.category === 'googly') return (GOOGLY_SIZES[this.frame as GooglySize] * ATLAS_RES) / (2 * WHITE_RADIUS);
    return 1;
  }

  private createObject() {
    if (this.category === 'googly') {
      const eye = new GooglyEye(this.scene, this.base.x, this.base.y);
      eye.enableInput();
      return eye;
    }
    const image = this.scene.add.image(this.base.x, this.base.y, ATLAS.key, this.frame);
    const anchor = this.anchors.get(this.frame);
    if (anchor) image.setOrigin(anchor.x, anchor.y);
    image.setInteractive({ pixelPerfect: true, draggable: true, useHandCursor: true });
    return image;
  }

  /** Swaps the art in place, keeping placement, depth and links. */
  setFrame(frame: string) {
    if (categorize(frame) !== this.category) return;
    this.frame = frame;
    // A googly eye's "frame" is just its size, which unitScale reads.
    if (this.category === 'googly') return;
    const image = this.obj as Phaser.GameObjects.Image;
    image.setFrame(frame);
    const anchor = this.anchors.get(frame) ?? { x: 0.5, y: 0.5 };
    image.setOrigin(anchor.x, anchor.y);
    // setFrame resets the input hit area to the old frame's size.
    image.input!.hitArea.setTo(0, 0, image.frame.realWidth, image.frame.realHeight);
  }

  apply() {
    const { base, motion } = this;
    const s = base.size * this.unitScale * this.pop;
    this.obj.setPosition(base.x + motion.dx, base.y + motion.dy);
    // Mirrored parts rotate the opposite way so pairs animate symmetrically.
    this.obj.setRotation(base.rotation + motion.rotation * base.flip);
    this.obj.setScale(s * base.flip * motion.scaleX, s * motion.scaleY);
  }

  /** Screen-space bounds. Containers report odd bounds, so googly eyes use their circle. */
  bounds() {
    if (this.obj instanceof GooglyEye) {
      const r = WHITE_RADIUS * Math.abs(this.obj.scaleX);
      return new Phaser.Geom.Rectangle(this.obj.x - r, this.obj.y - r, r * 2, r * 2);
    }
    return this.obj.getBounds();
  }

  get depth() {
    return this.obj.depth;
  }

  set depth(value: number) {
    this.obj.setDepth(value);
  }

  destroy() {
    if (this.twin) this.twin.twin = undefined;
    this.obj.destroy();
  }
}
