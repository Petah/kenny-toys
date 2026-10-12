import * as Phaser from 'phaser';
import { FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { PLANES, ROCK_H, ROCK_SHAPE, ROCK_W, SFX, THEMES, groundProfile, preloadAssets, unpackAtlas, STRIP_PAD, type PlaneColour, type Theme, type Voice } from './assets';
import { SpriteNumber } from './SpriteNumber';

/** The world is 480 units tall at its shortest (the pack's background height) and at least 320 wide. */
const BASE_H = 480;
const MIN_W = 320;
const GROUND_H = 71;
const GROUND_W = 808;
/** Scenery overhangs the screen edges by this much so camera shake never shows past the world. */
const BLEED = 40;

const SPEED = 160;
const GRAVITY = 1600;
const FLAP_VY = -430;
const MAX_FALL = 650;
const PLANE_SCALE = 0.6;
/** Hit circle radius: a touch smaller than the fuselage so grazes feel fair. */
const PLANE_R = 16;
const ROCK_SPACING = 270;
const GAP_START = 165;
const GAP_MIN = 118;
const GAP_SHRINK = 1.5;
const MEDALS = [
  { at: 30, name: 'gold', frame: 'medalGold.png', star: 'starGold.png' },
  { at: 20, name: 'silver', frame: 'medalSilver.png', star: 'starSilver.png' },
  { at: 10, name: 'bronze', frame: 'medalBronze.png', star: 'starBronze.png' },
] as const;

const FAR_TINT = 0xdcebf5;
const FAR_ALPHA = 0.5;
const FAR_STRETCH = 1.35;

type State = 'ready' | 'playing' | 'dead' | 'over';

interface RockPair {
  x: number;
  top: Phaser.GameObjects.Image;
  bottom: Phaser.GameObjects.Image;
  /** Outlines relative to `x`, in world units. */
  topPoly: [number, number][];
  bottomPoly: [number, number][];
  centre: number;
  scored: boolean;
}

const LABEL: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  fontSize: '26px',
  color: '#c0803c',
  align: 'center',
};

const HINT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#3d7fb5',
  strokeThickness: 8,
  align: 'center',
};

export class PlaneScene extends Phaser.Scene {
  private state: State = 'ready';
  private theme: Theme = THEMES[0];
  private colour: PlaneColour = 'Red';
  private profiles = new Map<string, Uint8Array>();

  private world!: Phaser.GameObjects.Layer;
  private ui!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private sky!: Phaser.GameObjects.TileSprite;
  private farGround!: Phaser.GameObjects.TileSprite;
  private ground!: Phaser.GameObjects.TileSprite;
  /** Solid fill under the ground strip, so it reaches below the screen during shakes. */
  private groundFill!: Phaser.GameObjects.Rectangle;
  private plane!: Phaser.GameObjects.Sprite;
  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puffs!: Phaser.GameObjects.Particles.ParticleEmitter;
  private scoreText!: SpriteNumber;
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  /** Timers that animate the current overlay; cancelled when it's replaced. */
  private overlayTimers: Phaser.Time.TimerEvent[] = [];
  private music?: Phaser.Sound.BaseSound;

  /** World size in units, and screen pixels per unit. */
  private vw = 0;
  private vh = 0;
  private u = 1;
  /** How much the rocks are stretched to span the sky. */
  private rockScale = 1;
  private rocks: RockPair[] = [];
  private vy = 0;
  private score = 0;
  private best = 0;
  private grounded = false;
  private canRestart = false;
  private lastTheme = -1;

  constructor() {
    super('tappy');
  }

  preload() {
    preloadAssets(this);
  }

  // ---- Setup -------------------------------------------------------------------------------

  create() {
    unpackAtlas(this, 'sheet');
    for (const t of THEMES) this.profiles.set(t.ground, groundProfile(this, t.ground));
    for (const c of PLANES) {
      this.anims.create({
        key: `fly${c}`,
        frames: [1, 2, 3, 2].map((n) => ({ key: `plane${c}${n}.png` })),
        frameRate: 24,
        repeat: -1,
      });
    }

    // Two layers: the world is drawn by a zoomed camera, the UI by an unzoomed one so text stays crisp.
    this.world = this.add.layer();
    this.ui = this.add.layer();
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.ui);
    this.uiCam.ignore(this.world);

