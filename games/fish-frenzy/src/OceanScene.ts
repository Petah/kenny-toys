import * as Phaser from 'phaser';
import { FONT_BODY, FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { makeButton } from '@shared/ui';
import {
  PLAYER_FRAME, PLAYER_LEN, PLAYER_SKELETON, SFX, SHEET, SPECIES, STAGE_GROWTH,
  buildStrip, frameBounds, padAtlas, preloadAssets, type Bounds, type Species, type Voice,
} from './assets';
import { Swimmer, bodyHit, touching, type Hit, type Water } from './fish';
import { HudNumber } from './HudNumber';

/** The world is at least 600 units tall and 420 wide; wider or taller screens see more water. */
const BASE_H = 600;
const MIN_W = 420;
/** Scenery overhangs the screen edges by this much so camera shake never shows past the world. */
const BLEED = 40;
/** Where the sand strip starts, up from the bottom of the screen. Its wavy top is a little lower. */
const FLOOR_UP = 100;
const SAND_UP = 86;

const MAX_SPEED = 330;
const LIVES = 3;
const COMBO_MS = 1400;
const MAX_COMBO = 5;
const INVULNERABLE_MS = 2200;
/** Predators get a slightly smaller hit area than prey, so near misses go the player's way. */
const FAIR_DANGER = 0.82;
const FAIR_FOOD = 1.05;

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#1f6f9f',
  align: 'center',
};

type State = 'title' | 'playing' | 'dying' | 'over';

interface Warning {
  y: number;
  dir: 1 | -1;
  until: number;
  marker: Phaser.GameObjects.Container;
}

export class OceanScene extends Phaser.Scene {
  private state: State = 'title';

  private world!: Phaser.GameObjects.Layer;
  private ui!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private water!: Phaser.GameObjects.Graphics;
  private rays!: Phaser.GameObjects.Graphics;
  private backdrop!: Phaser.GameObjects.TileSprite;
  private floor!: Phaser.GameObjects.TileSprite;
  private decor: Phaser.GameObjects.Image[] = [];
  private ambient!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bubbles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private player!: Phaser.GameObjects.Image;
  private playerBounds!: Bounds;

  private livesIcons: Phaser.GameObjects.Image[] = [];
  private scoreText!: HudNumber;
  private bar!: Phaser.GameObjects.Graphics;
  private barIcons: Phaser.GameObjects.Image[] = [];
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private overlayTimers: Phaser.Time.TimerEvent[] = [];
  private music?: Phaser.Sound.BaseSound;

  /** World size in units, and screen pixels per unit. */
  private vw = 0;
  private vh = 0;
  private u = 1;

  private swimmers: Swimmer[] = [];
  private warnings: Warning[] = [];
  private spawnIn = 0;
  private eelIn = 0;

  // The player.
  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;
  private facing: 1 | -1 = 1;
  private tx = 0;
  private ty = 0;
  private drag?: { sx: number; sy: number; tx: number; ty: number };
  private steeringByKeys = false;
  private chomp = 0;
  private invulnerableUntil = 0;

  private stage = 0;
  private growth = 0;
  /** The growth bar's drawn fill, easing towards the real one. */
  private shownFill = 0;
  private wave = 1;
  private lives = LIVES;
  private score = 0;
  private best = 0;
  private combo = 0;
  private lastEat = -Infinity;
  private canRestart = false;

  private keys?: Record<'left' | 'right' | 'up' | 'down' | 'a' | 'd' | 'w' | 's', Phaser.Input.Keyboard.Key>;

  constructor() {
    super('ocean');
  }

  preload() {
    preloadAssets(this);
  }

  // ---- Setup -------------------------------------------------------------------------------

  create() {
    padAtlas(this);
    buildStrip(this, 'sand', ['terrain_sand_top_a', 'terrain_sand_top_b', 'terrain_sand_top_c', 'terrain_sand_top_d'], 'terrain_sand_a');
    buildStrip(this, 'hills', ['background_terrain_top'], 'background_terrain');

    this.world = this.add.layer();
    this.ui = this.add.layer();
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.ui);
    this.uiCam.ignore(this.world);

    this.water = this.add.graphics().setDepth(0);
    this.rays = this.add.graphics().setDepth(1).setBlendMode(Phaser.BlendModes.ADD);
    this.backdrop = this.add.tileSprite(0, 0, 10, 10, 'hills').setOrigin(0).setDepth(2).setTileScale(0.6);
    this.floor = this.add.tileSprite(0, 0, 10, 10, 'sand').setOrigin(0).setDepth(20).setTileScale(0.5);

    this.ambient = this.add.particles(0, 0, SHEET, {
      frame: ['bubble_a', 'bubble_b', 'bubble_c'],
      speedY: { min: -70, max: -35 },
      speedX: { min: -6, max: 6 },
      scale: { min: 0.08, max: 0.2 },
      alpha: { start: 0.8, end: 0.2 },
      lifespan: 9000,
      frequency: 450,
    }).setDepth(4);
    this.bubbles = this.add.particles(0, 0, SHEET, {
      frame: ['bubble_a', 'bubble_b', 'bubble_c'],
      speed: { min: 30, max: 110 },
      angle: { min: 200, max: 340 },
      gravityY: -160,
      scale: { start: 0.18, end: 0.06 },
      alpha: { start: 1, end: 0 },
      lifespan: 900,
      emitting: false,
    }).setDepth(15);

