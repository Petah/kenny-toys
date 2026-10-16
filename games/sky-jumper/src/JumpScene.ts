import * as Phaser from 'phaser';
import { padAtlas } from '@shared/atlas';
import { FONT_BODY, FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { fitCard, makeButton } from '@shared/ui';
import { SFX, SHEET, preloadAssets } from './assets';
import {
  GRAVITY, JUMP_V, SPRING_V, Sky, UNITS_PER_POINT, WIDTH, widthOf,
  type Biome, type EnemyKind, type EnemySpec, type Item, type PlatformSpec,
} from './world';

/** The shortest screen shows this much sky above the bunny's column. */
const MIN_H = 640;
const SPRITE = 0.42;
const MAX_VX = 440;
/** How quickly the bunny reaches the speed it's steered to (per second). */
const STEER = 9;
const STEP = 1 / 240;
const JET_TIME = 2.4;
const JET_V = 1250;
const WING_TIME = 3.6;
const WING_V = 640;
const BUBBLE_TIME = 18;
const CARROT_POINTS = 10;
const GOLD_POINTS = 50;
const STOMP_POINTS = 25;
/** Feet are this far either side of the bunny's middle for landing. */
const FEET = 16;

const DUST: Record<Biome, string[]> = {
  grass: ['particle_green.png', 'particle_brown.png'],
  sand: ['particle_beige.png', 'particle_brown.png'],
  snow: ['particle_blue.png', 'particle_grey.png'],
  cake: ['particle_pink.png', 'particle_brown.png'],
  stone: ['particle_grey.png', 'particle_darkGrey.png'],
  wood: ['particle_brown.png', 'particle_darkBrown.png'],
};

/** Sky colours going up: day, sunset, dusk, night. */
const SKY = [
  { at: 0, top: 0x8fd8fb, bottom: 0xd3f1ff },
  { at: 1100, top: 0x7fbff2, bottom: 0xffe3b8 },
  { at: 1900, top: 0x6a6ec8, bottom: 0xffb08a },
  { at: 2700, top: 0x232a63, bottom: 0x5b4f9a },
  { at: 3600, top: 0x0e1236, bottom: 0x2b2d6a },
];

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#3b6e9c',
  strokeThickness: 8,
  align: 'center',
};

type State = 'title' | 'play' | 'dead' | 'over';

interface Platform {
  spec: PlatformSpec;
  img: Phaser.GameObjects.Image;
  item?: { kind: Item; img: Phaser.GameObjects.Image; dx: number; taken?: boolean };
  /** Broken (crumbling) or puffed away (clouds). */
  gone?: boolean;
  dir: number;
}

interface Enemy {
  spec: EnemySpec;
  img: Phaser.GameObjects.Sprite;
  dir: number;
  t: number;
  dead?: boolean;
  vy: number;
  baseY: number;
}

export class JumpScene extends Phaser.Scene {
  private state: State = 'title';
  private world!: Phaser.GameObjects.Layer;
  private ui!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private sky!: Phaser.GameObjects.Graphics;
  private hills: Phaser.GameObjects.Image[] = [];
  private stars!: Phaser.GameObjects.Graphics;
  private clouds: Phaser.GameObjects.Image[] = [];
  private sides!: Phaser.GameObjects.Graphics;
  private ground: Phaser.GameObjects.Image[] = [];

  /** World units per screen pixel's reciprocal: screen pixels per unit. */
  private u = 1;
  private vw = WIDTH;
  private vh = MIN_H;
  private camTop = 0;

  private gen!: Sky;
  private platforms: Platform[] = [];
  private enemies: Enemy[] = [];

  private bunny!: Phaser.GameObjects.Sprite;
  private ghost!: Phaser.GameObjects.Sprite;
  private gear!: Phaser.GameObjects.Container;
  private jetImg!: Phaser.GameObjects.Image;
  private flame!: Phaser.GameObjects.Image;
  private wingL!: Phaser.GameObjects.Image;
  private wingR!: Phaser.GameObjects.Image;
  private bubble!: Phaser.GameObjects.Image;
  private skin = 1;
  private x = WIDTH / 2;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private acc = 0;
  private jet = 0;
  private wings = 0;
  private shield = 0;
  private spin = 0;
  private squash = 0;

  private maxHeight = 0;
  private bonus = 0;
  private carrots = 0;
  private best = 0;
  private canRestart = false;
  /** How the last go ended, for automated checks. */
  deathCause = '';

  private keys?: Record<'left' | 'right' | 'a' | 'd', Phaser.Input.Keyboard.Key>;
  private mouseX?: number;
  private touchDir = 0;
  private tilt?: number;

  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkle!: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private scoreText!: Phaser.GameObjects.Text;
  private carrotIcon!: Phaser.GameObjects.Image;
  private hudK = 1;
  private carrotText!: Phaser.GameObjects.Text;
  private powerIcon!: Phaser.GameObjects.Image;
  private powerBar!: Phaser.GameObjects.Graphics;
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private overlayTimers: Phaser.Time.TimerEvent[] = [];
  private music?: Phaser.Sound.BaseSound;
  private jetSound?: Phaser.Sound.BaseSound;

  constructor() {
    super('jump');
  }

  preload() {
    preloadAssets(this);
  }