    this.sky = this.add.tileSprite(0, 0, 800, BASE_H, 'background.png').setOrigin(0).setDepth(0);
    this.farGround = this.add.tileSprite(0, 0, 800, GROUND_H, 'groundRock.png').setOrigin(0).setDepth(1).setTint(FAR_TINT).setAlpha(FAR_ALPHA);
    this.ground = this.add.tileSprite(0, 0, 800, GROUND_H, 'groundGrass.png').setOrigin(0).setDepth(3);
    this.farGround.tilePositionX = 300;
    this.groundFill = this.add.rectangle(0, 0, 10, 10, 0).setOrigin(0).setDepth(3);

    this.trail = this.add.particles(0, 0, 'puffSmall.png', {
      frequency: 70,
      speedX: { min: -SPEED - 40, max: -SPEED },
      speedY: { min: -15, max: 15 },
      scale: { start: 0.3, end: 0.7 },
      alpha: { start: 0.65, end: 0 },
      lifespan: 420,
    });
    this.puffs = this.add.particles(0, 0, 'puffLarge.png', {
      speedX: { min: -SPEED - 100, max: -SPEED + 20 },
      speedY: { min: 30, max: 140 },
      scale: { start: 0.35, end: 1.05 },
      alpha: { start: 0.95, end: 0 },
      rotate: { min: -30, max: 30 },
      lifespan: 520,
      emitting: false,
    });
    this.trail.setDepth(4);
    this.puffs.setDepth(4);
    this.plane = this.add.sprite(0, 0, 'planeRed1.png').setScale(PLANE_SCALE).setDepth(5);
    this.world.add([this.sky, this.farGround, this.ground, this.groundFill, this.trail, this.puffs, this.plane]);

    this.scoreText = new SpriteNumber(this, 0, 0).set(0).setVisible(false);
    this.ui.add(this.scoreText);

    this.input.on('pointerdown', () => this.press());
    const keyboard = this.input.keyboard;
    keyboard?.addCapture('SPACE,UP');
    for (const key of ['SPACE', 'UP', 'W', 'ENTER']) {
      keyboard?.on(`keydown-${key}`, (e: KeyboardEvent) => !e.repeat && this.press());
    }
    this.scale.on('resize', () => this.layout());

