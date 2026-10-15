import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { PIXEL_FONT, RAMP, SFX, SKI, T, TILE, createFont, createRamp, preloadAssets, type Voice } from './assets';
import { CHUNK, KINDS, difficulty, makeChunk, onPiste, touches, type ChunkData, type Gate, type Thing } from './world';

type State = 'title' | 'playing' | 'caught' | 'over';

/** The skier stands this far down the screen, leaving most of it for what's coming. */
const SKIER_AT = 0.25;
/** Heading is the angle from straight downhill; this is as far round as the skis turn. */
const MAX_HEADING = 1.4;
/** Holding a key turns the skis this far; letting go swings them back downhill. */
const KEY_HEADING = 1.05;
/** How quickly the skis swing round, in radians a second, easing in at the end. */
const TURN_RATE = 6;
const TURN_EASE = 14;
/** How much more the pointer's sideways offset counts than its distance down the screen. */
const POINTER_SWING = 1.6;
/** Top speed pointing straight downhill, in pixels a second, from the top to the hardest part. */
const TOP_SPEED = 200;
const TOP_SPEED_MAX = 370;
/** Deep snow off the piste holds you back to this share of it. */
const DEEP_SNOW = 0.65;
/** Across the slope you keep this share of it, so traversing round trees doesn't stall you. */
const TRAVERSE_SPEED = 0.5;
const TUCK = 1.15;
/** How fast speed closes on its target: picking up, slowing down and digging in to brake. */
const ACCEL = 1.5;
const SLOW = 2.5;
const BRAKE = 4;
/** A push on the poles: a kick of speed, a while skiing faster than the slope alone allows, and a rest. */
const PUSH_KICK = 35;
const PUSH_BOOST = 0.15;
const PUSH_S = 0.45;
const PUSH_REST_S = 0.35;
/** Seconds lying in the snow after a crash, then blinking and passing through things. */
const CRASH_S = 0.9;
const GHOST_S = 0.8;
/** Skier's hit box: half its width and its height above the feet. */
const SKIER_HW = 3;
const SKIER_H = 3;
const GATE_STYLE = 5;
const MAX_CHAIN = 5;
const JUMP_STYLE = 15;
const MILESTONE_M = 250;
/**
 * Where the yeti turns up. His speed is a share of the skier's top speed there: slower than a clean
 * run at first, so only crashes let him close in, then creeping up until he's faster than anyone.
 */
const YETI_AT_M = 600;
const YETI_SPEED = 0.7;
const YETI_ACCEL = 0.004;
const YETI_MAX = 1.2;
/** He's never more than this many screens behind. */
const YETI_LEASH = 1.6;
const OVERHEAD = 1e7;
const INK = 0x3a2836;
const PALE = 0xa8c4e6;
const GOLD = 0xffd23f;

interface Chunk {
  data: ChunkData;
  parts: Phaser.GameObjects.GameObject[];
  sprites: Map<Thing, Phaser.GameObjects.Image>;
  chairs: Phaser.GameObjects.Container[];
  map: Phaser.Tilemaps.Tilemap;
}

