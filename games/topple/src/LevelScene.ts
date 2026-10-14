import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { SFX, type Voice } from './assets';
import { MATERIALS, SCALE, SHAPE_SIZE, bodyShape, frameFor, type Material, type Shape } from './blocks';
import { LEVELS, type BlockSpec, type CreatureSpec, type Level, type ShotKind } from './levels';
import { loadProgress, recordClear } from './progress';
import { GROUND, HEIGHT, TEXT, WIDTH, drawBackdrop, makeButton, starRow } from './ui';

type MatterImage = Phaser.Physics.Matter.Image;
type SfxName = keyof typeof SFX;

interface Block {
  kind: 'block';
  obj: MatterImage;
  material: Material;
  shape: Shape;
  hp: number;
  damage: 0 | 1 | 2;
  dead: boolean;
  lastSound: number;
}

interface Creature {
  kind: 'creature';
  obj: MatterImage;
  /** The drawn alien. The physics image is hidden so the face can squash and shiver freely. */
  face: Phaser.GameObjects.Image;
  hp: number;
  dead: boolean;
  lastSound: number;
  scaredUntil: number;
  /** 0..1, eased towards 1 while scared. */
  tremble: number;
  blinkAt: number;
  color: number;
}

interface Shot {
  kind: 'shot';
  obj: MatterImage;
  type: ShotKind;
  dead: boolean;
  landed: boolean;
  lastSound: number;
}

type Piece = Block | Creature | Shot;
type State = 'intro' | 'ready' | 'aiming' | 'flying' | 'finale' | 'over';

/** Where the loaded shot rests in the slingshot. */
const ANCHOR = { x: 215, y: 494 };
const MAX_PULL = 120;
/** Launch speed (px per physics step) per pixel of pull. */
const POWER = 0.165;
const SHOT_SCALE = 0.75;
const SHOT_RADIUS = 34 * SHOT_SCALE;
const SHOT_AIR = 0.0015;
/** Per-step gravity in Matter's units: gravity.y × gravity.scale × (1000/60)². */
const STEP_GRAVITY = 0.001 * (1000 / 60) ** 2;

const CREATURE_HP = 8;
const CREATURE_POINTS = 2000;
const SHOT_BONUS = 3000;
/** Impacts slower than this (px per step) don't hurt. */
const DAMAGE_FLOOR = 2.2;
/** How much of a shot's speed survives smashing through a block of each material. */
const CARRY_THROUGH: Record<Material, number> = { glass: 0.85, wood: 0.6, stone: 0.35, metal: 0.2, tnt: 0.5 };
const ALIEN_COLORS: Record<CreatureSpec['color'], number> = {
  Beige: 0xe6d3a3,
  Blue: 0x8db4e6,
  Green: 0x6fcf9f,
  Pink: 0xf09bb4,
  Yellow: 0xffd23f,
};

export class LevelScene extends Phaser.Scene {
  private levelIndex = 0;
  private level!: Level;
  private state: State = 'intro';
  private pieces: Piece[] = [];
  private byBody = new Map<number, Piece>();
  private queue: ShotKind[] = [];
  private loaded?: { kind: ShotKind; img: Phaser.GameObjects.Image };
  private waiting: Phaser.GameObjects.Image[] = [];
  private shot?: Shot;
  private score = 0;
  private starAt: [number, number] = [0, 0];
  private launchedAt = 0;
  private calmFor = 0;
  private graceUntil = 0;
  private shotsFired = 0;
  private dragFrom?: { x: number; y: number };
  private pull = new Phaser.Math.Vector2();
  private lastCreak = 0;
  private sfxAt = new Map<string, number>();
  private trail: Phaser.GameObjects.Image[] = [];
  private trailTick = 0;