    this.newRound();
  }

  /** Fits the world to the screen: full height, as wide as the screen allows. */
  private layout() {
    const { width: w, height: h } = this.scale;
    this.u = Math.min(h / BASE_H, w / MIN_W);
    this.vw = w / this.u;
    this.vh = h / this.u;
    this.rockScale = (1.15 * this.vh) / BASE_H;

    this.cameras.main.setSize(w, h).setZoom(this.u).centerOn(this.vw / 2, this.vh / 2);
    this.uiCam.setSize(w, h);

    const skyScale = this.vh / BASE_H;
    const width = this.vw + BLEED * 2;
    this.sky.setPosition(-BLEED, -BLEED).setSize(width, this.vh + BLEED * 2).setTileScale(skyScale);
    // The distant hills are stretched a little so their flat bottom edge hides behind the front ground.
    this.farGround
      .setPosition(-BLEED, this.groundY - 40 - STRIP_PAD * FAR_STRETCH)
      .setSize(width, (GROUND_H + STRIP_PAD * 2) * FAR_STRETCH)
      .setTileScale(1, FAR_STRETCH);
    this.ground.setPosition(-BLEED, this.groundY - STRIP_PAD).setSize(width, GROUND_H + STRIP_PAD * 2);
    this.groundFill.setPosition(-BLEED, this.vh - 3).setSize(width, BLEED);
    this.plane.x = this.planeX;

    const k = this.k;
    this.scoreText.setPosition(w / 2, Math.max(70 * k, 56)).setScale(k);
    this.rebuildOverlay?.();
  }

  private get groundY() {
    return this.vh - GROUND_H;
  }

  private get planeX() {
    return Phaser.Math.Clamp(this.vw * 0.28, 90, 260);
  }

  /** UI scale: 1 at 1280×720, smaller on phones. */
  private get k() {
    return Math.min(this.scale.height / 720, this.scale.width / 480);
  }

  // ---- Round flow --------------------------------------------------------------------------

  private newRound() {
    this.rocks.forEach((r) => (r.top.destroy(), r.bottom.destroy()));
    this.rocks = [];
    this.score = 0;
    this.vy = 0;
    this.grounded = false;
    this.canRestart = false;
    this.state = 'ready';

    let t: number;
    do t = Phaser.Math.Between(0, THEMES.length - 1);
    while (t === this.lastTheme);
    this.lastTheme = t;
    this.theme = THEMES[t];
    this.colour = Phaser.Utils.Array.GetRandom([...PLANES]);
    this.sky.setTint(this.theme.sky);
    this.ground.setTexture(this.theme.ground);
    this.groundFill.setFillStyle(bodyColour(this, this.theme.ground));
        this.plane.play(`fly${this.colour}`).setRotation(0);
    this.trail.emitting = true;
    this.best = load('tappy-plane:best', 0);

    this.layout();
    this.plane.y = this.vh * 0.45;
    this.scoreText.setVisible(false).set(0);
    this.cameras.main.fadeIn(250, 255, 255, 255);
    this.showGetReady();
  }

  private start() {
    this.state = 'playing';
    this.setOverlay();
    this.scoreText.setVisible(true);
    this.voice('go');
    this.music ??= this.sound.add('music', { loop: true, volume: 0.3 });
    this.music.play();
    // The first spike arrives quickly even on wide screens; any that spawn in view grow into place.
    let x = this.planeX + 380;
    while (x < this.vw + ROCK_SPACING) {
      this.spawnRocks(x);
      x += ROCK_SPACING;
    }
    this.flap();
  }

  private flap() {
    this.vy = FLAP_VY;
    playSfx(this, SFX, 'flap', { volume: 0.5 });
    const tail = this.tail();
    this.puffs.explode(4, tail.x, tail.y);
  }

  private crash(into: 'rock' | 'ground') {
    this.state = 'dead';
    this.trail.emitting = false;
    this.plane.stop();
    this.music?.stop();
    this.cameras.main.shake(260, 0.014);
    this.cameras.main.flash(140, 255, 255, 255);
    playSfx(this, SFX, into === 'rock' ? 'rocks' : 'thud', { volume: 0.8 });
    playSfx(this, SFX, 'thud', { volume: 0.5 });
    this.puffs.explode(12, this.plane.x, this.plane.y);
    this.scoreText.setVisible(false);
    if (into === 'rock') {
      this.vy = Math.min(this.vy, -120);
      playSfx(this, SFX, 'fall', { volume: 0.4 });
    } else {
      this.grounded = true;
    }
    this.time.delayedCall(450, () => this.voice('game_over'));
    this.time.delayedCall(into === 'rock' ? 1000 : 700, () => this.gameOver());
  }

  private gameOver() {
    this.state = 'over';
    const previous = this.best;
    const { best, isNew } = submitHighScore('tappy-plane', this.score);
    this.best = best;
    const record = isNew && this.score > 0 && previous > 0;
    this.showGameOver(record, true);
  }

  private press() {
    if (this.state === 'ready') this.start();
    else if (this.state === 'playing') this.flap();
    else if (this.state === 'over' && this.canRestart) {
      playSfx(this, SFX, 'tick');
      this.newRound();
    }
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

  private later(ms: number, fn: () => void) {
    this.overlayTimers.push(this.time.delayedCall(ms, fn));
  }

  private showGetReady() {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const k = this.k;
      const u = this.u;
      const px = this.planeX * u;
      const py = this.vh * 0.45 * u;

      const title = this.add.image(w / 2, py - 150 * k, 'textGetReady.png').setScale(0);
      this.tweens.add({ targets: title, scale: k, duration: 400, ease: 'Back.easeOut' });

      const hand = this.add.image(px + 18 * k, py + 70 * k, 'tapTick.png').setScale(k);
      this.overlayTimers.push(this.time.addEvent({ delay: 400, loop: true, callback: () => hand.setTexture(hand.texture.key === 'tap.png' ? 'tapTick.png' : 'tap.png') }));
      const arrows: Phaser.GameObjects.Image[] = [this.add.image(px + 95 * k, py, 'tapLeft.png').setScale(k)];
      if (px - 95 * k > 50 * k) arrows.push(this.add.image(px - 95 * k, py, 'tapRight.png').setScale(k));
      arrows.forEach((a, i) => this.tweens.add({ targets: a, x: a.x + (i ? 8 : -8) * k, duration: 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));

      const hintY = Math.min(h * 0.72, (this.groundY - 10) * u - 70 * k);
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const hint = this.add.text(w / 2, hintY, touch ? 'tap to fly' : 'click or press space to fly', { ...HINT, fontSize: `${Math.round(30 * k)}px`, strokeThickness: 8 * k }).setOrigin(0.5);
      if (hint.width > w - 32) hint.setScale((w - 32) / hint.width);
      const items: Phaser.GameObjects.GameObject[] = [title, hand, ...arrows, hint];
      if (this.best) {
        items.push(this.add.text(w / 2, hintY + 44 * k, `best ${this.best}`, { ...HINT, fontSize: `${Math.round(24 * k)}px`, color: '#ffd35c', strokeThickness: 7 * k }).setOrigin(0.5));
      }
      return items;
    });
  }

  private showGameOver(record: boolean, animate: boolean) {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.46).setScale(this.k);
      const medal = MEDALS.find((m) => this.score >= m.at);
      const next = [...MEDALS].reverse().find((m) => this.score < m.at);

      const title = this.add.image(0, -185, 'textGameOver.png');
      const panel = this.add.nineslice(0, 0, 'UIbg.png', undefined, 400, 210, 24, 24, 24, 24);
      const medalLabel = this.add.text(-105, -78, 'MEDAL', LABEL).setOrigin(0.5);
      const slot = this.add.circle(-105, 12, 56, 0xcfbd92);
      const medalImg = medal ? this.add.image(-105, 12, medal.frame) : undefined;
      const nextText = next && !medal ? this.add.text(-105, 12, `${next.at} for\n${next.name}`, { ...LABEL, fontSize: '20px', color: '#a07040' }).setOrigin(0.5) : undefined;
      const scoreLabel = this.add.text(85, -78, 'SCORE', LABEL).setOrigin(0.5);
      const scoreNum = new SpriteNumber(this, 85, -30).set(animate ? 0 : this.score).setScale(0.6);
      const bestLabel = this.add.text(85, 18, 'BEST', LABEL).setOrigin(0.5);
      const bestNum = new SpriteNumber(this, 85, 64).set(this.best).setScale(0.6);
      const newTag = record ? this.add.text(156, 60, 'NEW!', { ...LABEL, fontSize: '22px', color: '#e8473a' }).setOrigin(0.5).setAngle(-12) : undefined;
      const button = this.add.image(0, 168, 'buttonLarge.png');
      const play = this.add.text(0, 164, 'PLAY', { ...LABEL, fontSize: '38px', color: '#ffffff', stroke: '#c98a12', strokeThickness: 8 }).setOrigin(0.5);

      const parts = [title, panel, medalLabel, slot, medalImg, nextText, scoreLabel, scoreNum, bestLabel, bestNum, newTag, button, play];
      card.add(parts.filter((p): p is NonNullable<typeof p> => !!p));

      if (!animate) {
        this.canRestart = true;
        return [card];
      }

      // Title drops in, the card slides up, the score counts up, then the medal lands.
      [medalImg, newTag, button, play].forEach((o) => o?.setVisible(false));
      this.tweens.add({ targets: title, y: { from: -320, to: -185 }, duration: 450, ease: 'Back.easeOut' });
      const panelParts = parts.filter((p) => p && p !== title && p !== button && p !== play);
      for (const part of panelParts) (part as Phaser.GameObjects.Components.Transform).y += h;
      this.tweens.add({ targets: panelParts, y: `-=${h}`, duration: 450, delay: 250, ease: 'Cubic.easeOut' });

      const steps = Math.min(this.score, 25);
      const countStart = 750;
      for (let i = 1; i <= steps; i++) {
        this.later(countStart + i * 45, () => {
          scoreNum.set(Math.round((this.score * i) / steps));
          playSfx(this, SFX, 'tick', { volume: 0.35 });
        });
      }
      const reveal = countStart + steps * 45 + 200;
      this.later(reveal, () => {
        if (medalImg) {
          medalImg.setVisible(true);
          this.tweens.add({ targets: medalImg, scale: { from: 2.2, to: 1 }, angle: { from: -40, to: 0 }, duration: 380, ease: 'Back.easeOut' });
          playSfx(this, SFX, 'medal', { volume: 0.6, detune: 0 });
          this.sparkle(card, -105, 12, medal!.star);
        }
        if (newTag) {
          newTag.setVisible(true);
          this.tweens.add({ targets: newTag, scale: { from: 0, to: 1 }, duration: 300, ease: 'Back.easeOut' });
          this.later(medalImg ? 600 : 0, () => {
            playSfx(this, SFX, 'record', { volume: 0.5, detune: 0 });
            this.voice('new_highscore');
          });
        }
      });
      this.later(reveal + 450, () => {
        button.setVisible(true);
        play.setVisible(true);
        this.tweens.add({ targets: [button, play], scale: { from: 0, to: 1 }, duration: 300, ease: 'Back.easeOut' });
        this.tweens.add({ targets: [button, play], scale: 1.06, duration: 600, delay: 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.canRestart = true;
        // On a resize from here on, redraw the finished card rather than replaying the animation.
        this.rebuildOverlay = () => this.showGameOver(record, false);
      });
      return [card];
    });
  }

  private sparkle(card: Phaser.GameObjects.Container, x: number, y: number, frame: string) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const star = this.add.image(x, y, frame).setScale(0);
      card.add(star);
      this.tweens.add({
        targets: star,
        x: x + Math.cos(a) * 78,
        y: y + Math.sin(a) * 78,
        scale: { from: 0.2, to: 0.8 },
        angle: 180,
        alpha: { from: 1, to: 0 },
        duration: 700,
        ease: 'Cubic.easeOut',
        onComplete: () => star.destroy(),
      });
    }
  }

  private voice(name: Voice) {
    this.sound.play(`voice:${name}`, { volume: 0.9 });
  }

  // ---- Rocks -------------------------------------------------------------------------------

  private get gap() {
    return Math.max(GAP_MIN, GAP_START - this.score * GAP_SHRINK);
  }

  private spawnRocks(x: number) {
    const gap = this.gap;
    const reach = ROCK_H * this.rockScale;
    // The top spike must reach the top of the screen and the bottom one must sink below the ground's dips.
    const lo = Math.max(40, this.vh - 16 - reach - gap);
    const hi = Math.max(lo, Math.min(reach, this.groundY - 24 - gap));
    const prev = this.rocks.at(-1);
    let gapTop = Phaser.Math.FloatBetween(lo, hi);
    if (prev) gapTop = Phaser.Math.Clamp(gapTop, prev.centre - gap / 2 - 170, prev.centre - gap / 2 + 170);
    const gapBottom = gapTop + gap;

    const s = this.rockScale;
    const top = this.add.image(x, gapTop, this.theme.rockDown).setOrigin(0, 1).setScale(1, s).setDepth(2);
    const bottom = this.add.image(x, gapBottom, this.theme.rockUp).setOrigin(0, 0).setScale(1, s).setDepth(2);
    this.world.add([top, bottom]);
    if (x < this.vw + 20) {
      // Spawned on screen: grow in from the edges instead of popping.
      this.tweens.add({ targets: top, y: { from: gapTop - reach, to: gapTop }, duration: 500, ease: 'Back.easeOut' });
      this.tweens.add({ targets: bottom, y: { from: gapBottom + reach, to: gapBottom }, duration: 500, ease: 'Back.easeOut' });
    }
    this.rocks.push({
      x,
      top,
      bottom,
      topPoly: ROCK_SHAPE.map(([px, py]) => [px, gapTop - py * s]),
      bottomPoly: ROCK_SHAPE.map(([px, py]) => [px, gapBottom + py * s]),
      centre: gapTop + gap / 2,
      scored: false,
    });
  }

  // ---- Collision ---------------------------------------------------------------------------

  private hitsRock(cx: number, cy: number): boolean {
    for (const r of this.rocks) {
      if (cx + PLANE_R < r.x || cx - PLANE_R > r.x + ROCK_W) continue;
      if (circleHitsPolygon(cx - r.x, cy, PLANE_R, r.topPoly) || circleHitsPolygon(cx - r.x, cy, PLANE_R, r.bottomPoly)) return true;
    }
    return false;
  }

  /** Top of the solid ground at a world x, following the strip's hills pixel by pixel. */
  private groundTop(x: number) {
    const profile = this.profiles.get(this.theme.ground)!;
    const col = Phaser.Math.Wrap(Math.floor(x + BLEED + this.ground.tilePositionX), 0, GROUND_W);
    return this.groundY + profile[col];
  }

  private hitsGround(cx: number, cy: number): boolean {
    for (let dx = -PLANE_R; dx <= PLANE_R; dx += 2) {
      const reach = Math.sqrt(PLANE_R * PLANE_R - dx * dx);
      if (cy + reach >= this.groundTop(cx + dx)) return true;
    }
    return false;
  }

  /** Where exhaust comes out, following the plane's tilt. */
  private tail() {
    const r = this.plane.rotation;
    const ox = -26;
    const oy = 4;
    return { x: this.plane.x + ox * Math.cos(r) - oy * Math.sin(r), y: this.plane.y + ox * Math.sin(r) + oy * Math.cos(r) };
  }

  // ---- Frame loop --------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 30);
    const moving = this.state === 'ready' || this.state === 'playing';
    const dx = moving ? SPEED * dt : 0;
    this.sky.tilePositionX += (dx * 0.2) / this.sky.tileScaleX;
    this.farGround.tilePositionX += dx * 0.5;
    this.ground.tilePositionX = (this.ground.tilePositionX + dx) % GROUND_W;

    const p = this.plane;
    if (this.state === 'ready') {
      p.y = this.vh * 0.45 + Math.sin(time / 260) * 8;
      p.rotation = Math.sin(time / 260 + 1) * 0.06;
    } else if (this.state === 'playing') {
      this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);
      p.y += this.vy * dt;
      if (p.y < -20) {
        p.y = -20;
        this.vy = Math.max(this.vy, 0);
      }
      const target = Phaser.Math.Clamp(-0.44 + Math.max(0, this.vy - 120) * 0.0034, -0.44, 1.3);
      p.rotation += (target - p.rotation) * Math.min(1, dt * (target < p.rotation ? 16 : 5));

      for (const r of this.rocks) {
        r.x -= dx;
        r.top.x = r.bottom.x = r.x;
        if (!r.scored && r.x + 66 < p.x) {
          r.scored = true;
          this.addPoint();
        }
      }
      while (this.rocks.length && this.rocks[0].x < -ROCK_W - 20) {
        const r = this.rocks.shift()!;
        r.top.destroy();
        r.bottom.destroy();
      }
      const last = this.rocks.at(-1);
      if (last && last.x < this.vw + 20) this.spawnRocks(last.x + ROCK_SPACING);

      if (this.hitsGround(p.x, p.y)) this.crash('ground');
      else if (this.hitsRock(p.x, p.y)) this.crash('rock');
    } else if (!this.grounded) {
      // Crashed into a rock: tumble down to the ground.
      this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL * 1.3);
      p.y += this.vy * dt;
      p.rotation += (1.45 - p.rotation) * Math.min(1, dt * 6);
      if (this.hitsGround(p.x, p.y)) {
        this.grounded = true;
        playSfx(this, SFX, 'thud', { volume: 0.6 });
        this.cameras.main.shake(120, 0.008);
        this.puffs.explode(6, p.x, p.y + PLANE_R);
      }
    }

    const tail = this.tail();
    this.trail.setPosition(tail.x, tail.y);
  }

  private addPoint() {
    this.score++;
    this.scoreText.set(this.score);
    const k = this.k;
    this.tweens.add({ targets: this.scoreText, scale: { from: 1.35 * k, to: k }, duration: 220, ease: 'Back.easeOut' });
    playSfx(this, SFX, 'point', { volume: 0.45, detune: 0 });
    const medal = MEDALS.find((m) => m.at === this.score);
    if (medal) {
      playSfx(this, SFX, 'medal', { volume: 0.5, detune: 0 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const star = this.add.image(this.scoreText.x, this.scoreText.y, medal.star).setScale(k);
        this.ui.add(star);
        this.tweens.add({
          targets: star,
          x: star.x + Math.cos(a) * 110 * k,
          y: star.y + Math.sin(a) * 80 * k,
          angle: 200,
          alpha: 0,
          duration: 800,
          ease: 'Cubic.easeOut',
          onComplete: () => star.destroy(),
        });
      }
    }
  }
}

/** True if a circle overlaps a simple polygon (inside it, or within `r` of an edge). */
function circleHitsPolygon(cx: number, cy: number, r: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
    const ex = xi - xj;
    const ey = yi - yj;
    const t = Phaser.Math.Clamp(((cx - xj) * ex + (cy - yj) * ey) / (ex * ex + ey * ey), 0, 1);
    const dx = cx - (xj + t * ex);
    const dy = cy - (yj + t * ey);
    if (dx * dx + dy * dy < r * r) return true;
  }
  return inside;
}

/** The colour of a ground strip's solid body, from just above its bottom padding. */
function bodyColour(scene: Phaser.Scene, key: string) {
  const tex = scene.textures.get(key);
  return scene.textures.getPixel(tex.source[0].width / 2, tex.source[0].height - STRIP_PAD - 2, key)!.color;
}
