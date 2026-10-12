import * as Phaser from 'phaser';
import { kenney } from '@shared/kenney';
import { playSfx, preloadSfx, type SfxGroups } from '@shared/phaser';
import { computeAnchors } from './anchors';
import { ATLAS, COLORS, GOOGLY_LAYERS, canBlink, categorize, layerOf, type GooglySize } from './catalog';
import { GooglyEye } from './GooglyEye';
import { Part, type Placement } from './Part';

const SFX: SfxGroups = {
  add: [1, 2, 3, 4].map((n) => `Audio/Interface Sounds/Audio/drop_00${n}.ogg`),
  select: [1, 2, 3].map((n) => `Audio/Interface Sounds/Audio/select_00${n}.ogg`),
  remove: [1, 2, 3].map((n) => `Audio/Interface Sounds/Audio/minimize_00${n}.ogg`),
  swap: [1, 2, 3].map((n) => `Audio/Interface Sounds/Audio/switch_00${n}.ogg`),
  save: ['Audio/Interface Sounds/Audio/confirmation_001.ogg'],
  jingle: Array.from({ length: 10 }, (_, n) => `Audio/Music Jingles/Audio (Pizzicato)/jingles-pizzicato_0${n}.ogg`),
};
const MUSIC = kenney('Audio/Music Loops/Loops/Swinging Pants.ogg');

const LAYER_DEPTH = { back: 1000, body: 2000, front: 3000 } as const;
const ROTATE_STEP = Phaser.Math.DegToRad(15);
/** Size of a body when none has been placed yet, in atlas pixels. */
const DEFAULT_BODY = { w: 360, h: 380 };

export type Op = 'rotate-left' | 'rotate-right' | 'smaller' | 'bigger' | 'flip' | 'front' | 'back' | 'duplicate' | 'delete';

export class MonsterScene extends Phaser.Scene {
  private parts: Part[] = [];
  private selected: Part | null = null;
  private anchors = new Map<string, { x: number; y: number }>();
  private dancing = false;
  private music?: Phaser.Sound.BaseSound;
  private shadow!: Phaser.GameObjects.Graphics;
  private selectionBox!: Phaser.GameObjects.Graphics;
  private pointerInside = false;
  private nextDepth = { back: 0, body: 0, front: 0 };
  private drag?: { start: Phaser.Math.Vector2; moves: { part: Part; from: Placement; mirror?: number }[] };

  constructor() {
    super('monster');
  }

  preload() {
    this.load.atlasXML(ATLAS.key, ATLAS.image, ATLAS.xml);
    this.load.image('googly-white', GOOGLY_LAYERS.white);
    this.load.image('googly-pupil', GOOGLY_LAYERS.pupil);
    this.load.image('googly-shine', GOOGLY_LAYERS.shine);
    this.load.audio('music', MUSIC);
    preloadSfx(this, SFX);
  }