export class SlopeScene extends Phaser.Scene {
  private state: State = 'title';
  private world!: Phaser.GameObjects.Layer;
  private ui!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private zoom = 2;
  private seed = 1;
  private chunks = new Map<string, Chunk>();

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
  private braking = false;
  private tucking = false;
  private speed = 0;
  private air?: { t: number; dur: number; height: number };
  private crashT = 0;
  private ghostT = 0;
  private camX = 0;
  private lastCarve = 0;
  private sprayAngle = 90;
  private sprayVel = { x: 0, y: 0 };
  private pushT = 0;
  private pushRest = 0;
  private deep = false;
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
    createRamp(this);
    this.makeTextures();
    this.world = this.add.layer();
    this.ui = this.add.layer();
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.ui);
    this.uiCam.ignore(this.world);
    this.cameras.main.setBackgroundColor(0xcfe7f7);

    this.tracks = this.add.graphics().setDepth(-1);
    // Snow thrown off the skis, mostly to the outside of a turn.
    this.spray = this.add.particles(0, 0, 'flake', {
      frame: ['fleck', 'fleck', 'clump'],
      lifespan: { min: 350, max: 750 },
      // Flakes keep most of the skier's speed, so the spray streams along the line of the turn
      // instead of being left behind; on top, they fly out at the spray angle.
      speedX: { onEmit: () => this.flakeVelocity().x },
      speedY: { onEmit: () => this.sprayVel.y },
      gravityY: 40,
      alpha: { start: 1, end: 0, ease: 'Quad.easeIn' },
      // White to show on the deep snow, blue-grey to show on the piste.
      tint: [0xffffff, 0xffffff, 0xdbe7f5, 0xb4cbe6, 0x9db6d8],
      emitting: false,
    });
    this.spray.setDepth(OVERHEAD - 10);
    this.shadow = this.add.image(0, 0, 'shadow').setOrigin(0.5, 1).setVisible(false);
    this.skier = this.add.image(0, 0, SKI, this.frames[0]).setOrigin(0.5, 1);
    this.world.add([this.tracks, this.spray, this.shadow, this.skier]);

    // An arrow at the top of the screen while the yeti's chasing from off it.
    const head = this.add.image(0, 0, SKI, T.yeti.roar).setScale(2);
    const bang = this.add.bitmapText(22, -10, PIXEL_FONT, '!').setTint(0xff4a3d).setScale(2);
    this.yetiArrow = this.add.container(0, 0, [head, bang]).setVisible(false);
    this.distText = this.add.bitmapText(0, 0, PIXEL_FONT, '0M').setOrigin(0.5, 0);
    this.styleText = this.add.bitmapText(0, 0, PIXEL_FONT, '').setOrigin(0.5, 0).setTint(0xffd23f);
    this.ui.add([this.yetiArrow, this.distText, this.styleText]);
    this.setHudVisible(false);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch || p.isDown) this.steerByPointer = this.state === 'playing';
    });
    this.input.on('pointerdown', () => {
      this.steerByPointer = this.state === 'playing';
      this.push();
    });
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE,LEFT,RIGHT,UP,DOWN');
      this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN', a: 'A', d: 'D', w: 'W', s: 'S' }) as typeof this.keys;
      for (const key of ['SPACE', 'ENTER']) kb.on(`keydown-${key}`, (e: KeyboardEvent) => !e.repeat && (this.state === 'playing' ? this.push() : this.confirm()));
    }
    this.scale.on('resize', () => this.layout());

    this.best = load('downhill:best', 0);
    this.resetRun();
    this.layout();
    this.showTitle();
  }

  /** Snow flakes for the spray, and a shadow for jumps. */
  private makeTextures() {
    if (this.textures.exists('flake')) return;
    // Two sizes of flake: a fleck and a three-pixel clump.
    const flakes = this.textures.createCanvas('flake', 7, 3)!;
    flakes.context.fillStyle = '#ffffff';
    flakes.context.fillRect(0, 0, 2, 2);
    flakes.context.fillRect(4, 1, 3, 1);
    flakes.context.fillRect(5, 0, 1, 3);
    flakes.refresh();
    flakes.add('fleck', 0, 0, 0, 2, 2);
    flakes.add('clump', 0, 4, 0, 3, 3);
    // A pixel oval under the skier in the air.
    this.make.graphics({}, false).fillStyle(0xb7cbe4).fillRect(2, 0, 8, 3).fillRect(0, 1, 12, 1).generateTexture('shadow', 12, 3).destroy();
  }

  /** Whole-number zoom keeps every pixel the same size: two on most screens, more on big ones. */
  private layout() {
    const { width: w, height: h } = this.scale;
    // Zoomed out enough to see a good second or so of slope ahead.
    this.zoom = Math.max(1, Math.floor(Math.min(h / 400, w / 260)));
    // Single pixels are too small to play on anything but a short phone screen.
    if (this.zoom === 1 && h >= 480 && w >= 360) this.zoom = 2;
    this.cameras.main.setSize(w, h).setZoom(this.zoom);
    this.uiCam.setSize(w, h);
    // Top right, clear of the "All toys" link and of the strip above the skier where the yeti comes from.
    const s = w < 700 ? 2 : this.zoom + 1;
    this.distText.setScale(s).setOrigin(1, 0).setPosition(w - 14, 12);
    this.styleText.setScale(Math.max(2, s - 1)).setOrigin(1, 0).setPosition(w - 14, 16 + TILE * s);
    this.followCamera(0, true);
    this.rebuildOverlay?.();
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
        this.dropChunk(c);
        this.chunks.delete(key);
      }
    }
  }

  private buildChunk(data: ChunkData): Chunk {
    // The terrain, as a little tilemap of the pack's tiles.
    const map = this.make.tilemap({ data: data.tiles, tileWidth: TILE, tileHeight: TILE });
    const tileset = map.addTilesetImage(SKI)!;
    const ground = map.createLayer(0, tileset, data.cx * CHUNK, data.cy * CHUNK)!.setDepth(-2);
    const chunk: Chunk = { data, parts: [ground], sprites: new Map(), chairs: [], map };
    const add = <O extends Phaser.GameObjects.GameObject>(o: O) => (chunk.parts.push(o), o);
    for (const t of data.things) {
      const img = add((t.kind === 'ramp' ? this.add.image(t.x, t.y, RAMP) : this.add.image(t.x, t.y, SKI, KINDS[t.kind].frame)).setOrigin(0.5, 1).setDepth(t.y));
      chunk.sprites.set(t, img);
      const top = (KINDS[t.kind] as { top?: number }).top;
      if (top !== undefined) img.setData('top', add(this.add.image(t.x, t.y - TILE, SKI, top).setOrigin(0.5, 1).setDepth(t.y)));
      if (t.kind === 'tower') {
        add(this.add.image(t.x, t.y - TILE, SKI, T.lift.pole).setOrigin(0.5, 1).setDepth(t.y));
        add(this.add.image(t.x, t.y - TILE * 2, SKI, T.lift.top).setOrigin(0.5, 1).setDepth(OVERHEAD + 1));
      }
    }
    if (data.lift !== undefined) {
      const x0 = data.cx * CHUNK;
      // The cable, with the chairs and the odd gondola hanging from it, passing over everything,
      // and its shadow on the snow below, as in the pack's sample map.
      add(this.add.tileSprite(x0, data.lift, CHUNK, TILE, SKI, T.lift.cable).setOrigin(0, 0.5).setDepth(OVERHEAD));
      add(this.add.tileSprite(x0, data.lift + 40, CHUNK, TILE, SKI, T.lift.shadow).setOrigin(0, 1).setDepth(-1.5));
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

  private dropChunk(c: Chunk) {
    c.parts.forEach((p) => p.destroy());
    c.map.destroy();
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

  /** A push on the poles: only on the snow, and not again straight away. */
  private push() {
    if (this.state !== 'playing' || this.crashT > 0 || this.air || this.pushRest > 0) return;
    this.pushT = PUSH_S;
    this.pushRest = PUSH_S + PUSH_REST_S;
    this.speed = Math.min(this.speed + PUSH_KICK, this.topSpeed * (1 + PUSH_BOOST));
    playSfx(this, SFX, 'whoosh', { volume: 0.25, detune: Phaser.Math.Between(-200, 200) });
    // A kick of snow off the back of the skis.
    this.sprayAngle = 270 - Phaser.Math.RadToDeg(this.heading);
    this.spray.emitParticleAt(this.x, this.y - 1, 6);
  }

  /** A random flake velocity: the skier's, mostly, plus a throw at the spray angle. */
  private flakeVelocity() {
    const a = Phaser.Math.DegToRad(this.sprayAngle + Phaser.Math.Between(-25, 25));
    const throwSpeed = Phaser.Math.Between(40, 140);
    const carry = 0.75;
    this.sprayVel.x = Math.sin(this.heading) * this.speed * carry + Math.cos(a) * throwSpeed;
    this.sprayVel.y = Math.cos(this.heading) * this.speed * carry + Math.sin(a) * throwSpeed;
    return this.sprayVel;
  }

  private confirm() {
    if (this.state === 'title' || (this.state === 'over' && this.canRestart)) this.startGame();
  }

  /**
   * Where the skier wants to point, and whether they're braking. Keys turn the skis while held and
   * let them swing back downhill after; up digs in to brake and down tucks for speed. The mouse or a
   * held finger points the way, and pointing above the skier turns them across the slope to stop.
   */
  private steer() {
    const k = this.keys;
    const left = !!k && (k.left.isDown || k.a.isDown);
    const right = !!k && (k.right.isDown || k.d.isDown);
    const down = !!k && (k.down.isDown || k.s.isDown);
    const up = !!k && (k.up.isDown || k.w.isDown);
    this.braking = this.tucking = false;
    if (left || right || down || up) {
      this.steerByPointer = false;
      const side = (right ? 1 : 0) - (left ? 1 : 0);
      this.target = side * (up ? MAX_HEADING : KEY_HEADING);
      this.braking = up;
      this.tucking = down && !up;
      return;
    }
    const p = this.input.activePointer;
    if (!this.steerByPointer || (p.wasTouch && !p.isDown)) {
      // Nothing held: let the skis run back downhill.
      this.target = 0;
      return;
    }
    const at = this.cameras.main.getWorldPoint(p.x, p.y);
    const dx = at.x - this.x;
    const dy = at.y - (this.y - 6);
    if (dy < 0) {
      this.braking = true;
      this.target = Math.sign(dx || this.heading || 1) * MAX_HEADING;
    } else {
      // Measured from a little way below the skier, so a pointer close by doesn't swing them wildly.
      this.target = Math.abs(dx) < 3 ? 0 : Phaser.Math.Clamp(Math.atan2(dx * POINTER_SWING, Math.max(dy, 40)), -MAX_HEADING, MAX_HEADING);
    }
  }

  // ---- Game flow ---------------------------------------------------------------------------

  /** A fresh slope and a skier at the top of it. */
  private resetRun() {
    for (const c of this.chunks.values()) this.dropChunk(c);
    this.chunks.clear();
    this.seed = Math.floor(Math.random() * 1e9);
    this.frames = Math.random() < 0.5 ? T.skier.green : T.skier.blue;
    this.x = 0;
    this.y = 60;
    this.heading = this.target = 0;
    this.braking = this.tucking = false;
    this.speed = 0;
    this.pushT = this.pushRest = 0;
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
    this.skier.setFrame(this.frames[0]).setVisible(true).setAngle(0).setAlpha(1);
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
    this.steerByPointer = false;
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
    this.setHudVisible(false);
    this.yetiArrow.setVisible(false);
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
      this.steer();
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
    const turn = Phaser.Math.Clamp((this.target - this.heading) * TURN_EASE * dt, -TURN_RATE * dt, TURN_RATE * dt);
    if (!this.air) this.heading += turn;
    // Speed closes on a target set by where the skis point: fastest straight down, slower across.
    this.deep = !this.air && !onPiste(this.seed, this.x, this.y);
    const top = this.topSpeed * (this.deep ? DEEP_SNOW : 1);
    let want = this.braking && !this.air ? 0 : top * (TRAVERSE_SPEED + (1 - TRAVERSE_SPEED) * Math.cos(this.heading)) * (this.tucking ? TUCK : 1);
    this.pushT = Math.max(0, this.pushT - dt);
    this.pushRest = Math.max(0, this.pushRest - dt);
    if (this.pushT > 0 && !this.braking) want = Math.max(want, top * (1 + PUSH_BOOST));
    const rate = this.braking ? BRAKE : this.speed < want ? ACCEL : SLOW;
    this.speed += (want - this.speed) * Math.min(1, rate * dt);
    const prevY = this.y;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.y += Math.cos(this.heading) * this.speed * dt;
    this.checkGates(prevY);

    if (this.air) {
      this.air.t += dt;
      if (this.air.t >= this.air.dur) this.land();
    } else {
      this.throwSnow(this.heading - before, dt, time);
      this.addTrack();
    }
  }

  /**
   * Snow off the skis: a spray to the outside of a turn that grows with how hard and fast you carve,
   * a fan in front when braking, and a puff of powder now and then in deep snow.
   */
  private throwSnow(turned: number, dt: number, time: number) {
    const carve = Math.abs(turned) / dt;
    const fast = Math.min(1, this.speed / 250);
    // Flakes a second, the same whatever the frame rate.
    let rate = 0;
    if (this.braking && this.speed > 40) {
      rate = 420 * fast;
      this.sprayAngle = 90 - Phaser.Math.RadToDeg(this.heading) + Phaser.Math.Between(-60, 60);
    } else if (carve > 0.6 && this.speed > 50) {
      rate = Math.min(900, 170 * carve) * fast;
      // Thrown out sideways from the turn: away from the side the skis are turning towards.
      const along = 90 - Phaser.Math.RadToDeg(this.heading);
      this.sprayAngle = along + Math.sign(turned) * 80;
    } else if (this.deep && this.speed > 40) {
      rate = 70 * fast;
      this.sprayAngle = 270 + Phaser.Math.Between(-50, 50);
    }
    const n = Math.floor(rate * dt + Math.random());
    if (n > 0) this.spray.emitParticleAt(this.x - Math.sin(this.heading) * 3, this.y - 1, n);
    if (rate > 120 && time - this.lastCarve > 220) {
      this.lastCarve = time;
      playSfx(this, SFX, 'carve', { volume: Math.min(0.55, this.speed / 450) });
    }
  }

  private get topSpeed() {
    return Phaser.Math.Linear(TOP_SPEED, TOP_SPEED_MAX, difficulty(this.metres));
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
    g.lineStyle(1, 0xb3cbe6, 1);
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
    // A shake on whole pixels, top and trunk together.
    if (img && !this.tweens.isTweening(img)) {
      const parts = [img, img.getData('top') as Phaser.GameObjects.Image | undefined].filter((p) => !!p);
      this.tweens.add({ targets: parts, x: img.x + 1, duration: 50, yoyo: true, repeat: 2, ease: 'Stepped' });
    }
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
    // A push: poles planted, then swung back. Otherwise poles working when slow, tucked when fast.
    let frame = 0;
    if (this.pushT > 0 && !crashed) frame = this.pushT > PUSH_S / 2 ? 1 : 0;
    else if (this.speed < 90 && !crashed && this.state === 'playing') frame = Math.floor(this.time.now / 180) % 2;
    this.skier.setFrame(this.frames[frame]);
    this.skier.setPosition(x, y - Math.round(air * (this.air?.height ?? 0))).setDepth(y + (this.air ? OVERHEAD / 2 : 0));
    // Turned only in quarter turns, so the pixels stay square; upright unless tumbling.
    this.skier.setAngle(crashed ? Math.round(this.skier.angle / 90) * 90 : 0);
    this.skier.setAlpha(this.ghostT > 0 && Math.floor(this.time.now / 80) % 2 ? 0.35 : 1);
    this.shadow.setVisible(!!this.air).setPosition(x, y + 1).setDepth(y - 0.5);
  }

  private followCamera(dt: number, snap: boolean) {
    const cam = this.cameras.main;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const lead = Math.sin(this.heading) * Math.min(1, this.speed / 200) * viewW * 0.12;
    const want = this.x + lead;
    this.camX = snap ? want : this.camX + (want - this.camX) * Math.min(1, dt * 3);
    // Phaser zooms round the middle of the screen, which falls on a half pixel when the window is an
    // odd size. Nudging the scroll by a fraction keeps every texel on whole screen pixels; otherwise
    // sprites lose an edge row or pick up a line from their neighbour in the sheet.
    const snapped = (want: number, size: number) => {
      const frac = ((((size / 2) * (1 - cam.zoom)) % 1) + 1) % 1;
      return Math.round(want) + frac / cam.zoom;
    };
    cam.setScroll(snapped(this.camX - cam.width / 2, cam.width), snapped(this.y + viewH * (0.5 - SKIER_AT) - cam.height / 2, cam.height));
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
    const speed = this.topSpeed * Math.min(YETI_MAX, YETI_SPEED + yeti.t * YETI_ACCEL);
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
    const off = yeti.y < top + 4;
    this.yetiArrow.setVisible(off);
    if (off) {
      const sc = Math.max(1, this.zoom - 1);
      const sx = Phaser.Math.Clamp((yeti.x - cam.worldView.x) * cam.zoom, 40, this.scale.width - 40);
      this.yetiArrow.setPosition(Math.round(sx), Math.round(20 * sc + 6 + Math.sin(time / 120) * 3)).setScale(sc);
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
    const label = this.add.bitmapText(Math.round(sx), Math.round(sy), PIXEL_FONT, text).setOrigin(0.5, 1).setTint(tint).setScale(this.zoom);
    this.ui.add(label);
    this.tweens.add({ targets: label, y: Math.round(sy) - 16 * this.zoom, alpha: 0, duration: 800, ease: 'Quad.easeOut', onUpdate: () => (label.y = Math.round(label.y)), onComplete: () => label.destroy() });
  }

  private banner(text: string) {
    const { width: w, height: h } = this.scale;
    const s = Math.max(3, this.zoom * 2);
    const label = this.add.bitmapText(Math.round(w / 2), Math.round(h * 0.5), PIXEL_FONT, text).setOrigin(0.5).setScale(0);
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

  /** Pixel letters at a whole-number scale, so every letter pixel is the same size. */
  private text(x: number, y: number, str: string, scale: number, tint = 0xffffff) {
    return this.add.bitmapText(Math.round(x), Math.round(y), PIXEL_FONT, str).setScale(scale).setTint(tint);
  }

  /** Text size for cards: bigger on big screens, never so big a line won't fit a phone. */
  private get unit() {
    const { width: w, height: h } = this.scale;
    return w >= 1000 && h >= 700 ? 3 : 2;
  }

  /** A chunky pixel panel with notched corners, in screen pixels. */
  private panel(x: number, y: number, w: number, h: number, u: number, fill: number, edge?: number) {
    const g = this.add.graphics();
    const box = (dx: number, dy: number, bw: number, bh: number, c: number, a = 1) =>
      g.fillStyle(c, a).fillRect(x + dx + u, y + dy, bw - 2 * u, bh).fillRect(x + dx, y + dy + u, bw, bh - 2 * u);
    box(0, u, w, h, 0x000000, 0.25);
    if (edge !== undefined) {
      box(-u, -u, w + 2 * u, h + 2 * u, edge);
    }
    box(0, 0, w, h, fill);
    return g;
  }

  /** A pixel button centred on (x, y): returns its parts and its height. */
  private button(x: number, y: number, label: string, u: number, onClick: () => void) {
    const s = u + 1;
    const text = this.text(x, y, label, s).setOrigin(0.5);
    const w = Math.round(text.width + 14 * s);
    const h = Math.round(text.height + 6 * s);
    const left = Math.round(x - w / 2);
    const top = Math.round(y - h / 2);
    const face = this.panel(left, top, w, h, u, 0xe2483d, INK);
    face.fillStyle(0xf47a6e).fillRect(left + u, top, w - 2 * u, u);
    const zone = this.add.zone(x, y, w + 8, h + 8).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => face.setAlpha(0.85));
    zone.on('pointerout', () => (face.setAlpha(1), face.setY(0), text.setY(Math.round(y))));
    zone.on('pointerdown', () => (face.setY(u), text.setY(Math.round(y) + u)));
    zone.on('pointerup', () => {
      face.setY(0);
      text.setY(Math.round(y));
      playSfx(this, SFX, 'click');
      onClick();
    });
    return { parts: [face, text, zone] as Phaser.GameObjects.GameObject[], h };
  }

  /** The tallest whole-number scale at which a line of pixel text fits the screen width, up to `max`. */
  private fitScale(str: string, max: number, margin = 32) {
    const probe = this.add.bitmapText(0, 0, PIXEL_FONT, str);
    const w = probe.width;
    probe.destroy();
    return Phaser.Math.Clamp(Math.floor((this.scale.width - margin) / w), 1, max);
  }

  /** Where cards start: just below the skier, so they never cover him or the yeti. */
  private cardTop(height: number) {
    const { height: h } = this.scale;
    const below = Math.round(h * SKIER_AT + 14 * this.zoom);
    return Math.max(8, Math.min(Math.max(below, Math.round((h - height) / 2)), h - 12 - height));
  }

  private showTitle() {
    this.state = 'title';
    this.setOverlay(() => {
      const { width: w } = this.scale;
      const cx = Math.round(w / 2);
      const u = this.unit;
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const ts = this.fitScale('DOWNHILL', u * 2 + 1);
      const how = touch
        ? 'HOLD YOUR FINGER WHERE YOU WANT TO GO. TAP TO PUSH OFF'
        : 'POINT THE MOUSE WHERE YOU WANT TO GO. OR STEER WITH THE ARROW KEYS. CLICK OR SPACE TO PUSH OFF';
      const lineH = TILE * u;
      // Phaser wraps on the scaled width.
      const maxLine = Math.min(w - 64, 300 * u);

      const title = this.text(cx, 0, 'DOWNHILL', ts).setOrigin(0.5, 0);
      const tag = this.text(cx, 0, how, u).setOrigin(0.5, 0).setCenterAlign().setMaxWidth(maxLine);
      const warn = this.text(0, 0, 'KEEP AHEAD OF THE YETI!', u, 0xffd0cc).setOrigin(0, 0);
      const yeti = this.add.image(0, 0, SKI, T.yeti.roar).setScale(u).setOrigin(0, 0);
      // The warning and its yeti as one centred row; wrapped under it on narrow screens.
      const rowW = yeti.displayWidth + 4 * u + warn.width;
      const stacked = rowW > w - 64;
      if (stacked) warn.setMaxWidth(maxLine).setCenterAlign();

      const pad = 8 * u;
      const panelW = Math.round(Math.max(tag.width, stacked ? warn.width : rowW) + pad * 2);
      const tagH = tag.height;
      const warnH = stacked ? yeti.displayHeight + 4 * u + warn.height : Math.max(yeti.displayHeight, warn.height);
      const panelH = pad + tagH + 6 * u + warnH + pad;
      const btnH = 22 * (u + 1);
      const total = title.height + 8 * u + panelH + 10 * u + btnH + (this.best ? 8 * u + lineH : 0);

      let y = this.cardTop(total);
      title.setY(y);
      this.tweens.add({ targets: title, y: y - u, duration: 600, yoyo: true, repeat: -1, ease: 'Stepped' });
      y += title.height + 8 * u;
      const panelX = Math.round(cx - panelW / 2);
      const panel = this.panel(panelX, y, panelW, panelH, u, INK, undefined).setAlpha(0.9);
      tag.setY(y + pad);
      const warnTop = y + pad + tagH + 6 * u;
      if (stacked) {
        yeti.setPosition(Math.round(cx - yeti.displayWidth / 2), warnTop);
        warn.setPosition(Math.round(cx - warn.width / 2), warnTop + yeti.displayHeight + 4 * u);
      } else {
        const left = Math.round(cx - rowW / 2);
        yeti.setPosition(left, warnTop + Math.round((warnH - yeti.displayHeight) / 2));
        warn.setPosition(left + yeti.displayWidth + 4 * u, warnTop + Math.round((warnH - warn.height) / 2));
      }
      this.tweens.add({ targets: yeti, y: yeti.y - 2 * u, duration: 220, yoyo: true, repeat: -1, ease: 'Stepped' });
      y += panelH + 10 * u;
      const play = this.button(cx, y + btnH / 2, 'SKI!', u, () => this.startGame());
      y += btnH + 8 * u;
      const parts: Phaser.GameObjects.GameObject[] = [title, panel, tag, yeti, warn, ...play.parts];
      if (this.best) parts.push(this.text(cx, y, `BEST ${this.best}`, u, GOLD).setOrigin(0.5, 0));
      return parts;
    });
  }

  private showGameOver(record: boolean, animate: boolean) {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const cx = Math.round(w / 2);
      const u = this.unit;
      const ts = this.fitScale('GOBBLED!', u * 2 + 1);
      const title = this.text(cx, 0, 'GOBBLED!', ts, 0xffd0cc).setOrigin(0.5, 0);
      const pad = 8 * u;
      const rowH = TILE * u + 4 * u;
      const bigS = u + 1;
      const panelW = Math.min(w - 32, 150 * u);
      const panelH = pad + TILE * bigS + 6 * u + rowH * 3 + pad - 4 * u;
      const btnH = 22 * (u + 1);
      const total = title.height + 8 * u + panelH + 12 * u + btnH;

      let y = this.cardTop(total);
      title.setY(y);
      y += title.height + 8 * u;
      const left = Math.round(cx - panelW / 2);
      const right = left + panelW;
      const panel = this.panel(left, y, panelW, panelH, u, INK, PALE);
      // Score on its own line, then the sums that make it: label on the left, value on the right.
      let ry = y + pad;
      const scoreLabel = this.text(left + pad, ry + (TILE * bigS - TILE * u) / 2, 'SCORE', u, PALE);
      const scoreNum = this.text(right - pad, ry, animate ? '0' : `${this.score}`, bigS, GOLD).setOrigin(1, 0);
      ry += TILE * bigS + 6 * u;
      const rows = [
        ['DISTANCE', `${this.metres}M`],
        ['STYLE', `${this.style}`],
        ['BEST', `${this.best}`],
      ].flatMap(([name, value], i) => [
        this.text(left + pad, ry + i * rowH, name, u, PALE),
        this.text(right - pad, ry + i * rowH, value, u).setOrigin(1, 0),
      ]);
      const newTag = record ? this.text(right - pad - rows[5].width - 6 * u, ry + 2 * rowH, 'NEW!', u, 0xff6a5c).setOrigin(1, 0) : undefined;
      y += panelH + 12 * u;
      const again = this.button(cx, y + btnH / 2, 'AGAIN', u, () => this.startGame());
      const shade = this.add.rectangle(0, 0, w, h, INK, 0.3).setOrigin(0);
      const parts = [shade, title, panel, scoreLabel, scoreNum, ...rows, ...(newTag ? [newTag] : []), ...again.parts];
      if (!animate) {
        this.canRestart = true;
        return parts;
      }

      again.parts.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
      newTag?.setVisible(false);
      const titleY = title.y;
      this.tweens.add({ targets: title, y: { from: titleY - 200, to: titleY }, duration: 450, ease: 'Back.easeOut', onUpdate: () => (title.y = Math.round(title.y)) });
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        this.later(400 + i * 40, () => {
          scoreNum.setText(`${Math.round((this.score * i) / steps)}`);
          playSfx(this, SFX, 'tick', { volume: 0.3 });
        });
      }
      const reveal = 400 + steps * 40 + 250;
      this.later(reveal, () => {
        if (newTag) {
          newTag.setVisible(true);
          this.tweens.add({ targets: newTag, alpha: { from: 0, to: 1 }, duration: 300, yoyo: true, repeat: 2 });
          playSfx(this, SFX, 'record', { volume: 0.6, detune: 0 });
          this.later(500, () => this.voice('new_highscore'));
        }
      });
      this.later(reveal + 400, () => {
        again.parts.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(true));
        this.canRestart = true;
        this.rebuildOverlay = () => this.showGameOver(record, false);
      });
      return parts;
    });
  }
}
