import * as Phaser from 'phaser';
import { FONT_BODY, FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { makeButton } from '@shared/ui';
import { PIXEL_FONT, SFX, SKI, T, TILE, createFont, preloadAssets, type Voice } from './assets';
import { CHUNK, KINDS, makeChunk, touches, type ChunkData, type Gate, type Thing } from './world';

type State = 'title' | 'playing' | 'caught' | 'over';

/** The skier stands this far down the screen, leaving most of it for what's coming. */
const SKIER_AT = 0.3;
/** Heading is the angle from straight downhill; this is as far round as the skis turn. */
const MAX_HEADING = 1.4;
const TURN_RATE = 5;
const KEY_TURN_RATE = 2.6;
/** How much more the pointer's sideways offset counts than its distance down the screen. */
const POINTER_SWING = 1.6;
/** Pull down the slope, in pixels a second squared. It grows the further down you get. */
const GRAVITY = 210;
const GRAVITY_GROWTH = 0.06;
const GRAVITY_MAX = 360;
const DRAG = 1;
/** Seconds lying in the snow after a crash, then blinking and passing through things. */
const CRASH_S = 0.9;
const GHOST_S = 0.8;
/** Skier's hit box: half its width and its height above the feet. */
const SKIER_HW = 3;
const SKIER_H = 3;
const GATE_STYLE = 10;
const MAX_CHAIN = 5;
const JUMP_STYLE = 15;
const MILESTONE_M = 250;
/** Where the yeti turns up, how fast he starts and how fast he gets. */
const YETI_AT_M = 450;
const YETI_SPEED = 180;
const YETI_ACCEL = 2.2;
const YETI_MAX = 340;
/** He's never more than this many screens behind. */
const YETI_LEASH = 1.6;
const OVERHEAD = 1e7;

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#3a2836',
  align: 'center',
};

interface Chunk {
  data: ChunkData;
  parts: Phaser.GameObjects.GameObject[];
  sprites: Map<Thing, Phaser.GameObjects.Image>;
  chairs: Phaser.GameObjects.Container[];
}

export class SlopeScene extends Phaser.Scene {
  private state: State = 'title';
  private world!: Phaser.GameObjects.Layer;
  private ui!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private zoom = 2;
  private seed = 1;
  private chunks = new Map<string, Chunk>();

  private snow!: Phaser.GameObjects.TileSprite;
  private tracks!: Phaser.GameObjects.Graphics;
  private trackPts: ({ x: number; y: number; h: number } | null)[] = [];
  private spray!: Phaser.GameObjects.Particles.ParticleEmitter;
  private skier!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Image;
  private frames: readonly number[] = T.skier.green;
  private x = 0;
  private y = 60;
  private heading = 0;
  private target = 0;
  private speed = 0;
  private air?: { t: number; dur: number; height: number };
  private crashT = 0;
  private ghostT = 0;
  private camX = 0;
  private lastCarve = 0;
  private steerByPointer = false;
  private keys?: Record<'left' | 'right' | 'up' | 'down' | 'a' | 'd' | 'w' | 's', Phaser.Input.Keyboard.Key>;

  private metres = 0;
  private style = 0;
  private chain = 0;
  private gatesThrough = 0;
  private nextMilestone = MILESTONE_M;
  private best = 0;
  private yeti?: { x: number; y: number; t: number; sprite: Phaser.GameObjects.Image };
  private yetiArrow!: Phaser.GameObjects.Container;

  private distText!: Phaser.GameObjects.BitmapText;
  private styleText!: Phaser.GameObjects.BitmapText;
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private overlayTimers: Phaser.Time.TimerEvent[] = [];
  private canRestart = false;
  private music?: Phaser.Sound.BaseSound;

  constructor() {
    super('slope');
  }

  preload() {
    preloadAssets(this);
  }

  // ---- Setup -------------------------------------------------------------------------------

  create() {
    createFont(this);
    this.makeTextures();
    this.world = this.add.layer();
    this.ui = this.add.layer();
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.ui);
    this.uiCam.ignore(this.world);
    this.cameras.main.setBackgroundColor(0xf2f7fd);