  create() {
    this.anchors = computeAnchors(this.textures, ATLAS.key);
    this.shadow = this.add.graphics().setDepth(0);
    this.selectionBox = this.add.graphics().setDepth(10_000);

    this.input.on('gameover', () => (this.pointerInside = true));
    this.input.on('gameout', () => (this.pointerInside = false));
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0) this.select(null);
    });
    this.input.on('dragstart', this.onDragStart, this);
    this.input.on('drag', this.onDrag, this);
    this.input.on('dragend', () => (this.drag = undefined));
    this.input.on('wheel', this.onWheel, this);

    let last = { w: this.scale.width, h: this.scale.height, unit: this.unit };
    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      // Keep the monster centred and proportionate when the window changes size.
      const k = this.unit / last.unit;
      const [ox, oy] = [last.w / 2, last.h * 0.45];
      const [nx, ny] = [size.width / 2, size.height * 0.45];
      for (const p of this.parts) {
        p.base.x = nx + (p.base.x - ox) * k;
        p.base.y = ny + (p.base.y - oy) * k;
        p.base.size *= k;
      }
      last = { w: size.width, h: size.height, unit: this.unit };
    });

    this.events.emit('ready');
  }

  // ---- Queries the UI needs -------------------------------------------------------------

  /** Atlas frame names, for building the palette. */
  frameNames() {
    return this.textures.get(ATLAS.key).getFrameNames().sort();
  }

  frameRect(name: string) {
    const f = this.textures.getFrame(ATLAS.key, name);
    const src = this.textures.get(ATLAS.key).getSourceImage();
    return { x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight, sheetW: src.width, sheetH: src.height };
  }

  get partCount() {
    return this.parts.length;
  }

  // ---- Building ---------------------------------------------------------------------------

  /** Monster scale that fits the current stage, applied to newly added parts. */
  private get unit() {
    return Phaser.Math.Clamp(Math.min(this.scale.height / 1050, this.scale.width / 900), 0.25, 0.75);
  }

  private get body() {
    return this.parts.find((p) => p.category === 'body');
  }

  /** On-screen box of the body (or where one would go), used to place everything else. */
  private bodyBox() {
    const body = this.body;
    if (body) {
      const f = (body.obj as Phaser.GameObjects.Image).frame;
      return { x: body.base.x, y: body.base.y, w: f.realWidth * body.base.size, h: f.realHeight * body.base.size };
    }
    return { x: this.scale.width / 2, y: this.scale.height * 0.45, w: DEFAULT_BODY.w * this.unit, h: DEFAULT_BODY.h * this.unit };
  }

  private size() {
    return this.body?.base.size ?? this.unit;
  }

  private addPart(frame: string, at: Partial<Placement> & { x: number; y: number }, popDelay = 0) {
    const part = new Part(this, frame, { rotation: 0, size: this.size(), flip: 1, ...at }, this.anchors);
    const layer = layerOf(part.category);
    part.depth = LAYER_DEPTH[layer] + this.nextDepth[layer]++;
    this.parts.push(part);
    part.pop = 0;
    this.tweens.add({ targets: part, pop: 1, duration: 380, delay: popDelay, ease: 'Back.easeOut' });
    return part;
  }

  /** Adds a mirrored left/right pair; `x` is the right-hand side. */
  private addPair(frame: string, x: number, y: number, popDelay = 0) {
    const mid = this.bodyBox().x;
    const right = this.addPart(frame, { x, y }, popDelay);
    const left = this.addPart(frame, { x: 2 * mid - x, y, flip: -1 }, popDelay);
    right.twin = left;
    left.twin = right;
    return right;
  }

  /** Called when a palette item is clicked. */
  pick(frame: string) {
    const category = categorize(frame);
    if (!category) return;

    // Clicking a body, or a part of the same kind as the selection, swaps the art in place
    // so you can browse options by clicking through them.
    const target = category === 'body' ? this.body : this.selected?.category === category ? this.selected : undefined;
    if (target) {
      target.setFrame(frame);
      target.twin?.setFrame(frame);
      [target, target.twin].forEach((p) => p && this.tweens.add({ targets: p, pop: { from: 0.8, to: 1 }, duration: 300, ease: 'Back.easeOut' }));
      playSfx(this, SFX, 'swap');
      this.emitParts();
      return;
    }

    const b = this.bodyBox();
    const count = (c: string) => this.parts.filter((p) => p.category === c && p.base.flip === 1).length;
    let part: Part;
    switch (category) {
      case 'body':
        part = this.addPart(frame, { x: b.x, y: b.y });
        break;
      case 'arms':
        part = this.addPair(frame, b.x + b.w * 0.38, b.y - b.h * 0.05 + count('arms') * b.h * 0.18);
        break;
      case 'legs':
        part = this.addPair(frame, b.x + b.w * (0.2 + count('legs') * 0.12), b.y + b.h * 0.35);
        break;
      case 'extras':
        part = this.addPair(frame, b.x + b.w * (0.26 + count('extras') * 0.1), b.y - b.h * 0.38);
        break;
      case 'eyes':
      case 'googly': {
        const spot = frame.startsWith('eyebrow') ? this.browSpot(b) : this.freeEyeSpot(b);
        part = this.addPart(frame, spot);
        break;
      }
      case 'face': {
        const y = frame.startsWith('nose') ? 0.02 : frame.startsWith('snot') ? 0.1 : 0.22;
        part = this.addPart(frame, { x: b.x + (frame.startsWith('snot') ? b.w * 0.04 : 0), y: b.y + b.h * y });
        break;
      }
    }
    playSfx(this, SFX, 'add');
    this.select(part, false);
    this.emitParts();
  }

  private eyes() {
    return this.parts.filter((p) => p.category === 'googly' || (p.category === 'eyes' && !p.frame.startsWith('eyebrow')));
  }

  /** The spot in the face area furthest from existing eyes. */
  private freeEyeSpot(b: { x: number; y: number; w: number; h: number }) {
    const eyes = this.eyes();
    if (eyes.length === 0) return { x: b.x, y: b.y - b.h * 0.15 };
    let best = { x: b.x, y: b.y, score: -1 };
    for (let i = 0; i < 40; i++) {
      const x = b.x + Phaser.Math.FloatBetween(-0.3, 0.3) * b.w;
      const y = b.y + Phaser.Math.FloatBetween(-0.32, 0.05) * b.h;
      const score = Math.min(...eyes.map((e) => Phaser.Math.Distance.Between(x, y, e.base.x, e.base.y)));
      if (score > best.score) best = { x, y, score };
    }
    return { x: best.x, y: best.y };
  }

  /** Above an eye that doesn't have a brow yet, or the top of the face. */
  private browSpot(b: { x: number; y: number; w: number; h: number }) {
    const brows = this.parts.filter((p) => p.frame.startsWith('eyebrow'));
    const eye = this.eyes().find((e) => !brows.some((br) => Math.abs(br.base.x - e.base.x) < 10));
    if (!eye) return { x: b.x, y: b.y - b.h * 0.32 };
    return { x: eye.base.x, y: eye.base.y - eye.obj.displayHeight * 0.75 };
  }

  randomize() {
    this.clear(false);
    const pick = <T>(xs: readonly T[]) => xs[Phaser.Math.Between(0, xs.length - 1)];
    const chance = (p: number) => Math.random() < p;
    const frames = this.frameNames();
    const of = (prefix: string) => frames.filter((f) => f.startsWith(prefix));

    const bodyColor = pick(COLORS);
    const limbColor = chance(0.7) ? bodyColor : pick(COLORS);
    const center = { x: this.scale.width / 2, y: this.scale.height * 0.45 };
    this.addPart(pick(of(`body_${bodyColor}`)), center);
    const b = this.bodyBox();
    let delay = 120;
    const next = () => (delay += 70);

    const arms = pick(of(`arm_${limbColor}`));
    this.addPair(arms, b.x + b.w * 0.38, b.y - b.h * 0.05, next());
    if (chance(0.15)) this.addPair(arms, b.x + b.w * 0.4, b.y + b.h * 0.15, next());
    const legs = pick(of(`leg_${limbColor}`));
    this.addPair(legs, b.x + b.w * 0.2, b.y + b.h * 0.35, next());
    if (chance(0.6)) this.addPair(pick(of(`detail_${chance(0.5) ? limbColor : pick(COLORS)}`)), b.x + b.w * 0.26, b.y - b.h * 0.38, next());

    const eyeCount = pick([1, 1, 2, 2, 2, 3]);
    const googly = chance(0.5);
    const eyeFrame = googly ? undefined : pick(of('eye_').filter((f) => !f.startsWith('eye_closed')));
    const spots = {
      1: [[0, -0.15]],
      2: [[-0.18, -0.12], [0.18, -0.12]],
      3: [[-0.2, -0.08], [0.2, -0.08], [0, -0.3]],
    }[eyeCount]!;
    const googlySize: GooglySize = eyeCount === 1 ? 'googly:l' : eyeCount === 2 ? 'googly:m' : 'googly:s';
    for (const [sx, sy] of spots) {
      this.addPart(eyeFrame ?? googlySize, { x: b.x + sx * b.w, y: b.y + sy * b.h }, next());
    }
    if (!googly && eyeCount <= 2 && chance(0.35)) {
      const brow = pick(of('eyebrow'));
      for (const [sx, sy] of spots) this.addPart(brow, { x: b.x + sx * b.w, y: b.y + (sy - 0.14) * b.h }, next());
    }
    this.addPart(pick(of('mouth')), { x: b.x, y: b.y + b.h * 0.22 }, next());
    if (chance(0.4)) {
      this.addPart(pick(of('nose_')), { x: b.x, y: b.y + b.h * 0.04 }, next());
      if (chance(0.25)) this.addPart(pick(of('snot_')), { x: b.x + b.w * 0.03, y: b.y + b.h * 0.12 }, next());
    }

    playSfx(this, SFX, 'jingle', { volume: 0.4, detune: 0 });
    this.select(null);
    this.emitParts();
  }

  clear(withSound = true) {
    if (withSound && this.parts.length) playSfx(this, SFX, 'remove');
    this.parts.forEach((p) => p.destroy());
    this.parts = [];
    this.nextDepth = { back: 0, body: 0, front: 0 };
    this.select(null);
    this.emitParts();
  }

  // ---- Selection and edits ------------------------------------------------------------------

  select(part: Part | null, withSound = true) {
    if (part === this.selected) return;
    this.selected = part;
    if (part && withSound) playSfx(this, SFX, 'select', { volume: 0.3 });
    this.events.emit('selection', part ? { category: part.category, frame: part.frame } : null);
  }

  op(name: Op) {
    const part = this.selected;
    if (!part) return;
    // Size and rotation changes carry over to a linked twin, mirrored.
    const both = [part, part.twin].filter((p): p is Part => !!p);
    switch (name) {
      case 'rotate-left':
      case 'rotate-right': {
        const step = name === 'rotate-left' ? -ROTATE_STEP : ROTATE_STEP;
        part.base.rotation += step;
        if (part.twin) part.twin.base.rotation = -part.base.rotation;
        break;
      }
      case 'smaller':
      case 'bigger':
        both.forEach((p) => (p.base.size = Phaser.Math.Clamp(p.base.size * (name === 'bigger' ? 1.12 : 1 / 1.12), 0.08, 3)));
        break;
      case 'flip':
        part.base.flip = part.base.flip === 1 ? -1 : 1;
        break;
      case 'front':
        part.depth = Math.max(...this.parts.map((p) => p.depth)) + 1;
        break;
      case 'back':
        part.depth = Math.min(...this.parts.map((p) => p.depth)) - 1;
        break;
      case 'duplicate': {
        const copy = this.addPart(part.frame, { ...part.base, x: part.base.x + 30, y: part.base.y + 30 });
        copy.depth = part.depth + 0.5;
        playSfx(this, SFX, 'add');
        this.select(copy, false);
        break;
      }
      case 'delete':
        this.parts = this.parts.filter((p) => p !== part);
        part.destroy();
        playSfx(this, SFX, 'remove');
        this.select(null);
        break;
    }
    this.emitParts();
  }

  /** Nudges the selected part's size or rotation; used by the mouse wheel. */
  private onWheel(_pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[], _dx: number, dy: number, _dz: number, event?: WheelEvent) {
    const part = this.selected ?? this.partOf(over[0]);
    if (!part) return;
    const both = [part, part.twin].filter((p): p is Part => !!p);
    if (event?.shiftKey) {
      part.base.rotation += dy * 0.003;
      if (part.twin) part.twin.base.rotation = -part.base.rotation;
    } else {
      both.forEach((p) => (p.base.size = Phaser.Math.Clamp(p.base.size * Math.exp(-dy * 0.0015), 0.08, 3)));
    }
  }

  private partOf(obj?: Phaser.GameObjects.GameObject) {
    return obj ? this.parts.find((p) => p.obj === obj) : undefined;
  }

  private onDragStart(pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) {
    const part = this.partOf(obj);
    if (!part) return;
    this.select(part);
    const start = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
    if (part.category === 'body') {
      // The body is the handle for the whole monster.
      this.drag = { start, moves: this.parts.map((p) => ({ part: p, from: { ...p.base } })) };
      return;
    }
    const moves: NonNullable<typeof this.drag>['moves'] = [{ part, from: { ...part.base } }];
    // Pairs stay symmetric about the body unless Alt is held.
    if (part.twin && !(pointer.event as MouseEvent).altKey) {
      moves.push({ part: part.twin, from: { ...part.twin.base }, mirror: this.bodyBox().x });
    }
    this.drag = { start, moves };
  }

  private onDrag(pointer: Phaser.Input.Pointer) {
    if (!this.drag) return;
    const dx = pointer.worldX - this.drag.start.x;
    const dy = pointer.worldY - this.drag.start.y;
    const [lead] = this.drag.moves;
    for (const { part, from, mirror } of this.drag.moves) {
      if (mirror !== undefined) {
        part.base.x = 2 * mirror - (lead.from.x + dx);
        part.base.y = lead.from.y + dy;
      } else {
        part.base.x = from.x + dx;
        part.base.y = from.y + dy;
      }
    }
  }

  // ---- Fun ---------------------------------------------------------------------------------

  toggleDance() {
    this.dancing = !this.dancing;
    if (this.dancing) {
      this.music ??= this.sound.add('music', { loop: true, volume: 0.5 });
      this.music.play();
    } else {
      this.music?.stop();
    }
    this.events.emit('dance', this.dancing);
  }

  /** Saves the monster, cropped to its bounds, as a transparent PNG. */
  save() {
    if (!this.parts.length) return;
    const bounds = this.parts.map((p) => p.bounds()).reduce((a, b) => Phaser.Geom.Rectangle.Union(a, b));
    const pad = 24;
    const x = Math.max(0, Math.floor(bounds.x - pad));
    const y = Math.max(0, Math.floor(bounds.y - pad));
    const w = Math.min(this.scale.width - x, Math.ceil(bounds.width + pad * 2));
    const h = Math.min(this.scale.height - y, Math.ceil(bounds.height + pad * 2));
    this.selectionBox.setVisible(false);
    this.renderer.snapshotArea(x, y, w, h, (image) => {
      this.selectionBox.setVisible(true);
      if (!(image instanceof HTMLImageElement)) return;
      const a = document.createElement('a');
      a.href = image.src;
      a.download = 'my-monster.png';
      a.click();
      playSfx(this, SFX, 'save');
    });
  }

  private emitParts() {
    this.events.emit('parts', this.parts.length);
  }

  // ---- Per-frame animation ---------------------------------------------------------------

  update(time: number, delta: number) {
    const t = time / 1000;
    const dt = Math.min(delta / 1000, 1 / 30);
    const s = this.size();
    const bounce = this.dancing ? Math.abs(Math.sin(t * Math.PI * 2)) : 0;
    const sway = this.dancing ? Math.sin(t * Math.PI) : 0;

    for (const part of this.parts) {
      const m = part.motion;
      m.dx = sway * 18 * s;
      m.dy = -bounce * 30 * s;
      m.rotation = 0;
      m.scaleX = m.scaleY = 1;
      const side = part.base.flip === 1 ? 0 : Math.PI;

      switch (part.category) {
        case 'body': {
          const squash = this.dancing ? 0.06 * Math.cos(t * Math.PI * 4) : 0.015 * Math.sin(t * 2.2 + part.phase);
          m.scaleY = 1 + squash;
          m.scaleX = 1 - squash * 0.6;
          break;
        }
        case 'arms':
          m.rotation = this.dancing ? 0.6 * Math.sin(t * Math.PI * 2 + side) : 0.05 * Math.sin(t * 1.7 + part.phase);
          break;
        case 'legs':
          m.rotation = this.dancing ? 0.18 * Math.sin(t * Math.PI * 2 + side) : 0;
          break;
        case 'extras':
          m.rotation = (this.dancing ? 0.2 : 0.04) * Math.sin(t * (this.dancing ? Math.PI * 4 : 2) + part.phase);
          break;
        case 'eyes':
          if (canBlink(part.frame) && (t + part.phase) % 4.2 < 0.13) m.scaleY = 0.1;
          break;
      }
      part.apply();
    }

    const pointer = this.input.activePointer;
    const looking = this.pointerInside && (!pointer.wasTouch || pointer.isDown);
    const lookAt = looking ? new Phaser.Math.Vector2(pointer.worldX, pointer.worldY) : null;
    for (const part of this.parts) {
      if (part.obj instanceof GooglyEye) part.obj.step(dt, lookAt);
    }

    this.drawShadow(bounce);
    this.drawSelection();
  }

  private drawShadow(bounce: number) {
    this.shadow.clear();
    const body = this.body;
    if (!body) return;
    // Floor is the lowest point of the monster at rest, so the shadow stays put while it hops.
    const floor = Math.max(...this.parts.map((p) => p.bounds().bottom - p.motion.dy));
    const w = body.obj.displayWidth * 1.2 * (1 - bounce * 0.25);
    this.shadow.fillStyle(0x000000, 0.22 - bounce * 0.08);
    this.shadow.fillEllipse(body.base.x + body.motion.dx, floor - 4, w, w * 0.16);
  }

  private drawSelection() {
    this.selectionBox.clear();
    if (!this.selected) return;
    const b = this.selected.bounds();
    this.selectionBox.lineStyle(3, 0xffbf3c, 0.9);
    this.selectionBox.strokeRoundedRect(b.x - 6, b.y - 6, b.width + 12, b.height + 12, 10);
  }
}