  create() {
    padAtlas(this, `${SHEET}-raw`, SHEET);
    this.anims.create({ key: 'flyMan', frames: ['flyMan_fly.png', 'flyMan_still_fly.png'].map((frame) => ({ key: SHEET, frame })), frameRate: 12, repeat: -1 });
    this.anims.create({ key: 'wingMan', frames: [1, 2, 3, 4, 5, 4, 3, 2].map((n) => ({ key: SHEET, frame: `wingMan${n}.png` })), frameRate: 16, repeat: -1 });
    this.anims.create({ key: 'spikeMan', frames: ['spikeMan_walk1.png', 'spikeMan_walk2.png'].map((frame) => ({ key: SHEET, frame })), frameRate: 6, repeat: -1 });
    this.anims.create({ key: 'spikeBall', frames: ['spikeBall1.png', 'spikeBall_2.png'].map((frame) => ({ key: SHEET, frame })), frameRate: 8, repeat: -1 });

    this.world = this.add.layer();
    this.ui = this.add.layer();
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.ui);
    this.uiCam.ignore(this.world);

    // Sky and stars stay put on screen.
    this.sky = this.add.graphics().setDepth(0).setScrollFactor(0);
    this.stars = this.add.graphics().setDepth(1).setScrollFactor(0);
    this.world.add([this.sky, this.stars]);
    // Rolling hills at the bottom, further ones moving slower.
    [4, 3, 2].forEach((n, i) => {
      const hill = this.add.image(WIDTH / 2, 0, `bg${n}`).setOrigin(0.5, 1).setDepth(2 + (2 - i)).setScrollFactor(1, [0.25, 0.45, 0.7][i]);
      this.hills.push(hill);
      this.world.add(hill);
    });
    for (let i = 0; i < 6; i++) {
      const c = this.add.image(0, 0, SHEET, 'cloud.png').setDepth(5).setAlpha(0.55);
      c.setData('drift', Phaser.Math.FloatBetween(8, 22));
      this.clouds.push(c);
      this.world.add(c);
    }
    this.sides = this.add.graphics().setDepth(90);
    this.world.add(this.sides);