    this.snow = this.add.tileSprite(0, 0, 64, 64, 'snow').setOrigin(0).setDepth(-2);
    this.tracks = this.add.graphics().setDepth(-1);
    this.spray = this.add.particles(0, 0, 'flake', {
      lifespan: { min: 250, max: 450 },
      speed: { min: 20, max: 60 },
      gravityY: 60,
      alpha: { start: 1, end: 0 },
      tint: [0xffffff, 0xdbe8f7, 0xc9dcf2],
      emitting: false,
    });
    this.spray.setDepth(OVERHEAD - 10);
    this.shadow = this.add.image(0, 0, SKI, this.frames[0]).setOrigin(0.5, 1).setTint(0x9fb6d3).setAlpha(0.6).setVisible(false);
    this.skier = this.add.image(0, 0, SKI, this.frames[0]).setOrigin(0.5, 1);
    this.world.add([this.snow, this.tracks, this.spray, this.shadow, this.skier]);

    // An arrow at the top of the screen while the yeti's chasing from off it.
    const head = this.add.image(0, 0, SKI, T.yeti.roar).setScale(2);
    const bang = this.add.bitmapText(22, -10, PIXEL_FONT, '!').setTint(0xff4a3d).setScale(2);
    this.yetiArrow = this.add.container(0, 0, [head, bang]).setVisible(false);
    this.distText = this.add.bitmapText(0, 0, PIXEL_FONT, '0M').setOrigin(0.5, 0);
    this.styleText = this.add.bitmapText(0, 0, PIXEL_FONT, '').setOrigin(0.5, 0).setTint(0xffd23f);
    this.ui.add([this.yetiArrow, this.distText, this.styleText]);
    this.setHudVisible(false);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch || p.isDown) this.steerByPointer = true;
    });
    this.input.on('pointerdown', () => (this.steerByPointer = true));
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE,LEFT,RIGHT,UP,DOWN');
      this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN', a: 'A', d: 'D', w: 'W', s: 'S' }) as typeof this.keys;
      for (const key of ['SPACE', 'ENTER']) kb.on(`keydown-${key}`, (e: KeyboardEvent) => !e.repeat && this.confirm());
    }
    this.scale.on('resize', () => this.layout());

    this.best = load('downhill:best', 0);
    this.resetRun();
    this.layout();
    this.showTitle();
  }

  /** The snow: the pack's plain snow tile with a light scatter of specks, and a flake for spray. */
  private makeTextures() {
    if (this.textures.exists('snow')) return;
    const size = TILE * 8;
    const tex = this.textures.createCanvas('snow', size, size)!;
    const f = this.textures.getFrame(SKI, T.snow);
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 8; tx++) tex.context.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
    }
    const rnd = new Phaser.Math.RandomDataGenerator(['snow']);
    for (let i = 0; i < 70; i++) {
      tex.context.fillStyle = rnd.pick(['#dce8f6', '#cfdff2', '#ffffff']);
      tex.context.fillRect(rnd.between(0, size - 1), rnd.between(0, size - 1), 1, 1);
    }
    tex.refresh();
    this.make.graphics({}, false).fillStyle(0xffffff).fillRect(0, 0, 2, 2).generateTexture('flake', 2, 2).destroy();
  }

  /** Whole-number zoom keeps every pixel the same size: two on most screens, more on big ones. */
  private layout() {
    const { width: w, height: h } = this.scale;
    this.zoom = Math.max(1, Math.floor(Math.min(h / 280, w / 180)));
    // Single pixels are too small to play on anything but a short phone screen.
    if (this.zoom === 1 && h >= 480 && w >= 360) this.zoom = 2;
    this.cameras.main.setSize(w, h).setZoom(this.zoom);
    this.uiCam.setSize(w, h);
    // Centred on wide screens; top right on narrow ones, clear of the "All toys" link.
    const narrow = w < 700;
    const s = narrow ? 2 : Math.max(2, this.zoom + 1);
    const x = narrow ? w - 12 : w / 2;
    const ox = narrow ? 1 : 0.5;
    this.distText.setScale(s).setOrigin(ox, 0).setPosition(x, 10);
    this.styleText.setScale(Math.max(1, s - 1)).setOrigin(ox, 0).setPosition(x, 14 + TILE * s);
    this.followCamera(0, true);
    this.rebuildOverlay?.();
  }

  /** UI scale for cards and buttons: 1 at 1280×720, smaller on phones. */
  private get k() {
    return Math.min(this.scale.height / 720, this.scale.width / 480);
  }

  private setHudVisible(on: boolean) {
    this.distText.setVisible(on);
    this.styleText.setVisible(on);
  }

  // ---- Chunks ------------------------------------------------------------------------------

  /** Makes the chunks round the view and drops the ones well behind or to the side. */
  private updateChunks() {
    const view = this.cameras.main.worldView;
    const cx0 = Math.floor((view.x - CHUNK) / CHUNK);
    const cx1 = Math.floor((view.right + CHUNK) / CHUNK);
    const cy0 = Math.floor((view.y - CHUNK / 2) / CHUNK);
    const cy1 = Math.floor((view.bottom + CHUNK) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `${cx},${cy}`;
        if (!this.chunks.has(key)) this.chunks.set(key, this.buildChunk(makeChunk(this.seed, cx, cy)));
      }
    }
    for (const [key, c] of this.chunks) {
      const { cx, cy } = c.data;
      if (cy < cy0 - 1 || cx < cx0 - 2 || cx > cx1 + 2 || cy > cy1 + 2) {
        c.parts.forEach((p) => p.destroy());
        this.chunks.delete(key);
      }
    }
  }

  private buildChunk(data: ChunkData): Chunk {
    const chunk: Chunk = { data, parts: [], sprites: new Map(), chairs: [] };
    const add = <O extends Phaser.GameObjects.GameObject>(o: O) => (chunk.parts.push(o), o);
    for (const t of data.things) {
      const img = add(this.add.image(t.x, t.y, SKI, KINDS[t.kind].frame).setOrigin(0.5, 1).setDepth(t.y));
      chunk.sprites.set(t, img);
      if (t.kind === 'tower') {
        add(this.add.image(t.x, t.y - TILE, SKI, T.lift.pole).setOrigin(0.5, 1).setDepth(t.y));
        add(this.add.image(t.x, t.y - TILE * 2, SKI, T.lift.top).setOrigin(0.5, 1).setDepth(OVERHEAD + 1));
      }
    }
    if (data.lift !== undefined) {
      const x0 = data.cx * CHUNK;
      // The cable, with the chairs and the odd gondola hanging from it, passing over everything.
      add(this.add.tileSprite(x0, data.lift, CHUNK, TILE, SKI, T.lift.cable).setOrigin(0, 0.5).setDepth(OVERHEAD));
      for (let i = 0; i < 4; i++) {
        const gondola = (data.cx + i) % 3 === 0;
        const parts = gondola
          ? [
              this.add.image(0, 0, SKI, 45),
              ...T.lift.gondola.map((f, j) => this.add.image((j % 2 ? 8 : -8), TILE + Math.floor(j / 2) * TILE, SKI, f)),
            ]
          : [this.add.image(0, 0, SKI, T.lift.chairHanger), this.add.image(0, TILE, SKI, T.lift.chair)];
        const chair = add(this.add.container(0, data.lift, parts).setDepth(OVERHEAD + 2));
        chair.setData('offset', i * (CHUNK / 4));
        chunk.chairs.push(chair);
      }
    }
    this.world.add(chunk.parts);
    return chunk;
  }

  /** Chairs creep along the cable; every chunk has the same pattern, so they cross chunk edges smoothly. */
  private moveChairs(time: number) {
    for (const c of this.chunks.values()) {
      for (const chair of c.chairs) {
        chair.x = c.data.cx * CHUNK + Math.floor((chair.getData('offset') + time * 0.018) % CHUNK);
      }
    }
  }

  private *nearbyThings() {
    const cx = Math.floor(this.x / CHUNK);
    const cy = Math.floor(this.y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(`${cx + dx},${cy + dy}`);
        if (c) yield c;
      }
    }
  }

  // ---- Input -------------------------------------------------------------------------------

  private confirm() {
    if (this.state === 'title' || (this.state === 'over' && this.canRestart)) this.startGame();
  }

  /** Where the skier wants to point: at the mouse or finger, or turned by the keys. */
  private steer(dt: number) {
    const k = this.keys;
    const left = !!k && (k.left.isDown || k.a.isDown);
    const right = !!k && (k.right.isDown || k.d.isDown);
    const down = !!k && (k.down.isDown || k.s.isDown);
    const up = !!k && (k.up.isDown || k.w.isDown);
    if (left || right || down || up) {
      this.steerByPointer = false;
      if (down) this.target = 0;
      else if (up) this.target = (this.target < 0 ? -1 : 1) * MAX_HEADING;
      this.target = Phaser.Math.Clamp(this.target + ((right ? 1 : 0) - (left ? 1 : 0)) * KEY_TURN_RATE * dt, -MAX_HEADING, MAX_HEADING);
      return;
    }
    const p = this.input.activePointer;
    if (!this.steerByPointer || (p.wasTouch && !p.isDown)) return;
    const at = this.cameras.main.getWorldPoint(p.x, p.y);
    const dx = at.x - this.x;
    const dy = at.y - (this.y - 8);
    // Pointing at or above the skier turns the skis right across the slope, which stops them.
    // Sideways counts extra, so a tall phone screen still steers sharply.
    this.target = dy < 6 ? Math.sign(dx || 1) * MAX_HEADING : Phaser.Math.Clamp(Math.atan2(dx * POINTER_SWING, dy), -MAX_HEADING, MAX_HEADING);
  }

  // ---- Game flow ---------------------------------------------------------------------------

  /** A fresh slope and a skier at the top of it. */
  private resetRun() {
    for (const c of this.chunks.values()) c.parts.forEach((p) => p.destroy());
    this.chunks.clear();
    this.seed = Math.floor(Math.random() * 1e9);
    this.frames = Math.random() < 0.5 ? T.skier.green : T.skier.blue;
    this.x = 0;
    this.y = 60;
    this.heading = this.target = 0;
    this.speed = 0;
    this.air = undefined;
    this.crashT = this.ghostT = 0;
    this.camX = 0;
    this.trackPts = [];
    this.metres = 0;
    this.style = 0;
    this.chain = 0;
    this.gatesThrough = 0;
    this.nextMilestone = MILESTONE_M;
    this.yeti?.sprite.destroy();
    this.yeti = undefined;
    this.yetiArrow.setVisible(false);
    this.skier.setFrame(this.frames[0]).setVisible(true).setAngle(0).setAlpha(1).setScale(1);
    this.followCamera(0, true);
    this.updateChunks();
  }

  private startGame() {
    playSfx(this, SFX, 'click');
    this.setOverlay();
    if (this.state === 'over') this.resetRun();
    this.state = 'playing';
    this.canRestart = false;
    this.distText.setText('0M');
    this.styleText.setText('');
    this.setHudVisible(true);
    this.banner('GO!');
    this.voice('go');
    this.music ??= this.sound.add('music', { loop: true, volume: 0.3 });
    if (!this.music.isPlaying) this.music.play();
  }

  private get score() {
    return this.metres + this.style;
  }

  private caught() {
    this.state = 'caught';
    const yeti = this.yeti!;
    this.skier.setVisible(false);
    this.shadow.setVisible(false);
    this.music?.stop();
    playSfx(this, SFX, 'roar', { volume: 0.7, detune: -200 });
    playSfx(this, SFX, 'rumble', { volume: 0.5 });
    this.cameras.main.shake(300, 0.01);
    // The yeti's victory dance, as in the original: stomping and waving his arms.
    yeti.sprite.setPosition(Math.round(this.x), Math.round(this.y)).setDepth(this.y);
    let n = 0;
    this.time.addEvent({
      delay: 160,
      repeat: 11,
      callback: () => {
        n++;
        yeti.sprite.setFrame(n % 2 ? T.yeti.roar : T.yeti.run[0]).setFlipX(n % 4 < 2);
        yeti.sprite.y = Math.round(this.y) - (n % 2 ? 3 : 0);
        if (n % 4 === 0) playSfx(this, SFX, 'thud', { volume: 0.3 });
      },
    });
    this.time.delayedCall(700, () => this.voice('game_over'));
    this.time.delayedCall(2100, () => this.endGame());
  }

  private endGame() {
    this.state = 'over';
    const previous = this.best;
    const { best, isNew } = submitHighScore('downhill', this.score);
    this.best = best;
    this.showGameOver(isNew && previous > 0, true);
  }

  // ---- Frame loop --------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 30);
    if (this.state === 'playing') {
      this.steer(dt);
      // Small steps, so a fast skier on a slow frame can't skip clean through a tree trunk,
      // and a 60Hz screen plays the same as a 120Hz one.
      const steps = Math.ceil(dt * 120 - 1e-6);
      for (let i = 0; i < steps && this.state === 'playing'; i++) {
        this.ski(dt / steps, time);
        this.checkThings();
      }
      this.updateYeti(dt, time);
      this.updateScore();
    } else if (this.state === 'title') {
      // Waiting at the top: just the poles twitching.
      this.skier.setFrame(this.frames[Math.floor(time / 600) % 2]);
    }
    this.followCamera(dt, false);
    this.updateChunks();
    this.moveChairs(time);
    this.drawSkier();
    this.drawTracks();
    this.placeSnow();
  }

  private ski(dt: number, time: number) {
    if (this.crashT > 0) {
      this.crashT -= dt;
      this.speed = Math.max(0, this.speed - 600 * dt);
      if (this.crashT <= 0) this.getUp();
      return;
    }
    this.ghostT = Math.max(0, this.ghostT - dt);

    const before = this.heading;
    const turn = Phaser.Math.Clamp(this.target - this.heading, -TURN_RATE * dt, TURN_RATE * dt);
    if (!this.air) this.heading += turn;
    const gravity = Math.min(GRAVITY_MAX, GRAVITY + this.metres * GRAVITY_GROWTH);
    // Pointing downhill speeds you up; across the slope, drag wins and you slow to a stop.
    this.speed = Math.max(0, this.speed + (gravity * Math.cos(this.heading) - DRAG * this.speed) * dt);
    const prevY = this.y;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.y += Math.cos(this.heading) * this.speed * dt;
    this.checkGates(prevY);

    if (this.air) {
      this.air.t += dt;
      if (this.air.t >= this.air.dur) this.land();
    } else {
      // Carving hard throws up snow, and makes a crunch now and then.
      const carve = Math.abs(this.heading - before) / dt;
      // About 60 or 120 flakes a second, whatever the frame rate.
      if (carve > 1.5 && this.speed > 70 && Math.random() < dt * 60) {
        this.spray.emitParticleAt(this.x - Math.sin(this.heading) * 3, this.y - 1, carve > 3 ? 2 : 1);
        if (time - this.lastCarve > 260) {
          this.lastCarve = time;
          playSfx(this, SFX, 'carve', { volume: Math.min(0.5, this.speed / 500) });
        }
      }
      this.addTrack();
    }
  }

  private addTrack() {
    const last = this.trackPts[this.trackPts.length - 1];
    if (last && Math.hypot(last.x - this.x, last.y - this.y) < 3) return;
    this.trackPts.push({ x: this.x, y: this.y, h: this.heading });
    if (this.trackPts.length > 400) this.trackPts.splice(0, this.trackPts.length - 400);
  }

  /** Two thin lines behind the skis, broken where the skier was in the air. */
  private drawTracks() {
    const g = this.tracks.clear();
    g.lineStyle(1, 0xc3d4ea, 1);
    for (const side of [-2, 2]) {
      g.beginPath();
      let pen = false;
      for (const p of this.trackPts) {
        if (!p) {
          pen = false;
          continue;
        }
        const x = p.x + Math.cos(p.h) * side;
        const y = p.y - 1 - Math.sin(p.h) * side;
        if (pen) g.lineTo(x, y);
        else g.moveTo(x, y);
        pen = true;
      }
      g.strokePath();
    }
  }

  private checkThings() {
    if (this.crashT > 0) return;
    for (const c of this.nearbyThings()) {
      for (const t of c.data.things) {
        if (!touches(t, this.x, this.y, SKIER_HW, SKIER_H)) continue;
        const effect = KINDS[t.kind].effect;
        if (effect === 'jump') {
          if (!this.air) this.jump();
        } else if (!this.air && this.ghostT <= 0) {
          this.crash(c.sprites.get(t));
          return;
        }
      }
    }
  }

  private checkGates(prevY: number) {
    for (const c of this.nearbyThings()) {
      for (const g of c.data.gates) {
        if (g.done || prevY >= g.y || this.y < g.y) continue;
        if (this.x > g.left && this.x < g.right) this.throughGate(g, c);
        else {
          g.done = 'missed';
          if (this.chain > 1) this.popup('MISS', 0xa8b8cc);
          this.chain = 0;
        }
      }
    }
  }

  private throughGate(g: Gate, c: Chunk) {
    g.done = 'through';
    this.chain = Math.min(MAX_CHAIN, this.chain + 1);
    this.gatesThrough++;
    const points = GATE_STYLE * this.chain;
    this.style += points;
    this.speed *= 1.06;
    playSfx(this, SFX, 'gate', { volume: 0.4, detune: (this.chain - 1) * 150 });
    this.popup(this.chain > 1 ? `+${points} X${this.chain}` : `+${points}`, 0xffd23f);
    for (const [t, img] of c.sprites) {
      if ((t.kind === 'flagRed' || t.kind === 'flagBlue') && t.y === g.y && (t.x === g.left || t.x === g.right)) {
        this.tweens.add({ targets: img, y: img.y - 3, duration: 90, yoyo: true, repeat: 1 });
      }
    }
  }

  private jump() {
    this.speed *= 1.12;
    this.air = { t: 0, dur: 0.5 + this.speed / 600, height: 10 + this.speed / 18 };
    this.trackPts.push(null);
    playSfx(this, SFX, 'jump', { volume: 0.4 });
  }

  private land() {
    this.air = undefined;
    this.style += JUMP_STYLE;
    this.popup(`+${JUMP_STYLE}`, 0x8fe3ff);
    playSfx(this, SFX, 'carve', { volume: 0.5 });
    this.spray.emitParticleAt(this.x, this.y - 1, 6);
    // Landing on something still counts as hitting it.
    this.checkThings();
  }

  private crash(img?: Phaser.GameObjects.Image) {
    this.crashT = CRASH_S;
    this.chain = 0;
    this.speed *= 0.3;
    playSfx(this, SFX, 'crash', { volume: 0.6 });
    playSfx(this, SFX, 'ouch', { volume: 0.35 });
    this.spray.emitParticleAt(this.x, this.y - 4, 10);
    this.cameras.main.shake(120, 0.004);
    if (img && !this.tweens.isTweening(img)) this.tweens.add({ targets: img, angle: { from: -12, to: 12 }, duration: 70, yoyo: true, repeat: 2, onComplete: () => img.setAngle(0) });
    // The tumble: spin over and land flat.
    this.tweens.killTweensOf(this.skier);
    this.skier.setAngle(0);
    this.tweens.add({ targets: this.skier, angle: this.heading >= 0 ? 450 : -450, duration: 350, ease: 'Quad.easeOut' });
  }

  private getUp() {
    this.tweens.killTweensOf(this.skier);
    this.skier.setAngle(0);
    this.ghostT = GHOST_S;
    // Back on your feet pointing across the slope, so you don't slide straight into it again.
    this.heading = this.target = (this.heading >= 0 ? 1 : -1) * 0.9;
  }

  private drawSkier() {
    const crashed = this.crashT > 0;
    const air = this.air ? Math.sin((Math.PI * this.air.t) / this.air.dur) : 0;
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    // Poles pushing when slow, tucked when fast.
    const push = this.speed < 90 && !crashed && this.state === 'playing';
    this.skier.setFrame(this.frames[push ? Math.floor(this.time.now / 180) % 2 : 0]);
    this.skier.setPosition(x, y - Math.round(air * (this.air?.height ?? 0))).setDepth(y + (this.air ? OVERHEAD / 2 : 0));
    this.skier.setScale(1 + air * 0.35);
    // The pack only draws the skier from the front, so lean them into the turn instead.
    if (!crashed && !this.tweens.isTweening(this.skier)) this.skier.setAngle(Phaser.Math.RadToDeg(-this.heading) * 0.45);
    this.skier.setAlpha(this.ghostT > 0 && Math.floor(this.time.now / 80) % 2 ? 0.35 : 1);
    this.shadow.setVisible(!!this.air).setPosition(x, y).setFrame(this.skier.frame.name).setDepth(y - 0.5).setScale(1 - air * 0.2, 0.4);
  }

  private followCamera(dt: number, snap: boolean) {
    const cam = this.cameras.main;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const lead = Math.sin(this.heading) * Math.min(1, this.speed / 200) * viewW * 0.12;
    const want = this.x + lead;
    this.camX = snap ? want : this.camX + (want - this.camX) * Math.min(1, dt * 3);
    cam.centerOn(Math.round(this.camX), Math.round(this.y + viewH * (0.5 - SKIER_AT)));
  }

  /** The snow sits under the view, lined up with the tiles so it never seems to slide. */
  private placeSnow() {
    const view = this.cameras.main.worldView;
    const step = TILE * 8;
    const x = Math.floor(view.x / step) * step;
    const y = Math.floor(view.y / step) * step;
    this.snow.setPosition(x, y).setSize(view.width + step * 2, view.height + step * 2);
  }

  // ---- Yeti --------------------------------------------------------------------------------

  private updateYeti(dt: number, time: number) {
    if (!this.yeti) {
      if (this.metres < YETI_AT_M) return;
      const view = this.cameras.main.worldView;
      const sprite = this.add.image(0, 0, SKI, T.yeti.run[0]).setOrigin(0.5, 1);
      this.world.add(sprite);
      this.yeti = { x: this.x + Phaser.Math.Between(-60, 60), y: view.y - 30, t: 0, sprite };
      this.voice('war_look_out');
      playSfx(this, SFX, 'roar', { volume: 0.6 });
      this.banner('YETI!');
    }
    const yeti = this.yeti;
    yeti.t += dt;
    const viewH = this.cameras.main.height / this.cameras.main.zoom;
    const speed = Math.min(YETI_MAX, YETI_SPEED + yeti.t * YETI_ACCEL);
    const dx = this.x - yeti.x;
    const dy = this.y - yeti.y;
    const d = Math.hypot(dx, dy);
    if (d < 9) {
      this.caught();
      return;
    }
    const stepLen = Math.min(d, speed * dt);
    yeti.x += (dx / d) * stepLen;
    yeti.y += (dy / d) * stepLen;
    // He can't be shaken off: if you get far enough ahead, he's always just off the top of the screen.
    yeti.y = Math.max(yeti.y, this.y - viewH * YETI_LEASH);
    const near = d < 70;
    const frame = near && Math.floor(time / 300) % 2 ? T.yeti.roar : T.yeti.run[Math.floor(time / 120) % 2];
    yeti.sprite.setFrame(frame).setPosition(Math.round(yeti.x), Math.round(yeti.y)).setDepth(yeti.y).setFlipX(dx < 0);
    if (near && Math.floor(time / 300) !== Math.floor((time - dt * 1000) / 300) && Math.floor(time / 300) % 4 === 1) playSfx(this, SFX, 'roar', { volume: 0.35 });

    // An arrow at the top edge while he's above the screen.
    const cam = this.cameras.main;
    const top = cam.worldView.y;
    const off = yeti.y - 16 < top;
    this.yetiArrow.setVisible(off);
    if (off) {
      const sx = Phaser.Math.Clamp((yeti.x - cam.worldView.x) * cam.zoom, 40, this.scale.width - 40);
      this.yetiArrow.setPosition(sx, 70 + Math.sin(time / 120) * 3).setScale(Math.max(1, this.zoom - 1));
    }
  }

  // ---- HUD and popups ----------------------------------------------------------------------

  private updateScore() {
    const m = Math.max(0, Math.floor((this.y - 60) / TILE));
    if (m <= this.metres) return;
    this.metres = m;
    this.distText.setText(`${m}M`);
    if (this.style > 0) this.styleText.setText(`STYLE ${this.style}`);
    if (m >= this.nextMilestone) {
      this.nextMilestone += MILESTONE_M;
      playSfx(this, SFX, 'milestone', { volume: 0.4 });
      this.tweens.add({ targets: this.distText, scale: { from: this.distText.scale * 1.4, to: this.distText.scale }, duration: 300, ease: 'Back.easeOut' });
    }
  }

  /** A few pixel letters rising off the skier. */
  private popup(text: string, tint: number) {
    const cam = this.cameras.main;
    const sx = (this.x - cam.worldView.x) * cam.zoom;
    const sy = (this.y - 20 - cam.worldView.y) * cam.zoom;
    const label = this.add.bitmapText(sx, sy, PIXEL_FONT, text).setOrigin(0.5, 1).setTint(tint).setScale(Math.max(1, this.zoom - 1));
    this.ui.add(label);
    this.tweens.add({ targets: label, y: sy - 40, alpha: 0, duration: 800, ease: 'Quad.easeOut', onComplete: () => label.destroy() });
  }

  private banner(text: string) {
    const { width: w, height: h } = this.scale;
    const s = Math.max(3, this.zoom * 2);
    const label = this.add.bitmapText(w / 2, h * 0.45, PIXEL_FONT, text).setOrigin(0.5).setScale(0);
    this.ui.add(label);
    this.tweens.add({ targets: label, scale: s, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({ targets: label, alpha: 0, duration: 400, delay: 900, onComplete: () => label.destroy() });
  }

  private voice(name: Voice) {
    this.sound.play(`voice:${name}`, { volume: 0.9 });
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
    return makeButton(this, x, y, label, onClick, { textStyle: TEXT, color: 0xe2483d, onPress: () => playSfx(this, SFX, 'click') }).parts;
  }

  /** Like the shared fitCard, but for a pixel-font title, which keeps its own scale. */
  private fitCard(card: Phaser.GameObjects.Container, width: number, title: Phaser.GameObjects.BitmapText) {
    const w = this.scale.width;
    card.setScale(Math.min(this.k, (w - 24) / width));
    const room = (w - 32) / card.scale;
    if (title.width > room) title.setScale(title.scale * (room / title.width));
  }

  private showTitle() {
    this.state = 'title';
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.6);
      const panel = this.add.graphics();
      panel.fillStyle(0x3a2836, 0.55).fillRoundedRect(-290, -110, 580, 140, 24);
      const title = this.add.bitmapText(0, -170, PIXEL_FONT, 'DOWNHILL').setOrigin(0.5).setScale(6);
      this.tweens.add({ targets: title, y: -176, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const tag = this.add
        .text(0, -78, touch ? 'Hold your finger where you want to go' : 'Point the mouse where you want to go, or use the arrow keys', {
          ...TEXT,
          fontFamily: FONT_BODY,
          fontSize: '22px',
          strokeThickness: 7,
          wordWrap: { width: 520 },
        })
        .setOrigin(0.5);
      const yeti = this.add.image(-150, -6, SKI, T.yeti.roar).setScale(3);
      this.tweens.add({ targets: yeti, y: -12, duration: 220, yoyo: true, repeat: -1 });
      const warn = this.add
        .text(-110, -6, '...and keep ahead of the yeti!', { ...TEXT, fontFamily: FONT_BODY, fontSize: '22px', color: '#ffd0cc', strokeThickness: 7 })
        .setOrigin(0, 0.5);
      const play = this.button(0, 80, 'SKI!', () => this.startGame());
      const parts: Phaser.GameObjects.GameObject[] = [panel, title, tag, yeti, warn, ...play];
      if (this.best) parts.push(this.add.text(0, 148, `best ${this.best}`, { ...TEXT, fontSize: '24px', color: '#ffd23f', strokeThickness: 7 }).setOrigin(0.5));
      card.add(parts);
      this.fitCard(card, 620, title);
      return [card];
    });
  }

  private showGameOver(record: boolean, animate: boolean) {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.5);
      const title = this.add.bitmapText(0, -190, PIXEL_FONT, 'GOBBLED!').setOrigin(0.5).setScale(5).setTint(0xffd0cc);
      const panel = this.add.graphics();
      panel.fillStyle(0x000000, 0.25).fillRoundedRect(-240, -122, 480, 236, 26);
      panel.fillStyle(0x3a2836, 0.92).fillRoundedRect(-240, -130, 480, 236, 26);
      panel.lineStyle(4, 0xa8c4e6, 1).strokeRoundedRect(-240, -130, 480, 236, 26);
      const label = { ...TEXT, fontSize: '22px', color: '#a8c4e6', strokeThickness: 0 };
      const big = { ...TEXT, fontSize: '52px', color: '#ffd23f', strokeThickness: 8 };
      const small = { ...big, fontSize: '30px', color: '#ffffff' };
      const scoreLabel = this.add.text(0, -108, 'SCORE', label).setOrigin(0.5);
      const scoreNum = this.add.text(0, -60, animate ? '0' : `${this.score}`, big).setOrigin(0.5);
      const cols = [
        ['DISTANCE', `${this.metres}m`],
        ['STYLE', `${this.style}`],
        ['BEST', `${this.best}`],
      ].flatMap(([name, value], i) => [
        this.add.text((i - 1) * 150, 2, name, label).setOrigin(0.5),
        this.add.text((i - 1) * 150, 40, value, small).setOrigin(0.5),
      ]);
      const newTag = record ? this.add.text(170, -82, 'NEW!', { ...TEXT, fontSize: '26px', color: '#e2483d', stroke: '#ffffff', strokeThickness: 6 }).setOrigin(0.5).setAngle(14) : undefined;
      const again = this.button(0, 170, 'AGAIN', () => this.startGame());
      const parts = [title, panel, scoreLabel, scoreNum, ...cols, newTag, ...again];
      card.add(parts.filter((p): p is NonNullable<typeof p> => !!p));
      this.fitCard(card, 500, title);
      if (!animate) {
        this.canRestart = true;
        return [this.add.rectangle(0, 0, w, h, 0x3a2836, 0.3).setOrigin(0), card];
      }

      again.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
      newTag?.setVisible(false);
      this.tweens.add({ targets: title, y: { from: -380, to: -190 }, duration: 450, ease: 'Back.easeOut' });
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        this.later(400 + i * 40, () => {
          scoreNum.setText(`${Math.round((this.score * i) / steps)}`);
          playSfx(this, SFX, 'tick', { volume: 0.3 });
        });
      }
      const reveal = 400 + steps * 40 + 250;
      this.later(reveal, () => {
        this.tweens.add({ targets: scoreNum, scale: { from: 1.4, to: 1 }, duration: 300, ease: 'Back.easeOut' });
        if (newTag) {
          newTag.setVisible(true);
          this.tweens.add({ targets: newTag, scale: { from: 0, to: 1 }, duration: 300, ease: 'Back.easeOut' });
          playSfx(this, SFX, 'record', { volume: 0.6, detune: 0 });
          this.later(500, () => this.voice('new_highscore'));
        }
      });
      this.later(reveal + 400, () => {
        again.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(true));
        this.canRestart = true;
        this.rebuildOverlay = () => this.showGameOver(record, false);
      });
      // Dim the slope behind the card so it reads.
      const shade = this.add.rectangle(0, 0, w, h, 0x3a2836, 0.3).setOrigin(0);
      return [shade, card];
    });
  }
}