  private aimDots!: Phaser.GameObjects.Graphics;
  private bandBack!: Phaser.GameObjects.Graphics;
  private bandFront!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private scoreText!: Phaser.GameObjects.Text;
  private shotIcons: Phaser.GameObjects.Image[] = [];
  private hint?: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;
  private debris = new Map<Material, Phaser.GameObjects.Particles.ParticleEmitter>();
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('level');
  }

  init(data: { level?: number }) {
    this.levelIndex = Phaser.Math.Clamp(data.level ?? 0, 0, LEVELS.length - 1);
    this.level = LEVELS[this.levelIndex];
    this.state = 'intro';
    this.pieces = [];
    this.byBody.clear();
    this.queue = [...this.level.shots];
    this.loaded = undefined;
    this.waiting = [];
    this.shot = undefined;
    this.score = 0;
    this.shotsFired = 0;
    this.trail = [];
    this.shotIcons = [];
    this.overlay = undefined;
    this.hint = undefined;
    this.debris.clear();
  }

  create() {
    this.cameras.main.setBounds(0, 0, WIDTH, HEIGHT).fadeIn(250, 47, 111, 143);
    drawBackdrop(this, this.level.backdrop);
    // The ground stops at the right edge, so anything shoved off it drops out of the world.
    this.matter.add.rectangle((WIDTH - 200) / 2, GROUND + 40, WIDTH + 200, 80, { isStatic: true, friction: 1, label: 'ground' });

    this.buildSlingshot();
    this.level.blocks.forEach((b) => this.addBlock(b));
    this.level.creatures.forEach((c) => this.addCreature(c));
    this.computeStars();
    this.makeEmitters();
    this.buildHud();
    this.graceUntil = this.time.now + 800;

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('pointerupoutside', this.onPointerUp, this);
    this.input.keyboard?.on('keydown-R', () => this.restart());
    this.input.keyboard?.on('keydown-ESC', () => this.toMenu());
    this.matter.world.on('collisionstart', this.onCollisions, this);

    const music = this.sound.get('music') ?? this.sound.add('music', { loop: true, volume: 0.22 });
    if (!music.isPlaying) music.play();
    this.intro();
  }

  // ---- Building the level -------------------------------------------------------------------

  private addBlock(spec: BlockSpec) {
    const def = MATERIALS[spec.m];
    const obj = this.matter.add.image(0, 0, 'elements', frameFor(spec.m, spec.s, 0), {
      shape: bodyShape(spec.s, spec.flip),
      density: def.density,
      friction: def.friction,
      frictionStatic: 1,
      restitution: def.restitution,
      label: spec.m,
    });
    obj.setScale(SCALE).setFlipX(!!spec.flip).setDepth(10);
    this.placeBottom(obj, spec.x, GROUND - spec.y, SHAPE_SIZE[spec.s].h * SCALE);
    obj.setToSleep();
    this.register({ kind: 'block', obj, material: spec.m, shape: spec.s, hp: def.hp, damage: 0, dead: false, lastSound: 0 });
  }

  private addCreature(spec: CreatureSpec) {
    const frame = `alien${spec.color}_${spec.round ? 'round' : 'square'}.png`;
    const obj = this.matter.add.image(0, 0, 'aliens', frame, {
      shape: spec.round ? { type: 'circle', radius: 34 } : undefined,
      chamfer: spec.round ? undefined : { radius: 10 },
      density: 0.0012,
      friction: 0.9,
      frictionStatic: 1,
      restitution: 0.1,
      label: 'creature',
    });
    obj.setScale(SCALE).setVisible(false);
    this.placeBottom(obj, spec.x, GROUND - spec.y, 70 * SCALE);
    obj.setToSleep();
    const face = this.add.image(obj.x, obj.y, 'aliens', frame).setScale(SCALE).setDepth(11);
    // Pop in.
    face.setScale(0);
    this.tweens.add({ targets: face, scale: SCALE, duration: 350, delay: 200 + Math.random() * 300, ease: 'Back.easeOut' });
    this.register({
      kind: 'creature',
      obj,
      face,
      hp: CREATURE_HP,
      dead: false,
      lastSound: 0,
      scaredUntil: 0,
      tremble: 0,
      blinkAt: this.time.now + Phaser.Math.Between(800, 3000),
      color: ALIEN_COLORS[spec.color],
    });
  }

  /** Moves a body so its bounding box is centred on x with its bottom at `bottom` (polygons are created centred on their centroid). */
  private placeBottom(obj: MatterImage, x: number, bottom: number, height: number) {
    const body = obj.body as MatterJS.BodyType;
    const cx = (body.bounds.min.x + body.bounds.max.x) / 2;
    const cy = (body.bounds.min.y + body.bounds.max.y) / 2;
    obj.setPosition(obj.x + x - cx, obj.y + bottom - height / 2 - cy);
  }

  private register(piece: Piece) {
    this.pieces.push(piece);
    this.byBody.set((piece.obj.body as MatterJS.BodyType).id, piece);
  }

  private computeStars() {
    const creatures = this.level.creatures.length * CREATURE_POINTS;
    const blocks = this.level.blocks.reduce((sum, b) => sum + MATERIALS[b.m].points, 0);
    const spare = Math.max(1, this.level.shots.length - 2) * SHOT_BONUS;
    const round = (n: number) => Math.round(n / 500) * 500;
    this.starAt = [round(creatures + blocks * 0.2), round(creatures + blocks * 0.45 + spare)];
  }

  private buildSlingshot() {
    const base = GROUND;
    this.add.image(ANCHOR.x, base - 48, 'elements', 'elementWood019.png').setDisplaySize(26, 100).setDepth(5);
    this.add.image(ANCHOR.x - 13, ANCHOR.y + 26, 'elements', 'elementWood016.png').setDisplaySize(22, 62).setRotation(-0.3).setDepth(5);
    this.bandBack = this.add.graphics().setDepth(6);
    this.add.image(ANCHOR.x + 13, ANCHOR.y + 26, 'elements', 'elementWood016.png').setDisplaySize(22, 62).setRotation(0.3).setDepth(14);
    this.bandFront = this.add.graphics().setDepth(15);
    this.aimDots = this.add.graphics().setDepth(16);
    this.drawBands(ANCHOR.x, ANCHOR.y);
  }

  /** Arm tips the rubber band is tied to. */
  private get tips() {
    return { back: { x: ANCHOR.x - 23, y: ANCHOR.y - 2 }, front: { x: ANCHOR.x + 23, y: ANCHOR.y - 2 } };
  }

  private drawBands(x: number, y: number) {
    const { back, front } = this.tips;
    const stretch = Phaser.Math.Distance.Between(x, y, ANCHOR.x, ANCHOR.y);
    const width = Phaser.Math.Linear(8, 4, Math.min(1, stretch / MAX_PULL));
    this.bandBack.clear().lineStyle(width, 0x4a2a14).lineBetween(back.x, back.y, x - 8, y);
    this.bandFront.clear().lineStyle(width, 0x5c3418).lineBetween(x + 6, y, front.x, front.y);
    this.bandBack.fillStyle(0x3a2010).fillRoundedRect(x - 16, y - 12, 18, 24, 6);
  }

  private makeEmitters() {
    for (const m of Object.keys(MATERIALS) as Material[]) {
      const def = MATERIALS[m];
      const emitter = this.add
        .particles(0, 0, 'debris', {
          frame: [1, 2, 3].map((n) => `debris${def.debris}_${n}.png`),
          lifespan: { min: 700, max: 1200 },
          speed: { min: 120, max: 380 },
          angle: { min: 200, max: 340 },
          gravityY: 1300,
          rotate: { start: 0, end: 540 },
          scale: { start: 0.55, end: 0.3 },
          alpha: { start: 1, end: 0, ease: 'Cubic.easeIn' },
          tint: def.debrisTint ?? 0xffffff,
          emitting: false,
        })
        .setDepth(20);
      this.debris.set(m, emitter);
    }
    this.dust = this.add
      .particles(0, 0, 'puff', {
        lifespan: { min: 500, max: 900 },
        speed: { min: 20, max: 110 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.08, end: 0.22 },
        alpha: { start: 0.75, end: 0 },
        rotate: { min: 0, max: 360 },
        emitting: false,
      })
      .setDepth(19);
  }

  private buildHud() {
    const title = this.add
      .text(WIDTH / 2, 30, `${this.levelIndex + 1}. ${this.level.name}`, { ...TEXT, fontSize: '30px', strokeThickness: 7 })
      .setOrigin(0.5, 0.5);
    this.scoreText = this.add.text(WIDTH - 28, 22, '0', { ...TEXT, fontSize: '44px', strokeThickness: 9 }).setOrigin(1, 0);
    const best = loadProgress().best[this.levelIndex];
    const bestText = this.add
      .text(WIDTH - 28, 84, best ? `best ${best.toLocaleString()}` : `★★★ ${this.starAt[1].toLocaleString()}`, {
        ...TEXT,
        fontSize: '20px',
        strokeThickness: 5,
        color: '#ffe27a',
      })
      .setOrigin(1, 0);

    const n = this.level.shots.length;
    this.shotIcons = this.level.shots.map((kind, i) =>
      this.add.image(WIDTH / 2 + (i - (n - 1) / 2) * 34, 70, 'elements', shotFrame(kind)).setScale(0.4),
    );

    const restart = makeButton(this, WIDTH - 52, HEIGHT - 44, 'restart', () => this.restart(), { icon: 'return.png', w: 64, h: 56, size: 34, color: 0x3d7fb8 });
    const menu = makeButton(this, WIDTH - 128, HEIGHT - 44, 'menu', () => this.toMenu(), { icon: 'menuList.png', w: 64, h: 56, size: 30, color: 0x3d7fb8 });
    this.hud = this.add.container(0, 0, [title, this.scoreText, bestText, ...this.shotIcons, ...restart.parts, ...menu.parts]).setDepth(50);

    // Waiting ammo lines up on the ground behind the slingshot.
    this.waiting = this.queue.map((kind, i) =>
      this.add.image(150 - i * 44, GROUND - 21, 'elements', shotFrame(kind)).setScale(0.6).setDepth(8),
    );
  }

  // ---- Flow ------------------------------------------------------------------------------------

  private intro() {
    const banner = this.add.text(WIDTH / 2, 250, `LEVEL ${this.levelIndex + 1}`, { ...TEXT, fontSize: '96px', strokeThickness: 16 }).setOrigin(0.5).setDepth(70);
    const name = this.add.text(WIDTH / 2, 330, this.level.name, { ...TEXT, fontSize: '40px', strokeThickness: 9, color: '#ffe27a' }).setOrigin(0.5).setDepth(70);
    for (const [t, delay] of [[banner, 0], [name, 150]] as const) {
      t.setScale(0);
      this.tweens.chain({
        targets: t,
        tweens: [
          { scale: 1, duration: 350, delay, ease: 'Back.easeOut' },
          { alpha: 0, y: t.y - 40, duration: 300, delay: 900 },
        ],
        onComplete: () => t.destroy(),
      });
    }
    this.voice('level');
    this.time.delayedCall(550, () => this.voice(String(this.levelIndex + 1) as Voice));
    this.time.delayedCall(1300, () => this.loadShot());
  }

  private loadShot() {
    const kind = this.queue.shift();
    if (!kind) return;
    const from = this.waiting.shift()!;
    this.waiting.forEach((w, i) => this.tweens.add({ targets: w, x: 150 - i * 44, duration: 250, ease: 'Sine.easeOut' }));
    const img = this.add.image(ANCHOR.x, ANCHOR.y, 'elements', shotFrame(kind)).setScale(SHOT_SCALE).setDepth(12);
    // Hop from the queue up into the pouch.
    const sx = from.x;
    const sy = from.y;
    from.destroy();
    img.setPosition(sx, sy).setScale(0.6);
    this.tweens.add({
      targets: img,
      x: ANCHOR.x,
      scale: SHOT_SCALE,
      duration: 380,
      ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: img,
      y: { from: sy, to: ANCHOR.y },
      duration: 380,
      ease: (t: number) => t - Math.sin(t * Math.PI) * 0.9,
      onComplete: () => {
        if (this.state === 'over' || this.state === 'finale') return;
        this.state = 'ready';
        if (this.levelIndex === 0 && this.shotsFired === 0) this.showHint();
      },
    });
    playSfx(this, SFX, 'stretch', { volume: 0.25, detune: 600 });
    this.loaded = { kind, img };
    if (kind === 'bomb') this.flashHint('BOMB! tap mid-air to detonate');
  }

  private showHint() {
    this.hint?.destroy();
    this.hint = this.add
      .text(ANCHOR.x + 40, ANCHOR.y - 120, 'drag back\nand let go', { ...TEXT, fontSize: '30px', strokeThickness: 7 })
      .setOrigin(0.5)
      .setDepth(60);
    this.tweens.add({ targets: this.hint, y: this.hint.y - 10, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.easeInOut' });
  }

  private flashHint(message: string) {
    const t = this.add.text(380, ANCHOR.y - 150, message, { ...TEXT, fontSize: '24px', strokeThickness: 6, color: '#ffd23f' }).setOrigin(0.5).setDepth(60);
    this.tweens.add({ targets: t, alpha: 0, delay: 2200, duration: 400, onComplete: () => t.destroy() });
  }

  // ---- Aiming and launching ----------------------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) {
    if (over.length) return;
    if (this.state === 'ready' && this.loaded) {
      // Grab the shot directly, or drag from anywhere: the pull is relative to where you pressed.
      const near = Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, ANCHOR.x, ANCHOR.y) < 70;
      this.dragFrom = near ? { x: ANCHOR.x, y: ANCHOR.y } : { x: pointer.worldX, y: pointer.worldY };
      this.state = 'aiming';
      this.pull.set(0, 0);
      this.hint?.destroy();
      this.hint = undefined;
      this.onPointerMove(pointer);
    } else if (this.state === 'flying' && this.shot && !this.shot.dead && this.shot.type === 'bomb') {
      this.detonate(this.shot);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (this.state !== 'aiming' || !this.dragFrom || !this.loaded) return;
    this.pull.set(pointer.worldX - this.dragFrom.x, pointer.worldY - this.dragFrom.y);
    if (this.pull.length() > MAX_PULL) this.pull.setLength(MAX_PULL);
    // Don't let the pouch go through the ground.
    this.pull.y = Math.min(this.pull.y, GROUND - 20 - ANCHOR.y);
    const x = ANCHOR.x + this.pull.x;
    const y = ANCHOR.y + this.pull.y;
    this.loaded.img.setPosition(x, y).setRotation(this.pull.angle());
    this.drawBands(x, y);
    this.drawTrajectory(x, y, -this.pull.x * POWER, -this.pull.y * POWER);
    const now = this.time.now;
    if (this.pull.length() > 30 && now - this.lastCreak > 450) {
      this.lastCreak = now;
      playSfx(this, SFX, 'stretch', { volume: 0.2 + (0.25 * this.pull.length()) / MAX_PULL, detune: (this.pull.length() / MAX_PULL) * 400 });
    }
  }

  private onPointerUp() {
    if (this.state !== 'aiming' || !this.loaded) return;
    this.aimDots.clear();
    if (this.pull.length() < 20) {
      // Too small a pull: treat it as a cancel and snap back.
      this.state = 'ready';
      this.loaded.img.setPosition(ANCHOR.x, ANCHOR.y).setRotation(0);
      this.drawBands(ANCHOR.x, ANCHOR.y);
      return;
    }
    this.fire(-this.pull.x * POWER, -this.pull.y * POWER);
  }

  /** Launches the loaded shot with a velocity in px per physics step. Public so automated tests can fire exact shots. */
  fire(vx: number, vy: number) {
    if (!this.loaded || (this.state !== 'ready' && this.state !== 'aiming')) return false;
    const { kind, img } = this.loaded;
    this.loaded = undefined;
    const x = img.x === ANCHOR.x && img.y === ANCHOR.y ? ANCHOR.x - vx / POWER : img.x;
    const y = img.x === ANCHOR.x && img.y === ANCHOR.y ? ANCHOR.y - vy / POWER : img.y;
    img.destroy();
    this.hint?.destroy();
    this.hint = undefined;
    const obj = this.matter.add.image(x, y, 'elements', shotFrame(kind), {
      shape: { type: 'circle', radius: 34 },
      density: kind === 'rock' ? 0.008 : 0.005,
      friction: 0.6,
      frictionAir: SHOT_AIR,
      restitution: 0.3,
      label: 'shot',
    });
    obj.setScale(SHOT_SCALE).setDepth(12);
    obj.setVelocity(vx, vy);
    obj.setAngularVelocity(-0.02 * Math.sign(vx || 1));
    const shot: Shot = { kind: 'shot', obj, type: kind, dead: false, landed: false, lastSound: 0 };
    this.register(shot);
    this.shot = shot;
    this.shotsFired++;
    this.shotIcons[this.shotsFired - 1]?.setAlpha(0.25).setTint(0x333333);
    this.state = 'flying';
    this.launchedAt = this.time.now;
    this.calmFor = 0;
    this.trail.forEach((t) => t.destroy());
    this.trail = [];

    // The band snaps back with a twang.
    const band = { x, y };
    this.tweens.add({
      targets: band,
      x: ANCHOR.x,
      y: ANCHOR.y,
      duration: 180,
      ease: 'Elastic.easeOut',
      easeParams: [1.2, 0.4],
      onUpdate: () => this.drawBands(band.x, band.y),
      onComplete: () => this.drawBands(ANCHOR.x, ANCHOR.y),
    });
    this.bandBack.clear();
    playSfx(this, SFX, 'launch', { volume: 0.7 });
    this.cameras.main.shake(80, 0.003);
    return true;
  }

  /** Dotted arc using the same integration as Matter (Verlet with air friction), so it matches the real flight. */
  private drawTrajectory(x: number, y: number, vx: number, vy: number) {
    const g = this.aimDots.clear();
    let px = x;
    let py = y;
    let dots = 0;
    for (let step = 1; step < 160 && dots < 26; step++) {
      vx = vx * (1 - SHOT_AIR);
      vy = vy * (1 - SHOT_AIR) + STEP_GRAVITY;
      px += vx;
      py += vy;
      if (py > GROUND || px > WIDTH + 20) break;
      if (step % 4 === 0) {
        const fade = 1 - dots / 28;
        g.fillStyle(0x1d3b4c, 0.35 * fade).fillCircle(px + 1.5, py + 2, 5.5 - dots * 0.12);
        g.fillStyle(0xffffff, 0.95 * fade).fillCircle(px, py, 5 - dots * 0.12);
        dots++;
      }
    }
  }

  // ---- Collisions and damage -----------------------------------------------------------------------

  private onCollisions(event: Phaser.Physics.Matter.Events.CollisionStartEvent) {
    for (const pair of event.pairs) {
      const a = pair.bodyA.parent;
      const b = pair.bodyB.parent;
      const pa = this.byBody.get(a.id);
      const pb = this.byBody.get(b.id);
      if (!pa && !pb) continue;
      const va = this.matter.body.getVelocity(a);
      const vb = this.matter.body.getVelocity(b);
      const n = pair.collision.normal;
      const speed = Math.abs((va.x - vb.x) * n.x + (va.y - vb.y) * n.y);
      if (speed < 1) continue;
      if (pa) this.impact(pa, a, b, speed);
      if (pb) this.impact(pb, b, a, speed);
    }
  }

  private impact(piece: Piece, body: MatterJS.BodyType, other: MatterJS.BodyType, speed: number) {
    if (piece.dead) return;
    const now = this.time.now;
    const otherPiece = this.byBody.get(other.id);

    if (piece.kind === 'shot') {
      if (!piece.landed) {
        piece.landed = true;
        // Once it has hit something, let it roll to a stop instead of trundling on forever.
        (piece.obj.body as MatterJS.BodyType).frictionAir = 0.012;
        if (!otherPiece) {
          this.dust.explode(6, piece.obj.x, piece.obj.y + SHOT_RADIUS);
          this.sfx('softHit', Math.min(0.8, speed / 12));
        }
        if (speed > 8) this.cameras.main.shake(120, 0.006);
      }
      if (piece.type === 'bomb') this.time.delayedCall(0, () => this.detonate(piece));
      return;
    }

    if (speed > 2.5 && now - piece.lastSound > 120) {
      piece.lastSound = now;
      const volume = Phaser.Math.Clamp(speed / 14, 0.12, 0.8);
      if (piece.kind === 'creature') this.sfx('softHit', volume);
      else this.sfx(hitSound(piece.material), volume);
    }

    if (now < this.graceUntil) return;
    const otherMass = other.isStatic ? Infinity : other.mass;
    const ratio = Phaser.Math.Clamp(otherMass / body.mass, 0.35, 3);
    const dmg = Math.max(0, speed - DAMAGE_FLOOR) * ratio;
    if (dmg > 0) this.damage(piece, dmg);
    if (otherPiece?.kind === 'shot' && !otherPiece.dead) {
      if (speed > 10) this.cameras.main.shake(140, 0.008);
      // A shot that smashes something ploughs on through it instead of bouncing off.
      if (piece.dead) {
        const v = this.matter.body.getVelocity(other);
        const keep = piece.kind === 'creature' ? 0.85 : CARRY_THROUGH[piece.material];
        this.time.delayedCall(0, () => !otherPiece.dead && otherPiece.obj.setVelocity(v.x * keep, v.y * keep));
      }
    }
  }

  private damage(piece: Block | Creature, amount: number) {
    if (piece.dead) return;
    piece.hp -= amount;
    if (piece.kind === 'creature') {
      if (piece.hp <= 0) {
        piece.dead = true;
        this.time.delayedCall(0, () => this.killCreature(piece));
      } else {
        this.startle(piece);
      }
      return;
    }
    const max = MATERIALS[piece.material].hp;
    if (piece.hp <= 0) {
      piece.dead = true;
      this.time.delayedCall(0, () => this.breakBlock(piece));
      return;
    }
    const level = piece.hp < max * 0.35 ? 2 : piece.hp < max * 0.7 ? 1 : 0;
    if (level > piece.damage) {
      piece.damage = level;
      // Same size frame; keep the polygon-centred origin.
      piece.obj.setFrame(frameFor(piece.material, piece.shape, level), false, false);
      this.debris.get(piece.material)?.explode(2, piece.obj.x, piece.obj.y);
    }
  }

  private breakBlock(block: Block) {
    const { x, y } = block.obj;
    block.obj.destroy();
    this.debris.get(block.material)?.explode(block.shape === 'sq' || block.shape === 'ramp' ? 4 : 7, x, y);
    this.dust.explode(3, x, y);
    this.sfx(breakSound(block.material), 0.7);
    this.addScore(MATERIALS[block.material].points, x, y, MATERIALS[block.material].color);
    this.wakeAll();
    if (block.material === 'tnt') this.time.delayedCall(60, () => this.explode(x, y));
  }

  private detonate(shot: Shot) {
    if (shot.dead) return;
    shot.dead = true;
    const { x, y } = shot.obj;
    shot.obj.destroy();
    this.explode(x, y, 1.15);
  }

  /** Explosion Pack flipbook, a radial shove and blast damage that falls off with distance. */
  private explode(x: number, y: number, power = 1) {
    const radius = 170 * power;
    this.add
      .sprite(x, y, 'boom', 'regularExplosion00.png')
      .setScale(1.3 * power)
      .setDepth(30)
      .play('boom')
      .once('animationcomplete', (_a: unknown, _f: unknown, s: Phaser.GameObjects.Sprite) => s.destroy());
    this.dust.explode(10, x, y);
    this.cameras.main.shake(350, 0.014 * power);
    this.cameras.main.flash(120, 255, 240, 200);
    this.sfx('boom', 0.9);
    for (const piece of this.pieces) {
      if (piece.dead) continue;
      const body = piece.obj.body as MatterJS.BodyType;
      const d = Phaser.Math.Distance.Between(x, y, piece.obj.x, piece.obj.y);
      if (d > radius) continue;
      const f = 1 - d / radius;
      piece.obj.setAwake();
      const dir = new Phaser.Math.Vector2(piece.obj.x - x, piece.obj.y - y - 25).normalize();
      const push = 13 * f * Phaser.Math.Clamp(Math.sqrt(5 / body.mass), 0.4, 1.5);
      const v = this.matter.body.getVelocity(body);
      piece.obj.setVelocity(v.x + dir.x * push, v.y + dir.y * push);
      piece.obj.setAngularVelocity(Phaser.Math.FloatBetween(-0.2, 0.2) * f);
      if (piece.kind === 'block') this.damage(piece, 40 * f + 4);
      else if (piece.kind === 'creature') this.damage(piece, 26 * f + 3);
    }
  }

  /**
   * Wakes every piece. Blocks start asleep so towers stand still, and Matter doesn't wake a
   * sleeping body when what it rests on disappears, so after anything breaks the whole level
   * is woken; settled pieces fall asleep again by themselves.
   */
  private wakeAll() {
    for (const p of this.pieces) if (!p.dead) p.obj.setAwake();
  }

  // ---- Creatures ---------------------------------------------------------------------------------------

  private startle(c: Creature) {
    const now = this.time.now;
    if (now < c.scaredUntil - 300) return;
    c.scaredUntil = now + 900;
    c.face.setTint(0xffc4c4);
    this.time.delayedCall(250, () => c.face.active && c.face.clearTint());
    const bang = this.add.text(c.obj.x + 14, c.obj.y - 40, '!', { ...TEXT, fontSize: '34px', strokeThickness: 7, color: '#ff6b6b' }).setOrigin(0.5).setDepth(40);
    this.tweens.add({ targets: bang, y: bang.y - 30, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => bang.destroy() });
    if (now - c.lastSound > 300) {
      c.lastSound = now;
      this.sfx('creature', 0.35);
    }
  }

  private killCreature(c: Creature, offscreen = false) {
    c.dead = true;
    const x = Phaser.Math.Clamp(c.obj.x, 30, WIDTH - 30);
    const y = Phaser.Math.Clamp(c.obj.y, 30, HEIGHT - 30);
    c.obj.destroy();
    if (!offscreen) {
      this.dust.setParticleTint(c.color);
      this.dust.explode(12, x, y);
      this.dust.setParticleTint(0xffffff);
      const ring = this.add.circle(x, y, 20).setStrokeStyle(6, c.color).setDepth(39);
      this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 400, onComplete: () => ring.destroy() });
    }
    this.tweens.add({ targets: c.face, scale: SCALE * 1.5, alpha: 0, duration: 180, onComplete: () => c.face.destroy() });
    this.sfx('pop', 0.9);
    this.sfx('creature', 0.6);
    this.addScore(CREATURE_POINTS, x, y - 20, '#ffffff', true);
    this.wakeAll();

    const left = this.pieces.filter((p) => p.kind === 'creature' && !p.dead).length;
    if (left === 0 && this.state !== 'over' && this.state !== 'finale') this.finale(x, y);
    else this.cameras.main.shake(120, 0.005);
  }

  /** The last alien goes: slow motion and a quick zoom on it, then the results. */
  private finale(x: number, y: number) {
    this.state = 'finale';
    this.aimDots.clear();
    const cam = this.cameras.main;
    const timing = this.matter.world.engine.timing;
    timing.timeScale = 0.25;
    this.tweens.add({ targets: this.hud, alpha: 0, duration: 200 });
    cam.zoomTo(1.35, 350, 'Sine.easeOut');
    cam.pan(x, y, 350, 'Sine.easeOut');
    this.time.delayedCall(1300, () => {
      this.tweens.add({ targets: timing, timeScale: 1, duration: 400 });
      cam.zoomTo(1, 450, 'Sine.easeInOut');
      cam.pan(WIDTH / 2, HEIGHT / 2, 450, 'Sine.easeInOut');
      this.tweens.add({ targets: this.hud, alpha: 1, duration: 300, delay: 300 });
      this.time.delayedCall(900, () => this.win());
    });
  }

  // ---- Scoring and results ------------------------------------------------------------------------------

  private addScore(points: number, x: number, y: number, color: string, big = false) {
    this.score += points;
    this.scoreText.setText(this.score.toLocaleString());
    this.tweens.add({ targets: this.scoreText, scale: { from: 1.25, to: 1 }, duration: 200 });
    const t = this.add
      .text(x, y, `+${points}`, { ...TEXT, fontSize: big ? '40px' : '24px', strokeThickness: big ? 9 : 6, color })
      .setOrigin(0.5)
      .setDepth(45);
    this.tweens.add({ targets: t, y: y - (big ? 80 : 50), alpha: { from: 1, to: 0 }, duration: big ? 1100 : 800, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private resolveShot() {
    if (this.state !== 'flying') return;
    if (this.shot && !this.shot.dead) {
      const spent = this.shot;
      spent.dead = true;
      this.tweens.add({ targets: spent.obj, alpha: 0, duration: 400, onComplete: () => spent.obj.destroy() });
    }
    this.shot = undefined;
    if (this.queue.length) {
      this.state = 'intro';
      this.loadShot();
    } else {
      this.lose();
    }
  }

  private win() {
    this.state = 'over';
    const spare = [...this.waiting, ...(this.loaded ? [this.loaded.img] : [])];
    this.loaded = undefined;
    spare.forEach((img, i) => {
      this.time.delayedCall(250 + i * 380, () => {
        this.tweens.add({ targets: img, scale: 1.2, alpha: 0, y: img.y - 30, duration: 300, onComplete: () => img.destroy() });
        this.addScore(SHOT_BONUS, img.x, img.y - 40, '#ffe27a', true);
        playSfx(this, SFX, 'coin', { volume: 0.6 });
      });
    });
    this.time.delayedCall(450 + spare.length * 380, () => {
      const stars = this.score >= this.starAt[1] ? 3 : this.score >= this.starAt[0] ? 2 : 1;
      const { best, isNew } = recordClear(this.levelIndex, this.score, stars);
      this.voice('you_win');
      this.sound.play('jingle:win', { volume: 0.6 });
      const last = this.levelIndex === LEVELS.length - 1;
      this.showPanel('LEVEL CLEAR!', stars, isNew ? 'NEW BEST!' : `best ${best.toLocaleString()}`, [
        ['Menu', () => this.toMenu(), 0x3d7fb8],
        ['Retry', () => this.restart(), 0xf0a830],
        ...(last ? [] : ([['Next', () => this.goTo(this.levelIndex + 1), 0x3aa55c]] as const)),
      ]);
      if (isNew) this.time.delayedCall(1300, () => this.voice('new_highscore'));
    });
  }

  private lose() {
    this.state = 'over';
    const left = this.pieces.filter((p): p is Creature => p.kind === 'creature' && !p.dead);
    // The survivors gloat.
    left.forEach((c, i) => {
      this.tweens.add({ targets: c.face, y: '-=24', duration: 220, yoyo: true, repeat: 2, delay: i * 90, ease: 'Quad.easeOut' });
    });
    this.voice('you_lose');
    this.sound.play('jingle:lose', { volume: 0.6 });
    this.time.delayedCall(900, () =>
      this.showPanel('LEVEL FAILED', -1, `${left.length} alien${left.length === 1 ? '' : 's'} still smiling`, [
        ['Menu', () => this.toMenu(), 0x3d7fb8],
        ['Retry', () => this.restart(), 0x3aa55c],
      ]),
    );
  }

  /** Results card. `stars` < 0 means a failed level (no stars row). */
  private showPanel(title: string, stars: number, subtitle: string, buttons: readonly (readonly [string, () => void, number])[]) {
    const w = 680;
    const h = 450;
    const x = WIDTH / 2 - w / 2;
    const y = 120;
    const shade = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x10283a, 0.45).setOrigin(0);
    const panel = this.add.graphics();
    panel.fillStyle(0x000000, 0.25).fillRoundedRect(x, y + 10, w, h, 32);
    panel.fillStyle(stars < 0 ? 0x8a4b5c : 0x2f6f8f).fillRoundedRect(x, y, w, h, 32);
    panel.lineStyle(6, 0xffffff, 0.4).strokeRoundedRect(x + 8, y + 8, w - 16, h - 16, 26);
    const heading = this.add.text(WIDTH / 2, y + 66, title, { ...TEXT, fontSize: '54px', strokeThickness: 11 }).setOrigin(0.5);
    const parts: Phaser.GameObjects.GameObject[] = [shade, panel, heading];

    if (stars >= 0) {
      const row = starRow(this, WIDTH / 2, y + 160, stars, 1.5, 110);
      row.forEach((s, i) => {
        const earned = i < stars;
        const scale = s.scale;
        s.setScale(0);
        this.tweens.add({
          targets: s,
          scale,
          duration: 350,
          delay: 400 + i * 350,
          ease: 'Back.easeOut',
          onStart: () => earned && playSfx(this, SFX, 'star', { volume: 0.6, detune: i * 200 }),
        });
      });
      parts.push(...row);
      parts.push(this.add.text(WIDTH / 2, y + 252, this.score.toLocaleString(), { ...TEXT, fontSize: '50px', strokeThickness: 10 }).setOrigin(0.5));
      parts.push(this.add.text(WIDTH / 2, y + 312, subtitle, { ...TEXT, fontSize: '26px', strokeThickness: 6, color: '#ffe27a' }).setOrigin(0.5));
    } else {
      const face = this.add.image(WIDTH / 2, y + 175, 'aliens', 'alienGreen_round.png').setScale(1.2);
      this.tweens.add({ targets: face, angle: { from: -8, to: 8 }, yoyo: true, repeat: -1, duration: 400, ease: 'Sine.easeInOut' });
      parts.push(face);
      parts.push(this.add.text(WIDTH / 2, y + 275, subtitle, { ...TEXT, fontSize: '30px', strokeThickness: 7 }).setOrigin(0.5));
    }

    const gap = 200;
    buttons.forEach(([label, action, color], i) => {
      const bx = WIDTH / 2 + (i - (buttons.length - 1) / 2) * gap;
      parts.push(...makeButton(this, bx, y + h - 62, label, action, { w: 180, h: 72, color, size: 32 }).parts);
    });

    this.overlay = this.add.container(0, 0, parts).setDepth(80).setAlpha(0);
    this.tweens.add({ targets: this.overlay, alpha: 1, duration: 250 });
    heading.setScale(0.4);
    this.tweens.add({ targets: heading, scale: 1, duration: 400, ease: 'Back.easeOut' });
  }

  private restart() {
    this.goTo(this.levelIndex);
  }

  private goTo(level: number) {
    if (this.state === 'finale') return;
    this.scene.restart({ level });
  }

  private toMenu() {
    if (this.state === 'finale') return;
    this.scene.start('title');
  }

  private voice(name: Voice) {
    this.sound.play(`voice:${name}`, { volume: 0.85 });
  }

  /** Plays a sound group, skipping repeats of the same group within a few frames so a collapse doesn't turn into noise. */
  private sfx(name: SfxName, volume: number) {
    const now = this.time.now;
    if (now - (this.sfxAt.get(name) ?? -1000) < 55) return;
    this.sfxAt.set(name, now);
    playSfx(this, SFX, name, { volume });
  }

  // ---- Frame loop -----------------------------------------------------------------------------------

  update(time: number, delta: number) {
    for (const piece of this.pieces) {
      if (piece.dead) continue;
      const { x, y } = piece.obj;
      if (x < -150 || x > WIDTH + 60 || y > HEIGHT + 80) {
        this.dropOut(piece);
        continue;
      }
      if (piece.kind === 'creature') this.animateCreature(piece, time);
    }

    // A dotted trail of the last shot, until it first hits something.
    if (this.state === 'flying' && this.shot && !this.shot.dead && !this.shot.landed && ++this.trailTick % 3 === 0) {
      const dot = this.add.image(this.shot.obj.x, this.shot.obj.y, 'dot').setDepth(9).setAlpha(0.8).setScale(this.trail.length % 2 ? 0.4 : 0.6);
      this.trail.push(dot);
    }

    if (this.state === 'flying') {
      const since = time - this.launchedAt;
      const moving = this.pieces.some((p) => {
        if (p.dead) return false;
        const body = p.obj.body as MatterJS.BodyType;
        return !body.isSleeping && this.matter.body.getSpeed(body) > 0.2;
      });
      this.calmFor = moving || since < 1200 ? 0 : this.calmFor + delta;
      if (this.calmFor > 500 || since > 14000) this.resolveShot();
    }
  }

  private dropOut(piece: Piece) {
    if (piece.kind === 'creature') {
      this.killCreature(piece, true);
    } else if (piece.kind === 'block') {
      piece.dead = true;
      const x = Phaser.Math.Clamp(piece.obj.x, 40, WIDTH - 40);
      piece.obj.destroy();
      this.addScore(MATERIALS[piece.material].points, x, HEIGHT - 120, MATERIALS[piece.material].color);
    } else {
      piece.dead = true;
      piece.obj.destroy();
    }
  }

  private animateCreature(c: Creature, time: number) {
    // Shots flying close make them shiver.
    const shot = this.shot;
    if (shot && !shot.dead && this.state === 'flying' && Phaser.Math.Distance.Between(shot.obj.x, shot.obj.y, c.obj.x, c.obj.y) < 260) {
      c.scaredUntil = Math.max(c.scaredUntil, time + 250);
    }
    const scared = time < c.scaredUntil;
    // A smooth tremble while scared. It's a function of time rather than a random offset each
    // frame, which read as the face glitching away from its body.
    c.tremble = Phaser.Math.Linear(c.tremble, scared ? 1 : 0, 0.15);
    c.face.setPosition(c.obj.x, c.obj.y);
    c.face.setRotation(c.obj.rotation + Math.sin(time / 28) * 0.07 * c.tremble);
    if (time > c.blinkAt && c.face.scale === SCALE) {
      c.blinkAt = time + Phaser.Math.Between(1800, 4500);
      // A squashy blink; while scared they cringe a little harder.
      this.tweens.add({ targets: c.face, scaleY: SCALE * (scared ? 0.7 : 0.82), scaleX: SCALE * 1.08, duration: 90, yoyo: true });
    }
  }
}

function shotFrame(kind: ShotKind) {
  return kind === 'rock' ? 'elementStone001.png' : 'elementExplosive001.png';
}

function hitSound(m: Material): SfxName {
  return ({ glass: 'glassHit', wood: 'woodHit', stone: 'stoneHit', metal: 'metalHit', tnt: 'metalHit' } as const)[m];
}

function breakSound(m: Material): SfxName {
  return ({ glass: 'glassBreak', wood: 'woodBreak', stone: 'stoneBreak', metal: 'metalBreak', tnt: 'metalBreak' } as const)[m];
}