    this.playerBounds = frameBounds(this, PLAYER_FRAME);
    this.player = this.add.image(0, 0, SHEET, PLAYER_FRAME).setDepth(12).setVisible(false);
    this.world.add([this.water, this.rays, this.backdrop, this.floor, this.ambient, this.bubbles, this.player]);

    this.scoreText = new HudNumber(this, 0, 0, 'right');
    this.bar = this.add.graphics();
    for (let i = 0; i < LIVES; i++) this.livesIcons.push(this.add.image(0, 0, SHEET, PLAYER_FRAME));
    this.barIcons = [...SPECIES.map((s) => this.add.image(0, 0, SHEET, s.frame)), this.add.image(0, 0, SHEET, PLAYER_FRAME)];
    this.ui.add([this.bar, ...this.barIcons, this.scoreText, ...this.livesIcons]);
    this.setHudVisible(false);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointerMove(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on('pointerup', () => this.pointerUp());
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');
      this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN', a: 'A', d: 'D', w: 'W', s: 'S' }) as typeof this.keys;
      for (const key of ['SPACE', 'ENTER']) kb.on(`keydown-${key}`, (e: KeyboardEvent) => !e.repeat && this.confirm());
    }
    this.scale.on('resize', () => this.layout());

    this.best = load('fish-frenzy:best', 0);
    this.layout();
    // Fill the water straight away so the title isn't empty.
    for (let i = 0; i < this.populationCap; i++) this.spawn(Phaser.Math.FloatBetween(0.1, 0.9) * this.vw);
    this.showTitle();
  }

  /** Fits the world to the screen: full height, as wide as the screen allows. */
  private layout() {
    const { width: w, height: h } = this.scale;
    this.u = Math.min(h / BASE_H, w / MIN_W);
    this.vw = w / this.u;
    this.vh = h / this.u;
    this.cameras.main.setSize(w, h).setZoom(this.u).centerOn(this.vw / 2, this.vh / 2);
    this.uiCam.setSize(w, h);

    const width = this.vw + BLEED * 2;
    this.water.clear();
    this.water.fillGradientStyle(0xd4f2fc, 0xd4f2fc, 0x8fd3f0, 0x8fd3f0, 1);
    this.water.fillRect(-BLEED, -BLEED, width, this.vh + BLEED * 2);
    this.backdrop.setPosition(-BLEED, this.vh - FLOOR_UP - 70).setSize(width, 154 + FLOOR_UP);
    this.floor.setPosition(-BLEED, this.vh - FLOOR_UP).setSize(width, FLOOR_UP + BLEED);
    this.drawRays(0);
    this.ambient.addEmitZone({ type: 'random', source: new Phaser.Geom.Rectangle(0, this.vh - SAND_UP - 10, this.vw, 10), quantity: 1 } as Phaser.Types.GameObjects.Particles.EmitZoneData);
    if (this.ambient.emitZones.length > 1) this.ambient.removeEmitZone(this.ambient.emitZones[0]);
    this.placeDecor();

    this.px = Phaser.Math.Clamp(this.px, 0, this.vw);
    this.py = Phaser.Math.Clamp(this.py, this.waterBand.top, this.waterBand.bottom);
    this.layoutHud();
    this.rebuildOverlay?.();
  }

  /** Seaweed and rocks: pale silhouettes on the far hills, bright ones on the sand. Same every time for a given width. */
  private placeDecor() {
    this.decor.forEach((d) => d.destroy());
    this.decor = [];
    const rnd = new Phaser.Math.RandomDataGenerator(['fish-frenzy']);
    const far = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((c) => `background_seaweed_${c}`).concat('background_rock_a', 'background_rock_b');
    const near = [
      ...['a', 'b', 'c', 'd'].flatMap((c) => [`seaweed_green_${c}`, `seaweed_pink_${c}`]),
      'seaweed_orange_a', 'seaweed_orange_b', 'seaweed_grass_a', 'seaweed_grass_b', 'rock_a', 'rock_b',
    ];
    for (let x = -BLEED + rnd.between(10, 60); x < this.vw + BLEED; x += rnd.between(55, 120)) {
      const d = this.add.image(x, this.vh - FLOOR_UP - 52, SHEET, rnd.pick(far)).setOrigin(0.5, 1).setScale(rnd.realInRange(0.6, 0.9)).setDepth(3);
      this.decor.push(d);
    }
    for (let x = -BLEED + rnd.between(20, 80); x < this.vw + BLEED; x += rnd.between(70, 150)) {
      const frame = rnd.pick(near);
      const d = this.add.image(x, this.vh - SAND_UP + 18, SHEET, frame).setOrigin(0.5, 1).setScale(rnd.realInRange(0.45, 0.65)).setDepth(21);
      if (rnd.frac() < 0.5) d.setFlipX(true);
      this.decor.push(d);
    }
    this.world.add(this.decor);
  }

  /** Soft shafts of light from the surface, swaying slowly. */
  private drawRays(time: number) {
    const g = this.rays.clear();
    const n = Math.max(3, Math.round(this.vw / 260));
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * this.vw + Math.sin(time / 3000 + i * 1.7) * 30;
      const lean = 160 + Math.sin(time / 4100 + i) * 40;
      const wTop = 34 + (i % 2) * 22;
      g.fillStyle(0xffffff, 0.05 + 0.025 * Math.sin(time / 1700 + i * 2.3));
      const bottom = this.vh - SAND_UP;
      g.fillPoints([
        new Phaser.Math.Vector2(x - wTop / 2, -BLEED),
        new Phaser.Math.Vector2(x + wTop / 2, -BLEED),
        new Phaser.Math.Vector2(x + wTop * 1.6 + lean, bottom),
        new Phaser.Math.Vector2(x - wTop * 0.4 + lean, bottom),
      ], true);
    }
  }

  private get waterBand(): Water {
    return { width: this.vw, top: 18, bottom: this.vh - SAND_UP - 6 };
  }

  /** UI scale: 1 at 1280×720, smaller on phones. */
  private get k() {
    return Math.min(this.scale.height / 720, this.scale.width / 480);
  }

  private layoutHud() {
    const { width: w, height: h } = this.scale;
    const k = this.k;
    this.scoreText.setPosition(w - 22 * k, 46 * k).setScale(0.5 * k);
    // Under the "All toys" link.
    this.livesIcons.forEach((icon, i) => icon.setPosition((40 + i * 46) * k, Math.max(86 * k, 74)).setScale(0.42 * k));
    const barW = this.barWidth;
    const y = h - (SAND_UP / 2 - 4) * this.u;
    this.barIcons.forEach((icon, i) => {
      icon.setPosition(w / 2 - barW / 2 + (i / SPECIES.length) * barW, y).setScale((i === SPECIES.length ? 0.42 : 0.36) * k);
    });
    this.drawBar();
  }

  private get barWidth() {
    return Math.min(520 * this.k, this.scale.width - 90 * this.k);
  }

  private setHudVisible(on: boolean) {
    [this.bar, this.scoreText, ...this.barIcons, ...this.livesIcons].forEach((o) => o.setVisible(on));
  }

  // ---- Input -------------------------------------------------------------------------------

  private pointerMove(p: Phaser.Input.Pointer) {
    if (p.wasTouch) {
      // Touch steers by dragging anywhere, so a finger never covers the fish.
      if (this.drag && p.isDown) {
        this.tx = this.drag.tx + ((p.x - this.drag.sx) / this.u) * 1.5;
        this.ty = this.drag.ty + ((p.y - this.drag.sy) / this.u) * 1.5;
      }
    } else {
      this.tx = p.x / this.u;
      this.ty = p.y / this.u;
    }
    this.steeringByKeys = false;
  }

  private pointerDown(p: Phaser.Input.Pointer) {
    if (p.wasTouch) this.drag = { sx: p.x, sy: p.y, tx: this.px, ty: this.py };
    else this.pointerMove(p);
  }

  private pointerUp() {
    if (!this.drag) return;
    this.drag = undefined;
    // Let go and the fish glides to a stop.
    this.tx = this.px + this.vx * 0.25;
    this.ty = this.py + this.vy * 0.25;
  }

  private confirm() {
    if (this.state === 'title') this.startGame();
    else if (this.state === 'over' && this.canRestart) this.startGame();
  }

  // ---- Game flow ---------------------------------------------------------------------------

  private startGame() {
    playSfx(this, SFX, 'click');
    this.setOverlay();
    for (const s of this.swimmers) this.fadeAway(s);
    this.swimmers = [];
    this.warnings.forEach((w) => w.marker.destroy());
    this.warnings = [];

    this.state = 'playing';
    this.stage = 0;
    this.growth = 0;
    this.shownFill = 0;
    this.wave = 1;
    this.lives = LIVES;
    this.score = 0;
    this.combo = 0;
    this.canRestart = false;
    this.spawnIn = 0.4;
    this.eelIn = this.eelDelay();
    this.scoreText.set(0);
    this.livesIcons.forEach((i) => i.setFrame(PLAYER_FRAME).setAlpha(1));
    this.setHudVisible(true);
    this.drawBar();

    this.px = this.tx = this.vw / 2;
    this.py = this.ty = this.vh * 0.42;
    this.vx = this.vy = 0;
    this.appear();
    this.banner(`WAVE ${this.wave}`);
    this.voice('go');
    this.music ??= this.sound.add('music', { loop: true, volume: 0.35 });
    if (!this.music.isPlaying) this.music.play();
  }

  /** The player pops into the water with a burst of bubbles and a moment's safety. */
  private appear() {
    this.player.setVisible(true).setAlpha(1).setFrame(PLAYER_FRAME);
    this.invulnerableUntil = this.time.now + INVULNERABLE_MS;
    this.bubbles.explode(14, this.px, this.py);
    playSfx(this, SFX, 'bubble', { volume: 0.5 });
  }

  private die(by?: Swimmer) {
    this.state = 'dying';
    this.lives--;
    this.combo = 0;
    this.player.setVisible(false);
    this.drag = undefined;
    playSfx(this, SFX, 'hurt', { volume: 0.7 });
    playSfx(this, SFX, 'gulp', { volume: 0.8, detune: -600 });
    this.cameras.main.shake(260, 0.012);
    this.cameras.main.flash(160, 255, 120, 120);
    this.bubbles.explode(16, this.px, this.py);
    this.dropSkeleton(PLAYER_SKELETON, this.px, this.py, this.player.scaleX, this.facing);
    if (by?.kind === 'fish') this.tweens.add({ targets: by.view, scaleY: by.view.scaleY * 1.25, duration: 110, yoyo: true });

    const icon = this.livesIcons[this.lives];
    if (icon) {
      icon.setFrame(PLAYER_SKELETON);
      this.tweens.add({ targets: icon, scale: { from: icon.scale * 1.8, to: icon.scale }, angle: { from: -30, to: 0 }, duration: 380, ease: 'Back.easeOut' });
    }

    if (this.lives <= 0) {
      this.music?.stop();
      this.time.delayedCall(500, () => this.voice('game_over'));
      this.time.delayedCall(1400, () => this.gameOver());
    } else {
      this.time.delayedCall(1100, () => {
        if (this.state !== 'dying') return;
        this.state = 'playing';
        this.px = this.tx = this.vw / 2;
        this.py = this.ty = this.waterBand.top + 70;
        this.vx = this.vy = 0;
        this.appear();
      });
    }
  }

  private gameOver() {
    this.state = 'over';
    const previous = this.best;
    const { best, isNew } = submitHighScore('fish-frenzy', this.score);
    this.best = best;
    this.showGameOver(isNew && this.score > 0 && previous > 0, true);
  }

  // ---- Eating and growing ------------------------------------------------------------------

  private eat(s: Swimmer) {
    const sp = s.species!;
    const now = this.time.now;
    this.combo = now - this.lastEat < COMBO_MS ? Math.min(this.combo + 1, MAX_COMBO) : 1;
    this.lastEat = now;
    const points = sp.points * this.combo;
    this.score += points;
    this.scoreText.set(this.score);
    const k = this.k;
    this.tweens.add({ targets: this.scoreText, scale: { from: 0.62 * k, to: 0.5 * k }, duration: 200, ease: 'Back.easeOut' });

    // Smaller fish than the newest edible kind are snacks: worth points but only a little growth.
    this.growth += sp.tier >= this.stage + 1 ? sp.growth : sp.growth / 2;
    this.chomp = 1;
    const mouth = this.mouth();
    this.bubbles.explode(5 + sp.tier * 2, mouth.x, mouth.y);
    playSfx(this, SFX, sp.tier <= 1 ? 'nibble' : 'gulp', { volume: 0.7, detune: (this.combo - 1) * 160 - sp.tier * 60 });
    this.dropSkeleton(sp.skeleton, s.x, s.y, s.view.scaleX, s.dir);
    this.popup(s.x, s.y - 10, points, this.combo);
    s.destroy();

    const need = STAGE_GROWTH[this.stage];
    if (this.growth >= need) {
      if (this.stage < PLAYER_LEN.length - 1) {
        this.growth -= need;
        this.stage++;
        this.grewUp();
      } else {
        this.clearWave();
      }
    }
    this.drawBar();
  }

  private grewUp() {
    playSfx(this, SFX, 'grow', { volume: 0.5, detune: 0 });
    this.time.delayedCall(250, () => playSfx(this, SFX, 'stage', { volume: 0.5, detune: 0 }));
    this.player.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(90, () => this.player.clearTint().setTintMode(Phaser.TintModes.MULTIPLY));
    this.bubbles.explode(18, this.px, this.py);
    const icon = this.barIcons[this.stage];
    this.tweens.add({ targets: icon, scale: { from: icon.scale * 2, to: icon.scale }, duration: 500, ease: 'Back.easeOut' });
    this.flyText(this.px, this.py - this.playerLen * 0.5 - 50, 'BIGGER!', '#ffd84a');
  }

  /** The bar is full: bank a bonus, shrink back to a minnow and start a busier wave. */
  private clearWave() {
    const bonus = 500 * this.wave;
    this.score += bonus;
    this.scoreText.set(this.score);
    this.wave++;
    this.stage = 0;
    this.growth = 0;
    // Longer than a respawn: you're suddenly small with big fish all around.
    this.invulnerableUntil = this.time.now + INVULNERABLE_MS * 1.5;
    playSfx(this, SFX, 'wave', { volume: 0.6, detune: 0 });
    this.time.delayedCall(700, () => playSfx(this, SFX, 'shrink', { volume: 0.5, detune: 0 }));
    this.voice('level_up');
    this.bubbles.explode(30, this.px, this.py);
    this.banner(`WAVE ${this.wave}`, `+${bonus} bonus`);
    this.barIcons.forEach((icon, i) => this.tweens.add({ targets: icon, angle: { from: 0, to: 360 }, duration: 500, delay: i * 80, ease: 'Cubic.easeOut' }));
  }

  private get edibleTier() {
    return this.stage + 1;
  }

  /** The player's length now, growing through the current stage as the bar fills. */
  private get playerLen() {
    const [from, to] = PLAYER_LEN[this.stage];
    return from + (to - from) * Math.min(1, this.growth / STAGE_GROWTH[this.stage]);
  }

  private playerHit(): Hit {
    const scale = this.playerLen / this.playerBounds.w;
    return bodyHit(this.playerBounds, this.px, this.py, scale, this.facing);
  }

  private mouth() {
    const h = this.playerHit();
    return { x: h.x + h.a * this.facing, y: h.y };
  }

  // ---- Spawning ----------------------------------------------------------------------------

  private get populationCap() {
    return Math.round(this.vw / 120) + 1 + Math.min(this.wave - 1, 4);
  }

  private eelDelay() {
    return Math.max(4, 12 - this.wave * 1.5) + Math.random() * 4;
  }

  /** Picks what swims in next: mostly fish you can eat, some bigger ones, and the odd pufferfish. */
  private pick(): Species | 'puffer' {
    if (this.state === 'title') return Phaser.Utils.Array.GetRandom(SPECIES);
    const e = this.edibleTier;
    const options: [Species | 'puffer', number][] = SPECIES.map((s) => {
      if (s.tier === e) return [s, 4];
      if (s.tier < e) return [s, s.tier === e - 1 ? 2 : 1];
      const above = s.tier - e;
      return [s, above === 1 ? 1.4 + 0.25 * (this.wave - 1) : 0.5 / above];
    });
    const puffers = this.swimmers.filter((s) => s.kind === 'puffer').length;
    if ((this.stage >= 1 || this.wave >= 2) && puffers < 1 + Math.floor(this.wave / 2)) options.push(['puffer', 0.5 + 0.2 * this.wave]);
    // Keep at least two things to eat in the water.
    const edible = this.swimmers.filter((s) => s.kind === 'fish' && s.species!.tier <= e).length;
    const pool = edible < 2 ? options.filter(([o]) => o !== 'puffer' && o.tier <= e) : options;
    let r = Math.random() * pool.reduce((sum, [, w]) => sum + w, 0);
    for (const [o, w] of pool) if ((r -= w) <= 0) return o;
    return pool[0][0];
  }

  /** Sends a swimmer in from a random side, or starts one at `atX` when filling the screen. */
  private spawn(atX?: number) {
    const what = this.pick();
    const band = this.waterBand;
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const y = Phaser.Math.FloatBetween(band.top + 30, band.bottom - 30);
    const s = what === 'puffer' ? new Swimmer(this, 'puffer', undefined, band, y, dir) : new Swimmer(this, 'fish', what, band, y, dir);
    if (atX !== undefined) s.x = atX;
    s.view.setDepth(10 - s.length / 1000);
    this.world.add(s.view);
    this.swimmers.push(s);
  }

  /** Flashes a warning at the screen edge, then an eel dashes through at that depth. */
  private warnEel() {
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const band = this.waterBand;
    const y = Phaser.Math.Clamp(this.py + Phaser.Math.FloatBetween(-50, 50), band.top + 20, band.bottom - 20);
    const k = this.k;
    const x = dir > 0 ? 34 * k : this.scale.width - 34 * k;
    const ring = this.add.circle(0, 0, 22, 0xe8473a).setStrokeStyle(4, 0xffffff);
    const mark = this.add.text(0, 1, '!', { ...TEXT, fontSize: '30px', stroke: '#8a1c12', strokeThickness: 4 }).setOrigin(0.5);
    const marker = this.add.container(x, y * this.u, [ring, mark]).setScale(k);
    this.ui.add(marker);
    this.tweens.add({ targets: marker, scale: k * 1.25, duration: 160, yoyo: true, repeat: -1 });
    playSfx(this, SFX, 'warn', { volume: 0.45, detune: 0 });
    this.warnings.push({ y, dir, until: this.time.now + 1200, marker });
  }

  private releaseEel(w: Warning) {
    w.marker.destroy();
    const s = new Swimmer(this, 'eel', undefined, this.waterBand, w.y, w.dir);
    s.view.setDepth(11);
    this.world.add(s.view);
    this.swimmers.push(s);
    playSfx(this, SFX, 'dash', { volume: 0.7 });
  }

  private fadeAway(s: Swimmer) {
    s.gone = true;
    this.tweens.add({ targets: s.view, alpha: 0, duration: 300, onComplete: () => s.view.destroy() });
  }

  // ---- Effects -----------------------------------------------------------------------------

  /** A fish's bones sink to the sand and fade. */
  private dropSkeleton(frame: string, x: number, y: number, scale: number, dir: number) {
    const bones = this.add.image(x, y, SHEET, frame).setScale(Math.abs(scale)).setFlipX(dir < 0).setDepth(9);
    this.world.add(bones);
    this.tweens.add({ targets: bones, scale: { from: Math.abs(scale) * 1.2, to: Math.abs(scale) }, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: bones,
      y: y + 70,
      angle: dir * Phaser.Math.Between(25, 60),
      alpha: { from: 1, to: 0 },
      duration: 1400,
      delay: 250,
      ease: 'Sine.easeIn',
      onComplete: () => bones.destroy(),
    });
  }

  /** "+50" in the pack's digits where something was eaten, with the combo beside it. */
  private popup(x: number, y: number, points: number, combo: number) {
    const k = this.k;
    const num = new HudNumber(this, 0, 0, 'center', '+').set(points).setScale(0.3);
    const parts: Phaser.GameObjects.GameObject[] = [num];
    if (combo > 1) parts.push(this.add.text(0, 30, `x${combo}`, { ...TEXT, fontSize: '22px', color: '#ffd84a', stroke: '#b4521c', strokeThickness: 6 }).setOrigin(0.5));
    const c = this.add.container(x * this.u, y * this.u, parts).setScale(k * 0.9);
    this.ui.add(c);
    this.tweens.add({ targets: c, scale: { from: 0.3 * k, to: k }, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, y: c.y - 50 * k, alpha: 0, duration: 700, delay: 350, ease: 'Cubic.easeIn', onComplete: () => c.destroy() });
  }

  private flyText(x: number, y: number, text: string, color: string) {
    const k = this.k;
    const t = this.add.text(x * this.u, y * this.u, text, { ...TEXT, fontSize: `${Math.round(30 * k)}px`, color, strokeThickness: 8 * k }).setOrigin(0.5);
    this.ui.add(t);
    this.tweens.add({ targets: t, scale: { from: 0, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: t.y - 40 * k, alpha: 0, duration: 600, delay: 600, onComplete: () => t.destroy() });
  }

  /** A big title across the middle that pops in and fades away. */
  private banner(title: string, sub?: string) {
    const { width: w, height: h } = this.scale;
    const k = this.k;
    const parts: Phaser.GameObjects.GameObject[] = [this.add.text(0, 0, title, { ...TEXT, fontSize: '64px', strokeThickness: 12 }).setOrigin(0.5)];
    if (sub) parts.push(this.add.text(0, 56, sub, { ...TEXT, fontSize: '30px', color: '#ffd84a', strokeThickness: 8 }).setOrigin(0.5));
    const c = this.add.container(w / 2, h * 0.36, parts).setScale(0);
    this.ui.add(c);
    this.tweens.add({ targets: c, scale: k, duration: 420, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, alpha: 0, y: c.y - 30 * k, duration: 400, delay: 1500, onComplete: () => c.destroy() });
  }

  private voice(name: Voice) {
    this.sound.play(`voice:${name}`, { volume: 0.9 });
  }

  /** The growth bar on the sand: how far to the next size, with each kind of fish at the point you can eat it. */
  private drawBar() {
    const { width: w, height: h } = this.scale;
    const k = this.k;
    const barW = this.barWidth;
    const barH = 16 * k;
    const x = w / 2 - barW / 2;
    const y = h - (SAND_UP / 2 - 4) * this.u;
    const shown = this.shownFill;
    const g = this.bar.clear();
    g.fillStyle(0x7a5a2a, 0.35).fillRoundedRect(x - 6 * k, y - barH / 2 - 6 * k, barW + 12 * k, barH + 12 * k, (barH + 12 * k) / 2);
    g.fillStyle(0xfff3d0, 1).fillRoundedRect(x, y - barH / 2, barW, barH, barH / 2);
    if (shown > 0.005) g.fillStyle(0xf59a23, 1).fillRoundedRect(x, y - barH / 2, Math.max(barH, barW * shown), barH, barH / 2);
    this.barIcons.forEach((icon, i) => {
      // The last icon is the goal, a grown-up you.
      if (i <= this.stage || i === SPECIES.length) icon.clearTint().setTintMode(Phaser.TintModes.MULTIPLY).setAlpha(1);
      else icon.setTint(0x2c5c78).setTintMode(Phaser.TintModes.FILL).setAlpha(0.45);
    });
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

  private button(x: number, y: number, label: string, onClick: () => void) {
    return makeButton(this, x, y, label, onClick, { textStyle: TEXT, color: 0xf59a23, onPress: () => playSfx(this, SFX, 'click') }).parts;
  }

  private showTitle() {
    this.state = 'title';
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const k = this.k;
      const card = this.add.container(w / 2, h * 0.45);
      const title = this.add.text(0, -150, 'FISH FRENZY', { ...TEXT, fontSize: '76px', strokeThickness: 14 }).setOrigin(0.5);
      this.tweens.add({ targets: title, angle: { from: -2, to: 2 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

      // The food chain, smallest to biggest.
      const chain: Phaser.GameObjects.GameObject[] = [];
      const step = 92;
      SPECIES.forEach((s, i) => {
        const fx = (i - (SPECIES.length - 1) / 2) * step;
        const scale = (s.len * 0.9) / frameBounds(this, s.frame).w;
        const img = this.add.image(fx, -50, SHEET, s.frame).setScale(scale);
        this.tweens.add({ targets: img, y: -56, duration: 700 + i * 90, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        chain.push(img);
        if (i) chain.push(this.add.text(fx - step / 2, -50, '<', { ...TEXT, fontSize: '28px', strokeThickness: 6 }).setOrigin(0.5));
      });
      const tag = this.add.text(0, 24, 'Eat smaller fish, grow,\nand dodge the bigger ones!', { ...TEXT, fontFamily: FONT_BODY, fontSize: '26px', strokeThickness: 7, lineSpacing: 6 }).setOrigin(0.5);
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const how = this.add.text(0, 86, touch ? 'drag anywhere to swim' : 'swim with the mouse or arrow keys', { ...TEXT, fontFamily: FONT_BODY, fontSize: '20px', color: '#e8f7ff', strokeThickness: 6 }).setOrigin(0.5);
      const play = this.button(0, 170, 'PLAY', () => this.startGame());
      const parts = [chain, title, tag, how, play].flat();
      if (this.best) parts.push(this.add.text(0, 238, `best ${group(this.best)}`, { ...TEXT, fontSize: '24px', color: '#ffd84a', strokeThickness: 7 }).setOrigin(0.5));
      card.add(parts);
      fitCard(card, k, w, 600, title);
      return [card];
    });
  }

  private showGameOver(record: boolean, animate: boolean) {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const k = this.k;
      const card = this.add.container(w / 2, h * 0.45);
      const title = this.add.text(0, -170, 'GAME OVER', { ...TEXT, fontSize: '64px', strokeThickness: 12 }).setOrigin(0.5);
      const panel = this.add.graphics();
      panel.fillStyle(0x1f6f9f, 0.35).fillRoundedRect(-200, -110 + 8, 400, 210, 26);
      panel.fillStyle(0xfff6dc, 1).fillRoundedRect(-200, -110, 400, 210, 26);
      panel.lineStyle(5, 0xf59a23, 1).strokeRoundedRect(-200, -110, 400, 210, 26);
      const label = { ...TEXT, fontSize: '24px', color: '#c27a1e', strokeThickness: 0 };
      const scoreLabel = this.add.text(0, -84, 'SCORE', label).setOrigin(0.5);
      const scoreNum = new HudNumber(this, 0, -36, 'center').set(animate ? 0 : this.score).setScale(0.55);
      const bestLabel = this.add.text(-90, 22, 'BEST', label).setOrigin(0.5);
      const bestNum = new HudNumber(this, -90, 62, 'center').set(this.best).setScale(0.36);
      const waveLabel = this.add.text(90, 22, 'WAVE', label).setOrigin(0.5);
      const waveNum = new HudNumber(this, 90, 62, 'center').set(this.wave).setScale(0.36);
      const newTag = record ? this.add.text(150, -60, 'NEW!', { ...TEXT, fontSize: '26px', color: '#e8473a', stroke: '#ffffff', strokeThickness: 6 }).setOrigin(0.5).setAngle(14) : undefined;
      const play = this.button(0, 170, 'AGAIN', () => this.startGame());
      const parts = [title, panel, scoreLabel, scoreNum, bestLabel, bestNum, waveLabel, waveNum, newTag, ...play];
      card.add(parts.filter((p): p is NonNullable<typeof p> => !!p));
      fitCard(card, k, w, 460, title);
      if (!animate) {
        this.canRestart = true;
        return [card];
      }

      play.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
      newTag?.setVisible(false);
      this.tweens.add({ targets: title, y: { from: -360, to: -170 }, duration: 450, ease: 'Back.easeOut' });
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        this.later(500 + i * 40, () => {
          scoreNum.set((this.score * i) / steps);
          playSfx(this, SFX, 'tick', { volume: 0.3 });
        });
      }
      const reveal = 500 + steps * 40 + 250;
      this.later(reveal, () => {
        this.tweens.add({ targets: scoreNum, scale: { from: 0.8, to: 0.55 }, duration: 300, ease: 'Back.easeOut' });
        if (newTag) {
          newTag.setVisible(true);
          this.tweens.add({ targets: newTag, scale: { from: 0, to: 1 }, duration: 300, ease: 'Back.easeOut' });
          playSfx(this, SFX, 'record', { volume: 0.6, detune: 0 });
          this.later(500, () => this.voice('new_highscore'));
        }
      });
      this.later(reveal + 400, () => {
        play.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(true));
        this.canRestart = true;
        this.rebuildOverlay = () => this.showGameOver(record, false);
      });
      return [card];
    });
  }

  // ---- Frame loop --------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 30);
    this.drawRays(time);
    const band = this.waterBand;
    const live = this.state === 'playing';

    if (this.state === 'playing' || this.state === 'dying') this.steer(dt, time);

    // Keep the water stocked.
    this.spawnIn -= dt;
    if (this.state !== 'over' && this.spawnIn <= 0) {
      if (this.swimmers.length < this.populationCap) this.spawn();
      this.spawnIn = Phaser.Math.FloatBetween(0.35, 0.9);
    }
    if (live && (this.stage >= 2 || this.wave >= 2)) {
      this.eelIn -= dt;
      if (this.eelIn <= 0) {
        this.warnEel();
        this.eelIn = this.eelDelay();
      }
    }
    for (const w of this.warnings) if (time >= w.until) this.releaseEel(w);
    this.warnings = this.warnings.filter((w) => time < w.until);

    const player = this.player.visible ? { x: this.px, y: this.py } : undefined;
    const me = this.playerHit();
    const safe = time < this.invulnerableUntil;
    for (const s of this.swimmers) {
      const edible = s.kind === 'fish' && s.species!.tier <= this.edibleTier;
      const stance = this.state === 'title' || s.kind !== 'fish' ? 'neutral' : edible ? 'prey' : 'predator';
      if (s.kind === 'puffer') this.puff(s, dt, player);
      s.update(dt, time, band, player, stance);
      if (!live || s.gone) continue;
      if (edible && touching(me, s.hit, FAIR_FOOD)) this.eat(s);
      else if (!edible && !safe && touching(me, s.hit, FAIR_DANGER)) {
        this.die(s);
        break;
      }
    }
    this.swimmers = this.swimmers.filter((s) => !s.gone);

    // Ease the growth bar towards the real fill; after a wave it drains back to empty.
    const fill = (this.stage + Math.min(1, this.growth / STAGE_GROWTH[this.stage])) / SPECIES.length;
    if (Math.abs(fill - this.shownFill) > 0.001) {
      this.shownFill += (fill - this.shownFill) * Math.min(1, dt * 6);
      this.drawBar();
    }
  }

  /** Puffs a pufferfish up when the player comes close, and lets it slowly go down again. */
  private puff(s: Swimmer, dt: number, player?: { x: number; y: number }) {
    const near = player && Phaser.Math.Distance.Between(s.x, s.y, player.x, player.y) < 150;
    if (near && s.puff === 0) playSfx(this, SFX, 'puff', { volume: 0.4 });
    s.puff = near ? Math.min(1, s.puff + dt * 7) : Math.max(0, s.puff - dt * 0.9);
  }

  /** Swims the player towards wherever the mouse, finger or keys point. */
  private steer(dt: number, time: number) {
    const keys = this.keys;
    if (keys) {
      const kx = (keys.right.isDown || keys.d.isDown ? 1 : 0) - (keys.left.isDown || keys.a.isDown ? 1 : 0);
      const ky = (keys.down.isDown || keys.s.isDown ? 1 : 0) - (keys.up.isDown || keys.w.isDown ? 1 : 0);
      if (kx || ky) {
        const len = Math.hypot(kx, ky);
        this.tx = this.px + (kx / len) * 160;
        this.ty = this.py + (ky / len) * 160;
        this.steeringByKeys = true;
      } else if (this.steeringByKeys) {
        this.steeringByKeys = false;
        this.tx = this.px + this.vx * 0.2;
        this.ty = this.py + this.vy * 0.2;
      }
    }
    const band = this.waterBand;
    const len = this.playerLen;
    const halfH = len * 0.35;
    this.tx = Phaser.Math.Clamp(this.tx, len / 2, this.vw - len / 2);
    this.ty = Phaser.Math.Clamp(this.ty, band.top + halfH, band.bottom - halfH);

    // Steer at a velocity towards the target, so the fish eases in rather than snapping.
    let dvx = (this.tx - this.px) * 5;
    let dvy = (this.ty - this.py) * 5;
    const sp = Math.hypot(dvx, dvy);
    if (sp > MAX_SPEED) {
      dvx *= MAX_SPEED / sp;
      dvy *= MAX_SPEED / sp;
    }
    const ease = Math.min(1, dt * 7);
    this.vx += (dvx - this.vx) * ease;
    this.vy += (dvy - this.vy) * ease;
    this.px += this.vx * dt;
    this.py += this.vy * dt;
    if (this.vx > 25) this.facing = 1;
    else if (this.vx < -25) this.facing = -1;

    // Draw: face the way it's going, tip up and down with its climb, and pulse when it eats.
    this.chomp = Math.max(0, this.chomp - dt * 6);
    const speed = Math.hypot(this.vx, this.vy);
    const base = len / this.playerBounds.w;
    const wiggle = Math.sin(time / 1000 * (8 + speed / 40)) * 0.035;
    const pop = 1 + this.chomp * 0.18;
    const tilt = Phaser.Math.Clamp(this.vy / (Math.abs(this.vx) + 160), -0.5, 0.5);
    this.player
      .setPosition(this.px, this.py)
      .setFlipX(this.facing < 0)
      .setRotation(tilt * this.facing)
      .setScale(base * pop * (1 + wiggle), base * pop * (1 - wiggle));
    const blinking = time < this.invulnerableUntil;
    this.player.setAlpha(blinking ? 0.45 + 0.45 * Math.round((Math.sin(time / 60) + 1) / 2) : 1);
    if (speed > 220 && Math.random() < dt * 6) this.bubbles.emitParticleAt(this.px - this.facing * len * 0.45, this.py);
  }
}

/**
 * Scales a card to the UI scale, or smaller if `width` (in card units) wouldn't fit across the
 * screen. Its big title is wider than the rest, so on narrow screens that shrinks on its own.
 */
function fitCard(card: Phaser.GameObjects.Container, k: number, screenW: number, width: number, title: Phaser.GameObjects.Text) {
  card.setScale(Math.min(k, (screenW - 24) / width));
  const room = (screenW - 32) / card.scale;
  if (title.width > room) title.setScale(room / title.width);
}

function group(n: number) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