    this.dust = this.add.particles(0, 0, SHEET, {
      frame: DUST.grass,
      speedX: { min: -160, max: 160 },
      speedY: { min: -140, max: -20 },
      gravityY: 500,
      scale: { start: 0.32, end: 0.05 },
      rotate: { min: 0, max: 360 },
      lifespan: 520,
      emitting: false,
    }).setDepth(30);
    this.sparkle = this.add.particles(0, 0, SHEET, {
      frame: 'portal_yellowParticle.png',
      speed: { min: 60, max: 200 },
      scale: { start: 0.9, end: 0 },
      lifespan: 500,
      emitting: false,
    }).setDepth(31);
    this.smoke = this.add.particles(0, 0, SHEET, {
      frame: 'smoke.png',
      speedY: { min: 60, max: 140 },
      speedX: { min: -30, max: 30 },
      scale: { start: 0.35, end: 0.8 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 450,
      emitting: false,
    }).setDepth(19);
    this.world.add([this.dust, this.sparkle, this.smoke]);

    // The bunny, plus a copy drawn at the other side while it wraps round the edge.
    this.bunny = this.add.sprite(0, 0, SHEET, 'bunny1_stand.png').setOrigin(0.5, 1).setScale(SPRITE).setDepth(20);
    this.ghost = this.add.sprite(0, 0, SHEET, 'bunny1_stand.png').setOrigin(0.5, 1).setScale(SPRITE).setDepth(20).setVisible(false);
    this.jetImg = this.add.image(0, -50, SHEET, 'jetpack.png').setScale(SPRITE * 0.8);
    this.flame = this.add.image(0, 8, SHEET, 'flame.png').setOrigin(0.5, 0).setScale(SPRITE);
    this.wingL = this.add.image(-24, -60, SHEET, 'wing_left.png').setOrigin(1, 0.7).setScale(SPRITE * 1.1);
    this.wingR = this.add.image(24, -60, SHEET, 'wing_right.png').setOrigin(0, 0.7).setScale(SPRITE * 1.1);
    this.bubble = this.add.image(0, -42, SHEET, 'bubble.png').setScale(0.5).setAlpha(0.75);
    this.gear = this.add.container(0, 0, [this.jetImg, this.flame, this.wingL, this.wingR]).setDepth(19);
    this.bubble.setDepth(21);
    this.world.add([this.gear, this.bunny, this.ghost, this.bubble]);

    this.scoreText = this.add.text(0, 0, '0', { ...TEXT, fontSize: '44px', strokeThickness: 10 }).setOrigin(0.5, 0);
    this.carrotIcon = this.add.image(0, 0, SHEET, 'carrots.png').setScale(0.6);
    this.carrotText = this.add.text(0, 0, '0', { ...TEXT, fontSize: '28px', strokeThickness: 7 }).setOrigin(1, 0.5);
    this.powerIcon = this.add.image(0, 0, SHEET, 'powerup_jetpack.png').setScale(0.55);
    this.powerBar = this.add.graphics();
    this.ui.add([this.scoreText, this.carrotIcon, this.carrotText, this.powerIcon, this.powerBar]);

    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE,LEFT,RIGHT');
      this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', a: 'A', d: 'D' }) as typeof this.keys;
      for (const key of ['SPACE', 'ENTER']) kb.on(`keydown-${key}`, (e: KeyboardEvent) => !e.repeat && this.confirm());
      kb.on('keydown', () => (this.mouseX = undefined));
    }
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) return;
      this.mouseX = this.cameras.main.getWorldPoint(p.x, p.y).x;
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.touch(p));
    this.input.on('pointerup', () => this.touchUpdate());
    this.input.on('pointerupoutside', () => this.touchUpdate());
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma === null) return;
      // Portrait only: sideways, gamma means something else.
      this.tilt = Math.abs(window.orientation as number) === 90 ? undefined : e.gamma;
    });
    this.scale.on('resize', () => this.layout());

    this.best = load('sky-jumper:best', 0);
    this.layout();
    this.reset(false);
    this.showTitle();
  }

  // ---- Layout ------------------------------------------------------------------------------

  /** Fits the bunny's column across the screen, as tall as the screen allows. */
  private layout() {
    const { width: w, height: h } = this.scale;
    this.u = Math.min(w / WIDTH, h / MIN_H);
    this.vw = w / this.u;
    this.vh = h / this.u;
    this.cameras.main.setSize(w, h).setZoom(this.u).setOrigin(0, 0);
    this.cameras.main.scrollX = -(this.vw - WIDTH) / 2;
    this.uiCam.setSize(w, h);
    if (this.state === 'title') this.camTop = this.startTop;
    for (const hill of this.hills) hill.setScale(Math.max(this.vw * 1.2, 900) / 2048);
    this.drawStars();
    this.layoutGround();
    this.layoutHud();
    this.rebuildOverlay?.();
  }

  private get k() {
    return Math.min(this.scale.width / 560, this.scale.height / 760, 1.4);
  }

  private layoutHud() {
    const { width: w } = this.scale;
    const k = Math.min(1, w / 420) * Math.min(1.2, Math.max(0.8, this.scale.height / 760));
    this.hudK = k;
    // On narrow screens the score drops below the back button.
    const top = w < 560 ? 54 : 10;
    this.scoreText.setPosition(w / 2, top).setScale(k);
    this.carrotIcon.setPosition(w - 26 * k, 30 * k).setScale(0.6 * k);
    this.carrotText.setPosition(w - 50 * k, 30 * k).setScale(k);
    this.powerIcon.setPosition(w / 2 - 50 * k, top + 80 * k).setScale(0.5 * k);
    this.powerBar.setPosition(w / 2 - 20 * k, top + 80 * k).setScale(k);
  }

  private layoutGround() {
    this.ground.forEach((g) => g.destroy());
    this.ground = [];
    // A long grassy island to start from, wider than the screen.
    const left = -(this.vw - WIDTH) / 2 - 40;
    for (let x = left; x < WIDTH + (this.vw - WIDTH) / 2 + 40; x += 380 * SPRITE - 6) {
      const g = this.add.image(x, -4, SHEET, 'ground_grass.png').setOrigin(0, 0).setScale(SPRITE).setDepth(10);
      this.ground.push(g);
    }
    this.world.add(this.ground);
  }

  private drawStars() {
    const g = this.stars.clear();
    const rnd = new Phaser.Math.RandomDataGenerator(['stars']);
    for (let i = 0; i < 90; i++) {
      g.fillStyle(0xffffff, rnd.realInRange(0.4, 1));
      g.fillCircle(rnd.realInRange(0, this.vw), rnd.realInRange(0, this.vh), rnd.realInRange(0.8, 2.2));
    }
  }

  // ---- Run ---------------------------------------------------------------------------------

  /** Clears the sky for a new go; the title screen keeps it empty above the bunny. */
  private reset(fill = true) {
    for (const p of this.platforms) this.dropPlatform(p);
    for (const e of this.enemies) e.img.destroy();
    this.platforms = [];
    this.enemies = [];
    this.gen = new Sky(Math.floor(Math.random() * 1e9), 0);
    this.x = WIDTH / 2;
    this.y = 0;
    this.vx = 0;
    this.vy = -JUMP_V;
    this.jet = this.wings = this.shield = 0;
    this.spin = 0;
    this.camTop = this.startTop;
    this.maxHeight = 0;
    this.bonus = 0;
    this.carrots = 0;
    this.bunny.setAngle(0).setFrame(`bunny${this.skin}_jump.png`);
    if (fill) this.fillSky();
    this.updateHud();
  }

  /** The first view: the starting grass along the bottom of the screen. */
  private get startTop() {
    return -(this.vh - 64);
  }

  private start(skin: number) {
    this.skin = skin;
    this.reset();
    this.state = 'play';
    this.canRestart = false;
    this.setOverlay();
    this.setHudVisible(true);
    playSfx(this, SFX, 'go', { volume: 0.6, detune: 0 });
    this.music ??= this.sound.add('music', { loop: true, volume: 0.3 });
    if (!this.music.isPlaying) this.music.play();
    // iOS asks before giving tilt; ask on this tap.
    const ask = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (ask && this.sys.game.device.input.touch) void ask().catch(() => undefined);
  }

  private confirm() {
    if (this.state === 'title') this.start(this.skin);
    else if (this.state === 'over' && this.canRestart) this.start(this.skin);
  }

  private get score() {
    return Math.floor(this.maxHeight / UNITS_PER_POINT) + this.bonus;
  }

  /** Makes rows of sky until there's a screen's worth above the top of the view. */
  private fillSky() {
    while (this.gen.top > this.camTop - this.vh * 0.5) {
      const row = this.gen.next();
      for (const p of row.platforms) this.addPlatform(p);
      for (const e of row.enemies) this.addEnemy(e);
    }
  }

  private platformFrame(spec: PlatformSpec) {
    if (spec.kind === 'cloud') return 'cloud.png';
    const broken = spec.kind === 'crumble' ? '_broken' : '';
    return spec.size === 'big' ? `ground_${spec.biome}${broken}.png` : `ground_${spec.biome}_small${broken}.png`;
  }

  private addPlatform(spec: PlatformSpec) {
    const w = widthOf(spec);
    const img = this.add.image(spec.x, spec.y - 3, SHEET, this.platformFrame(spec)).setOrigin(0.5, 0).setDepth(10);
    img.setScale(w / img.width);
    if (spec.kind === 'cloud') img.setY(spec.y - 14).setAlpha(0.95);
    const p: Platform = { spec, img, dir: Math.random() < 0.5 ? -1 : 1 };
    if (spec.item) {
      const dx = spec.item === 'spring' ? Phaser.Math.FloatBetween(-w / 2 + 34, w / 2 - 34) : 0;
      const frame = { spring: 'spring.png', carrot: 'carrot.png', gold: 'carrot_gold.png', jetpack: 'jetpack_item.png', wings: 'powerup_wings.png', bubble: 'powerup_bubble.png' }[spec.item];
      const it = this.add.image(spec.x + dx, spec.y, SHEET, frame).setDepth(12);
      if (spec.item === 'spring') it.setOrigin(0.5, 1).setScale(0.36).setY(spec.y + 4);
      else it.setScale(spec.item === 'carrot' || spec.item === 'gold' ? 0.5 : 0.6).setY(spec.y - 42);
      p.item = { kind: spec.item, img: it, dx };
      this.world.add(it);
    }
    this.platforms.push(p);
    this.world.add(img);
  }

  private dropPlatform(p: Platform) {
    p.img.destroy();
    p.item?.img.destroy();
  }

  private addEnemy(spec: EnemySpec) {
    const img = this.add.sprite(spec.x, spec.y, SHEET, `${spec.kind === 'spikeBall' ? 'spikeBall1' : spec.kind === 'flyMan' ? 'flyMan_fly' : spec.kind === 'wingMan' ? 'wingMan1' : 'spikeMan_stand'}.png`);
    img.setScale(SPRITE).setDepth(15).play(spec.kind);
    if (spec.kind === 'spikeMan') img.setOrigin(0.5, 1);
    this.enemies.push({ spec, img, dir: Math.random() < 0.5 ? -1 : 1, t: Math.random() * 10, vy: 0, baseY: spec.y });
    this.world.add(img);
  }

  // ---- Input -------------------------------------------------------------------------------

  private touch(p: Phaser.Input.Pointer) {
    if (this.state !== 'play') return;
    if (p.wasTouch) this.touchUpdate();
  }

  /** Holding the left or right of the screen steers that way; the newest finger wins. */
  private touchUpdate() {
    const ps = this.input.manager.pointers.filter((p) => p.isDown && p.wasTouch);
    if (!ps.length) {
      this.touchDir = 0;
      return;
    }
    const p = ps.reduce((a, b) => (b.downTime > a.downTime ? b : a));
    this.touchDir = p.x < this.scale.width / 2 ? -1 : 1;
  }

  /** The speed the player wants, from keys, the mouse, a finger or tilt. */
  private wantedVx() {
    const k = this.keys;
    const key = (k?.left.isDown || k?.a.isDown ? -1 : 0) + (k?.right.isDown || k?.d.isDown ? 1 : 0);
    if (key) return key * MAX_VX;
    if (this.touchDir) return this.touchDir * MAX_VX;
    if (this.tilt !== undefined && this.sys.game.device.input.touch) return Phaser.Math.Clamp(this.tilt / 22, -1, 1) * MAX_VX;
    if (this.mouseX !== undefined) {
      // Head for the pointer the short way, without wrapping round.
      const dx = this.mouseX - this.x;
      return Phaser.Math.Clamp(dx * 7, -MAX_VX, MAX_VX);
    }
    return 0;
  }

  // ---- Simulation --------------------------------------------------------------------------

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 20);
    if (this.state === 'title') this.titleBounce(dt);
    if (this.state === 'play' || this.state === 'dead') {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.tick(STEP);
      }
    }
    this.updateWorld(dt);
    this.draw(dt);
  }

  /** On the title screen the bunny hops on the grass by itself. */
  private titleBounce(dt: number) {
    this.vy += GRAVITY * dt;
    this.y += this.vy * dt;
    if (this.y >= 0) {
      this.y = 0;
      this.vy = -JUMP_V * 0.6;
      this.squash = 1;
    }
    this.x = WIDTH / 2 + Math.sin(this.time.now / 900) * 60;
  }

  /** One fixed step of the bunny's flight. */
  tick(dt: number) {
    const alive = this.state === 'play';
    if (alive) {
      const want = this.wantedVx();
      this.vx += (want - this.vx) * Math.min(1, STEER * dt);
    }
    const prevFeet = this.y;
    if (this.jet > 0) {
      this.jet -= dt;
      this.vy = -JET_V * Math.min(1, this.jet / 0.4 + 0.2);
    } else if (this.wings > 0) {
      this.wings -= dt;
      this.vy = -WING_V * Math.min(1, this.wings / 0.5 + 0.2);
    } else {
      this.vy += GRAVITY * dt;
    }
    if (this.shield > 0) this.shield -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (alive) this.x = ((this.x % WIDTH) + WIDTH) % WIDTH;

    if (alive && this.vy > 0) {
      // The ground at the start.
      if (this.y >= 0 && prevFeet <= 0.5) this.bounce(0, JUMP_V, 'grass');
      for (const p of this.platforms) {
        if (p.gone) continue;
        const top = p.spec.y;
        if (prevFeet > top + 1 || this.y < top) continue;
        const half = widthOf(p.spec) / 2;
        const dx = this.wrapDx(p.img.x);
        if (Math.abs(dx) > half + FEET) continue;
        this.land(p);
        break;
      }
    }
    if (alive) {
      this.maxHeight = Math.max(this.maxHeight, -this.y);
      this.hitThings();
      // Fell out of the bottom of the view.
      if (this.y > this.camTop + this.vh + 30) this.die(false);
    }
  }

  /** How far a world x is from the bunny, the short way round the wrap. */
  private wrapDx(x: number) {
    let dx = x - this.x;
    if (dx > WIDTH / 2) dx -= WIDTH;
    if (dx < -WIDTH / 2) dx += WIDTH;
    return dx;
  }

  private land(p: Platform) {
    const spec = p.spec;
    if (spec.kind === 'crumble') {
      this.crumble(p);
      return;
    }
    const spring = p.item?.kind === 'spring' && Math.abs(this.wrapDx(p.item.img.x)) < 34;
    this.bounce(spec.y, spring ? SPRING_V : JUMP_V, spec.biome);
    if (spring && p.item) {
      p.item.img.setFrame('spring_out.png');
      this.time.delayedCall(260, () => p.item?.img.active && p.item.img.setFrame('spring.png'));
      playSfx(this, SFX, 'spring', { volume: 0.5, detune: 0 });
      this.spin = 1;
    }
    // Islands bob down a little under the bunny's weight.
    this.tweens.add({ targets: p.img, y: p.img.y + 7, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
    if (spec.kind === 'cloud') {
      p.gone = true;
      this.smoke.explode(8, p.img.x, spec.y);
      playSfx(this, SFX, 'poof', { volume: 0.5 });
      this.tweens.add({ targets: p.img, alpha: 0, scale: p.img.scale * 1.3, duration: 260, onComplete: () => p.img.setVisible(false) });
    }
  }

  private bounce(top: number, v: number, biome: Biome) {
    this.y = top;
    this.vy = -v;
    this.squash = 1;
    this.dust.setConfig({ ...this.dustConfig(), frame: DUST[biome] });
    this.dust.explode(v > JUMP_V ? 10 : 6, this.x, top);
    if (v <= JUMP_V) playSfx(this, SFX, 'jump', { volume: 0.32 });
  }

  private dustConfig(): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
    return {
      speedX: { min: -160, max: 160 },
      speedY: { min: -140, max: -20 },
      gravityY: 500,
      scale: { start: 0.32, end: 0.05 },
      rotate: { min: 0, max: 360 },
      lifespan: 520,
      emitting: false,
    };
  }

  /** A cracked island breaks in two and falls; the bunny drops straight through. */
  private crumble(p: Platform) {
    p.gone = true;
    playSfx(this, SFX, 'crack', { volume: 0.55 });
    const img = p.img;
    const halfW = img.width / 2;
    for (const side of [-1, 1]) {
      const piece = this.add.image(img.x, img.y, SHEET, img.frame.name).setOrigin(0.5, 0).setScale(img.scale).setDepth(9);
      piece.setCrop(side < 0 ? 0 : halfW, 0, halfW, img.height);
      this.world.add(piece);
      this.tweens.add({ targets: piece, y: piece.y + 500, x: piece.x + side * 40, angle: side * 35, alpha: 0, duration: 900, ease: 'Quad.easeIn', onComplete: () => piece.destroy() });
    }
    img.setVisible(false);
    this.dust.setConfig({ ...this.dustConfig(), frame: DUST[p.spec.biome] });
    this.dust.explode(8, img.x, p.spec.y);
  }

  /** Carrots, power-ups and critters touching the bunny. */
  private hitThings() {
    const cy = this.y - 40;
    for (const p of this.platforms) {
      const it = p.item;
      if (!it || it.taken || it.kind === 'spring') continue;
      const dx = this.wrapDx(it.img.x);
      if (dx * dx + (it.img.y - cy) ** 2 > 46 * 46) continue;
      it.taken = true;
      this.collect(it.kind, it.img);
    }
    for (const e of this.enemies) {
      if (e.dead) continue;
      const r = e.spec.kind === 'spikeBall' ? 34 : 30;
      const ey = e.spec.kind === 'spikeMan' ? e.img.y - 34 : e.img.y;
      const dx = this.wrapDx(e.img.x);
      if (dx * dx + (ey - cy) ** 2 > (r + 18) ** 2) continue;
      const stompable = e.spec.kind === 'flyMan' || e.spec.kind === 'wingMan';
      if (this.jet > 0 || this.wings > 0) {
        this.knockOut(e);
      } else if (stompable && this.vy > 0 && this.y < ey + 6) {
        this.knockOut(e);
        this.vy = -JUMP_V;
        this.squash = 1;
        this.addBonus(STOMP_POINTS, e.img.x, e.img.y);
        playSfx(this, SFX, 'stomp', { volume: 0.5 });
      } else if (this.shield > 0) {
        this.shield = 0;
        this.knockOut(e);
        playSfx(this, SFX, 'pop', { volume: 0.6 });
        this.sparkle.explode(14, this.x, cy);
        this.vy = Math.min(this.vy, -JUMP_V * 0.7);
      } else {
        this.die(true);
        return;
      }
    }
  }

  private knockOut(e: Enemy) {
    e.dead = true;
    e.vy = -380;
    e.img.stop();
    if (e.spec.kind === 'flyMan') e.img.setFrame('flyMan_jump.png');
    this.cameras.main.shake(120, 0.004);
  }

  private collect(kind: Item, img: Phaser.GameObjects.Image) {
    this.sparkle.explode(10, img.x, img.y);
    this.tweens.add({ targets: img, scale: img.scale * 1.6, alpha: 0, y: img.y - 30, duration: 240, onComplete: () => img.setVisible(false) });
    if (kind === 'carrot' || kind === 'gold') {
      this.carrots++;
      this.addBonus(kind === 'gold' ? GOLD_POINTS : CARROT_POINTS, img.x, img.y);
      playSfx(this, SFX, 'carrot', { volume: 0.4 });
      // Pulse from its resting size, so quick pickups don't compound.
      const rest = 0.6 * this.hudK;
      this.tweens.killTweensOf(this.carrotIcon);
      this.tweens.add({ targets: this.carrotIcon, scale: { from: rest * 1.4, to: rest }, duration: 200 });
      return;
    }
    playSfx(this, SFX, 'power', { volume: 0.5, detune: 0 });
    if (kind === 'jetpack') {
      this.jet = JET_TIME;
      this.wings = 0;
      this.jetSound?.stop();
      this.jetSound = this.sound.add('sfx:jet:0', { loop: true, volume: 0.35 });
      this.jetSound.play();
    } else if (kind === 'wings') {
      this.wings = WING_TIME;
      this.jet = 0;
    } else if (kind === 'bubble') {
      this.shield = BUBBLE_TIME;
      playSfx(this, SFX, 'shield', { volume: 0.4 });
    }
  }

  private addBonus(points: number, x: number, y: number) {
    this.bonus += points;
    const t = this.add.text(x, y - 20, `+${points}`, { ...TEXT, fontSize: '26px', strokeThickness: 6, color: '#ffe066', stroke: '#8a4b12' }).setOrigin(0.5).setDepth(40);
    this.world.add(t);
    this.tweens.add({ targets: t, y: y - 80, alpha: { from: 1, to: 0 }, duration: 800, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }

  private die(hit: boolean) {
    if (this.state !== 'play') return;
    this.deathCause = hit ? 'hit' : 'fell';
    this.state = 'dead';
    this.jet = this.wings = this.shield = 0;
    this.jetSound?.stop();
    this.bunny.setFrame(`bunny${this.skin}_hurt.png`);
    if (hit) {
      this.vy = -520;
      this.vx *= 0.3;
      this.cameras.main.shake(220, 0.012);
      playSfx(this, SFX, 'hurt', { volume: 0.6 });
    } else {
      playSfx(this, SFX, 'fall', { volume: 0.5 });
    }
    this.time.delayedCall(hit ? 1300 : 700, () => this.state === 'dead' && this.gameOver());
  }

  // ---- World upkeep ------------------------------------------------------------------------

  private updateWorld(dt: number) {
    const t = this.time.now / 1000;
    for (const p of this.platforms) {
      const s = p.spec;
      if (s.kind === 'moving' && !p.gone && s.minX !== undefined && s.maxX !== undefined) {
        p.img.x += p.dir * (s.speed ?? 60) * dt;
        if (p.img.x < s.minX) p.dir = 1;
        if (p.img.x > s.maxX) p.dir = -1;
      }
      const it = p.item;
      if (it && !it.taken) {
        it.img.x = p.img.x + it.dx;
        if (it.kind !== 'spring') it.img.y = s.y - 44 + Math.sin(t * 3 + s.x) * 5;
      }
    }
    for (const e of this.enemies) {
      e.t += dt;
      const img = e.img;
      if (e.dead) {
        e.vy += GRAVITY * dt;
        img.y += e.vy * dt;
        img.angle += 360 * dt;
        continue;
      }
      if (e.spec.kind === 'spikeBall') {
        img.angle += 90 * dt;
        img.y = e.baseY + Math.sin(e.t * 1.6) * 10;
      } else if (e.spec.kind === 'spikeMan') {
        img.x += e.dir * 50 * dt;
        if (img.x < e.spec.minX) e.dir = 1;
        if (img.x > e.spec.maxX) e.dir = -1;
        img.setFlipX(e.dir > 0);
      } else {
        const speed = e.spec.kind === 'wingMan' ? 95 : 45;
        img.x += e.dir * speed * dt;
        if (img.x < e.spec.minX) e.dir = 1;
        if (img.x > e.spec.maxX) e.dir = -1;
        img.y = e.baseY + Math.sin(e.t * (e.spec.kind === 'wingMan' ? 3 : 2)) * (e.spec.kind === 'wingMan' ? 24 : 12);
        img.setFlipX(e.dir > 0);
      }
    }

    if (this.state === 'play') {
      // The view only ever rises, keeping the bunny below the middle.
      this.camTop = Math.min(this.camTop, this.y - this.vh * 0.55);
      this.fillSky();
    }
    // Forget what's fallen out of view below.
    const bottom = this.camTop + this.vh + 220;
    this.platforms = this.platforms.filter((p) => {
      if (p.spec.y < bottom) return true;
      this.dropPlatform(p);
      return false;
    });
    this.enemies = this.enemies.filter((e) => {
      if (e.img.y < bottom + 200) return true;
      e.img.destroy();
      return false;
    });
  }

  // ---- Drawing -----------------------------------------------------------------------------

  private skyColours(points: number) {
    let i = 0;
    while (i < SKY.length - 2 && points > SKY[i + 1].at) i++;
    const a = SKY[i];
    const b = SKY[i + 1];
    const k = Phaser.Math.Clamp((points - a.at) / (b.at - a.at), 0, 1);
    const mix = (c1: number, c2: number) => {
      const x = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(c1), Phaser.Display.Color.ValueToColor(c2), 100, k * 100);
      return Phaser.Display.Color.GetColor(x.r, x.g, x.b);
    };
    return { top: mix(a.top, b.top), bottom: mix(a.bottom, b.bottom), night: Phaser.Math.Clamp((points - 2300) / 900, 0, 1) };
  }

  private draw(dt: number) {
    const cam = this.cameras.main;
    cam.scrollY = this.camTop;
    const left = cam.scrollX;
    const points = -this.camTop / UNITS_PER_POINT;
    const sky = this.skyColours(points);
    this.sky.clear().fillGradientStyle(sky.top, sky.top, sky.bottom, sky.bottom, 1).fillRect(-4, -4, this.vw + 8, this.vh + 8);
    this.stars.setAlpha(sky.night);
    // Hills sit behind the starting ground, then sink away slower than it as the view rises.
    const start = this.startTop;
    // The art fills the lower half of each square image; sink it so only the tops show above the grass.
    for (const hill of this.hills) hill.setY(70 + hill.displayHeight * 0.32 - start * (1 - hill.scrollFactorY));

    // Clouds drift across, coming round again higher up once they're below the view.
    for (const c of this.clouds) {
      c.x += c.getData('drift') * dt;
      if (c.x > WIDTH + 220) c.x = -220;
      if (c.y > this.camTop + this.vh + 100 || c.y === 0) {
        c.y = this.camTop - Phaser.Math.Between(40, 600);
        c.x = Phaser.Math.Between(-200, WIDTH + 200);
        c.setScale(Phaser.Math.FloatBetween(0.4, 0.8));
      }
      c.setAlpha(0.55 * (1 - sky.night * 0.6));
    }

    // Shade either side of the column on wide screens, so its wrap-round edges show.
    this.sides.clear();
    if (this.vw > WIDTH + 2) {
      this.sides.fillStyle(0x1d3b5c, 0.28);
      this.sides.fillRect(left, this.camTop, -left, this.vh);
      this.sides.fillRect(WIDTH, this.camTop, -left, this.vh);
      this.sides.fillStyle(0xffffff, 0.5);
      this.sides.fillRect(-2, this.camTop, 2, this.vh);
      this.sides.fillRect(WIDTH, this.camTop, 2, this.vh);
    }

    // The bunny: frame for rising or falling, leaning into its steering, squashing on bounces.
    const b = this.bunny;
    if (this.state === 'play' || this.state === 'title') {
      const frame = this.vy < -150 || this.jet > 0 || this.wings > 0 ? 'jump' : this.squash > 0.6 ? 'ready' : 'stand';
      b.setFrame(`bunny${this.skin}_${frame}.png`);
      if (Math.abs(this.vx) > 30) b.setFlipX(this.vx < 0);
    }
    this.squash = Math.max(0, this.squash - dt * 5);
    const sq = Math.sin(this.squash * Math.PI) * 0.18;
    b.setScale(SPRITE * (1 + sq), SPRITE * (1 - sq));
    this.spin = Math.max(0, this.spin - dt * 1.5);
    // Springs flip it head over heels; when hurt it tumbles.
    if (this.state === 'dead') b.setAngle(b.angle + 400 * dt);
    else if (this.spin > 0) b.setAngle((1 - this.spin) * 360 * (b.flipX ? -1 : 1));
    else b.setAngle((this.vx / MAX_VX) * 10);
    b.setPosition(this.x, this.y);
    // Near an edge, draw it again on the other side.
    const edge = 40;
    const wrap = this.x < edge ? WIDTH : this.x > WIDTH - edge ? -WIDTH : 0;
    this.ghost.setVisible(wrap !== 0 && this.state !== 'dead').setPosition(this.x + wrap, this.y).setFrame(b.frame.name).setFlipX(b.flipX).setScale(b.scaleX, b.scaleY).setAngle(b.angle);

    this.gear.setPosition(this.x, this.y).setAngle(b.angle);
    this.jetImg.setVisible(this.jet > 0).setX(b.flipX ? 16 : -16);
    this.flame.setVisible(this.jet > 0).setX(b.flipX ? 16 : -16).setScale(SPRITE * (0.8 + Math.random() * 0.4));
    if (this.jet > 0 && Math.random() < 0.6) this.smoke.emitParticleAt(this.x + (b.flipX ? 16 : -16), this.y + 20);
    const flap = Math.sin(this.time.now / 45);
    this.wingL.setVisible(this.wings > 0).setAngle(-20 + flap * 30);
    this.wingR.setVisible(this.wings > 0).setAngle(20 - flap * 30);
    if (this.wings > 0 && flap > 0.97) playSfx(this, SFX, 'flap', { volume: 0.12 });
    this.bubble.setVisible(this.shield > 0).setPosition(this.x, this.y - 40).setScale(0.48 + Math.sin(this.time.now / 160) * 0.02);
    if (this.shield > 0 && this.shield < 3) this.bubble.setAlpha(Math.sin(this.time.now / 70) > 0 ? 0.75 : 0.3);
    else this.bubble.setAlpha(0.75);
    if (this.jet <= 0 && this.jetSound?.isPlaying) this.jetSound.stop();

    this.updateHud();
  }

  private updateHud() {
    this.scoreText.setText(String(this.score));
    this.carrotText.setText(String(this.carrots));
    const power = this.jet > 0 ? { icon: 'powerup_jetpack.png', left: this.jet / JET_TIME } : this.wings > 0 ? { icon: 'powerup_wings.png', left: this.wings / WING_TIME } : this.shield > 0 ? { icon: 'powerup_bubble.png', left: this.shield / BUBBLE_TIME } : undefined;
    const show = !!power && this.state === 'play';
    this.powerIcon.setVisible(show);
    this.powerBar.clear().setVisible(show);
    if (power) {
      this.powerIcon.setFrame(power.icon);
      this.powerBar.fillStyle(0x1d3b5c, 0.5).fillRoundedRect(0, -8, 80, 16, 8);
      this.powerBar.fillStyle(0xffe066, 1).fillRoundedRect(2, -6, Math.max(6, 76 * Math.min(1, power.left)), 12, 6);
    }
  }

  private setHudVisible(on: boolean) {
    for (const o of [this.scoreText, this.carrotIcon, this.carrotText]) o.setVisible(on);
  }

  // ---- Overlays ----------------------------------------------------------------------------

  private setOverlay(build?: () => Phaser.GameObjects.GameObject[]) {
    this.rebuildOverlay = build && (() => this.setOverlay(build));
    this.overlayTimers.forEach((t) => t.remove());
    this.overlayTimers = [];
    this.overlay?.destroy();
    this.overlay = undefined;
    if (!build) return;
    this.overlay = this.add.container(0, 0, build());
    this.ui.add(this.overlay);
  }

  private button(x: number, y: number, label: string, onClick: () => void, w = 220) {
    return makeButton(this, x, y, label, onClick, { textStyle: TEXT, color: 0xf08a24, w, onPress: () => playSfx(this, SFX, 'click') }).parts;
  }

  private showTitle() {
    this.state = 'title';
    this.setHudVisible(false);
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.36);
      const title = this.add.text(0, -120, 'SKY JUMPER', { ...TEXT, fontSize: '74px', strokeThickness: 14 }).setOrigin(0.5);
      this.tweens.add({ targets: title, y: -128, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const touch = this.sys.game.device.input.touch && matchMedia('(pointer: coarse)').matches;
      const how = this.add.text(0, -40, touch ? 'tilt, or hold left and right to steer' : 'steer with the mouse or arrow keys', { ...TEXT, fontFamily: FONT_BODY, fontSize: '22px', strokeThickness: 6 }).setOrigin(0.5);
      const pick = this.add.text(0, 20, 'pick a bunny', { ...TEXT, fontFamily: FONT_BODY, fontSize: '20px', color: '#ffe066', strokeThickness: 6 }).setOrigin(0.5);
      const parts: Phaser.GameObjects.GameObject[] = [title, how, pick];
      for (const skin of [1, 2]) {
        const bx = (skin === 1 ? -1 : 1) * 80;
        parts.push(...this.button(bx, 130, '', () => this.start(skin), 130).map((p) => p));
        const img = this.add.image(bx, 128, SHEET, `bunny${skin}_stand.png`).setScale(0.38);
        this.tweens.add({ targets: img, y: 118, duration: 500 + skin * 80, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        parts.push(img);
      }
      if (this.best) parts.push(this.add.text(0, 220, `best ${this.best}`, { ...TEXT, fontSize: '26px', color: '#ffe066', strokeThickness: 7 }).setOrigin(0.5));
      card.add(parts);
      fitCard(card, this.k, w, 560, title);
      return [card];
    });
  }

  private gameOver() {
    this.state = 'over';
    this.setHudVisible(false);
    const { best, isNew } = submitHighScore('sky-jumper', this.score);
    this.best = best;
    playSfx(this, SFX, 'over', { volume: 0.5, detune: 0 });
    this.time.delayedCall(400, () => playSfx(this, SFX, isNew && this.score > 0 ? 'voiceBest' : 'voiceOver', { volume: 0.6, detune: 0 }));
    this.showGameOver(isNew && this.score > 0, true);
  }

  private showGameOver(record: boolean, animate: boolean) {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.42);
      const title = this.add.text(0, -170, 'GAME OVER', { ...TEXT, fontSize: '62px', strokeThickness: 12 }).setOrigin(0.5);
      const panel = this.add.graphics();
      panel.fillStyle(0x1d3b5c, 0.35).fillRoundedRect(-190, -102, 380, 200, 26);
      panel.fillStyle(0xfff7e8, 1).fillRoundedRect(-190, -110, 380, 200, 26);
      panel.lineStyle(5, 0xf08a24, 1).strokeRoundedRect(-190, -110, 380, 200, 26);
      const label = { ...TEXT, fontSize: '22px', color: '#c46a12', strokeThickness: 0 };
      const big = { ...TEXT, color: '#3b6e9c', strokeThickness: 0 };
      const score = this.add.text(0, -30, animate ? '0' : String(this.score), { ...big, fontSize: '64px' }).setOrigin(0.5);
      const parts: Phaser.GameObjects.GameObject[] = [
        title, panel,
        this.add.text(0, -86, 'SCORE', label).setOrigin(0.5), score,
        this.add.text(-90, 20, 'BEST', label).setOrigin(0.5),
        this.add.text(-90, 54, String(this.best), { ...big, fontSize: '32px' }).setOrigin(0.5),
        this.add.text(90, 20, 'CARROTS', label).setOrigin(0.5),
        this.add.text(90, 54, String(this.carrots), { ...big, fontSize: '32px' }).setOrigin(0.5),
      ];
      const tag = record ? this.add.text(150, -96, 'NEW!', { ...TEXT, fontSize: '26px', color: '#e8473a', stroke: '#ffffff', strokeThickness: 6 }).setOrigin(0.5).setAngle(14) : undefined;
      if (tag) parts.push(tag);
      const play = this.button(0, 160, 'AGAIN', () => this.start(this.skin));
      parts.push(...play);
      card.add(parts);
      fitCard(card, this.k, w, 440, title);
      if (!animate) {
        this.canRestart = true;
        return [card];
      }
      const visible = (on: boolean) => play.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(on));
      visible(false);
      tag?.setVisible(false);
      this.tweens.add({ targets: title, y: { from: -360, to: -170 }, duration: 450, ease: 'Back.easeOut' });
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        this.overlayTimers.push(this.time.delayedCall(450 + i * 40, () => {
          score.setText(String(Math.round((this.score * i) / steps)));
          playSfx(this, SFX, 'tick', { volume: 0.25 });
        }));
      }
      this.overlayTimers.push(this.time.delayedCall(450 + steps * 40 + 250, () => {
        if (tag) {
          tag.setVisible(true);
          this.tweens.add({ targets: tag, scale: { from: 0, to: 1 }, duration: 300, ease: 'Back.easeOut' });
          playSfx(this, SFX, 'record', { volume: 0.5, detune: 0 });
        }
        visible(true);
        this.canRestart = true;
        this.rebuildOverlay = () => this.showGameOver(record, false);
      }));
      return [card];
    });
  }
}

export type { EnemyKind };
