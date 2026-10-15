import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { GREY, PIXEL_FONT, SFX, SHIPS, T, TILES, createFont, preloadAssets, shipFrame, type Colour, type Voice } from './assets';
import { CELL, CHUNK, TILE, Terrain } from './terrain';

type State = 'title' | 'playing' | 'over';

/** The ground slides by at this many pixels a second. */
const SCROLL = 22;
/** The play field is at most this wide; wider screens get dimmed margins. */
const MAX_FIELD_W = 224;
/** Player speed with the keys, and the most it moves a second chasing the mouse. */
const KEY_SPEED = 120;
const MOUSE_SPEED = 260;
/** Seconds between shots, by power level 1 to 4. */
const FIRE_GAP = [0.15, 0.14, 0.13, 0.1];
const BULLET_SPEED = 320;
/** The crosshair sits this far ahead of the plane; a bomb takes this long to get there. */
const RETICLE_AHEAD = 44;
const BOMB_S = 0.45;
const BOMB_REST = 0.35;
const BLAST = 12;
const LIVES = 3;
const MAX_LIVES = 5;
const MAX_POWER = 4;
const SHIELD_S = 8;
const RESPAWN_S = 1.1;
const SAFE_S = 2.2;
/** Seconds from the start before anything shoots back, and before the first big bomber. */
const QUIET_S = 18;
const BOSS_AT = 95;
const BOSS_EVERY = 110;
const INK = 0x434a5f;
const PALE = 0xb9d6ff;
const GOLD = 0xffd23f;
const SHADOW = 0x1d3a52;

type EnemyKind = 'dart' | 'diver' | 'looper' | 'gunship' | 'bomber';

interface Enemy {
  kind: EnemyKind;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  frame: number;
  x: number;
  y: number;
  t: number;
  hp: number;
  maxHp: number;
  points: number;
  /** Hit radius. */
  r: number;
  /** How high it flies, which sets how far its shadow falls. */
  height: number;
  fireT: number;
  flashT: number;
  move: (e: Enemy, dt: number) => void;
  dead?: boolean;
}

interface Shot {
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  /** Half its width, for hits. */
  hw: number;
}

type TargetKind = 'gun' | 'tank' | 'bunker' | 'truck';

interface Target {
  kind: TargetKind;
  sprite: Phaser.GameObjects.Image;
  chunk: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fireT: number;
  dead: boolean;
}

interface Bomb {
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}

type PickupKind = 'power' | 'shield' | 'repair';

interface Pickup {
  kind: PickupKind;
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  t: number;
}

interface Chunk {
  map: Phaser.Tilemaps.Tilemap;
}

const TARGETS: Record<TargetKind, { frame: number; points: number }> = {
  gun: { frame: T.gun, points: 200 },
  tank: { frame: T.tank, points: 300 },
  bunker: { frame: T.bunker, points: 250 },
  truck: { frame: T.truck, points: 150 },
};

export class RaidScene extends Phaser.Scene {
  private state: State = 'title';
  private ground!: Phaser.GameObjects.Layer;
  private air!: Phaser.GameObjects.Layer;
  private ui!: Phaser.GameObjects.Layer;
  private airCam!: Phaser.Cameras.Scene2D.Camera;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private zoom = 2;
  /** The play field in air units: x from -fieldW/2 to fieldW/2, y from 0 down to fieldH. */
  private fieldW = 200;
  private fieldH = 300;
  private terrain = new Terrain(1);
  private chunks = new Map<number, Chunk>();
  /** World y of the top of the view; it only ever goes down, as the planes fly on. */
  private groundY = 0;

  private player!: Phaser.GameObjects.Image;
  private playerShadow!: Phaser.GameObjects.Image;
  private shieldRing!: Phaser.GameObjects.Image;
  private reticle!: Phaser.GameObjects.Image;
  private px = 0;
  private py = 0;
  private alive = true;
  private respawnT = 0;
  private safeT = 0;
  private shieldT = 0;
  private fireT = 0;
  private shotCount = 0;
  private bombRest = 0;
  private power = 1;
  private lives = LIVES;
  private keys?: Record<'left' | 'right' | 'up' | 'down' | 'a' | 'd' | 'w' | 's', Phaser.Input.Keyboard.Key>;
  /** Mouse: the plane flies to the pointer. Touch: it follows the finger's movement from where it started. */
  private pointerMode: 'none' | 'mouse' | 'drag' = 'none';
  private drag?: { id: number; sx: number; sy: number; px: number; py: number; t: number; moved: boolean };

  private enemies: Enemy[] = [];
  private shots: Shot[] = [];
  private enemyShots: Shot[] = [];
  private targets: Target[] = [];
  private bombs: Bomb[] = [];
  private pickups: Pickup[] = [];

  private t = 0;
  private nextWave = 3;
  private nextBoss = BOSS_AT;
  private boss?: Enemy;
  private round = 0;
  private score = 0;
  private best = 0;
  private planesDown = 0;
  private groundDown = 0;
  private bossesDown = 0;

  private scoreText!: Phaser.GameObjects.BitmapText;
  private livesIcon!: Phaser.GameObjects.Image;
  private livesText!: Phaser.GameObjects.BitmapText;
  private powerText!: Phaser.GameObjects.BitmapText;
  private bossBar!: Phaser.GameObjects.Graphics;
  private margins!: Phaser.GameObjects.Graphics;
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private overlayTimers: Phaser.Time.TimerEvent[] = [];
  private canRestart = false;
  private music?: Phaser.Sound.BaseSound;

  constructor() {
    super('raid');
  }

  preload() {
    preloadAssets(this);
  }

  // ---- Setup -------------------------------------------------------------------------------

  create() {
    createFont(this);
    this.makeTextures();
    this.ground = this.add.layer();
    this.air = this.add.layer();
    this.ui = this.add.layer();
    // Three cameras at the same whole-number zoom: one over the scrolling ground, one fixed over
    // the planes, and one unzoomed for the HUD. Zooming from the top-left corner keeps every
    // pixel on a whole screen pixel whatever size the window is.
    const main = this.cameras.main.setOrigin(0, 0).setBackgroundColor(0xdff6f5);
    this.airCam = this.cameras.add(0, 0, this.scale.width, this.scale.height).setOrigin(0, 0);
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    main.ignore([this.air, this.ui]);
    this.airCam.ignore([this.ground, this.ui]);
    this.uiCam.ignore([this.ground, this.air]);

    this.playerShadow = this.shadowOf(this.add.image(0, 0, SHIPS, shipFrame('medium', 'blue')));
    this.player = this.add.image(0, 0, SHIPS, shipFrame('medium', 'blue')).setDepth(7);
    this.shieldRing = this.add.image(0, 0, 'ring').setDepth(7.5).setVisible(false);
    this.reticle = this.add.image(0, 0, TILES, T.reticle).setDepth(1).setVisible(false);
    this.air.add([this.playerShadow, this.player, this.shieldRing, this.reticle]);

    this.margins = this.add.graphics();
    this.bossBar = this.add.graphics();
    this.scoreText = this.add.bitmapText(0, 0, PIXEL_FONT, '0').setOrigin(1, 0);
    this.livesIcon = this.add.image(0, 0, SHIPS, shipFrame('small', 'blue')).setOrigin(1, 0);
    this.livesText = this.add.bitmapText(0, 0, PIXEL_FONT, '').setOrigin(1, 0);
    this.powerText = this.add.bitmapText(0, 0, PIXEL_FONT, '').setOrigin(1, 0).setTint(GOLD);
    this.ui.add([this.margins, this.bossBar, this.scoreText, this.livesIcon, this.livesText, this.powerText]);
    this.setHudVisible(false);

    this.input.addPointer(1);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointerUp(p));
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE,LEFT,RIGHT,UP,DOWN');
      this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN', a: 'A', d: 'D', w: 'W', s: 'S' }) as typeof this.keys;
      for (const key of ['SPACE', 'X', 'Z', 'ENTER']) {
        kb.on(`keydown-${key}`, (e: KeyboardEvent) => {
          if (e.repeat) return;
          if (this.state === 'playing') {
            if (key !== 'ENTER') this.dropBomb();
          } else if (key === 'SPACE' || key === 'ENTER') this.confirm();
        });
      }
    }
    this.scale.on('resize', () => this.layout());

    this.best = load('island-raid:best', 0);
    this.resetRun();
    this.layout();
    this.showTitle();
  }

  /** A pixel ring for the shield, and a pixel for sparks. */
  private makeTextures() {
    if (this.textures.exists('ring')) return;
    const size = 31;
    const ring = this.textures.createCanvas('ring', size, size)!;
    const ctx = ring.context;
    const c = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - c, y - c);
        if (d > 13.6 && d <= 14.6) {
          ctx.fillStyle = (x + y) % 3 ? '#8fe8ff' : '#ffffff';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    ring.refresh();
  }

  /** A dark copy of a plane, flat on the sea below it. */
  private shadowOf(img: Phaser.GameObjects.Image) {
    return img.setTint(SHADOW).setTintMode(Phaser.TintModes.FILL).setAlpha(0.22).setDepth(2);
  }

  private layout() {
    const { width: w, height: h } = this.scale;
    // Whole-number zoom: two on phones, three or more on big screens, with a good screenful of sky.
    this.zoom = Math.max(1, Math.floor(Math.min(w / 160, h / 250)));
    this.fieldW = Math.min(MAX_FIELD_W, Math.floor(w / this.zoom));
    this.fieldH = Math.floor(h / this.zoom);
    const left = -Math.floor(w / 2) / this.zoom;
    for (const cam of [this.cameras.main, this.airCam]) cam.setSize(w, h).setZoom(this.zoom).setScroll(left, 0);
    this.uiCam.setSize(w, h);
    this.placeGroundCamera();
    this.px = Phaser.Math.Clamp(this.px, -this.fieldW / 2 + 10, this.fieldW / 2 - 10);
    this.py = Phaser.Math.Clamp(this.py, this.fieldH * 0.3, this.fieldH - 14);

    // Dim the sea either side of the field on wide screens.
    const g = this.margins.clear();
    const fieldPx = this.fieldW * this.zoom;
    const x0 = Math.floor(w / 2) - fieldPx / 2;
    if (x0 > 0) {
      g.fillStyle(INK, 0.55).fillRect(0, 0, x0, h).fillRect(x0 + fieldPx, 0, w - x0 - fieldPx, h);
      g.fillStyle(0xffffff, 0.5).fillRect(x0 - 2, 0, 2, h).fillRect(x0 + fieldPx, 0, 2, h);
    }
    // HUD at the top right: out in the margin when there's room, else just inside the field.
    const s = this.hudScale;
    const inMargin = w - (x0 + fieldPx) >= 90 * s;
    const right = inMargin ? x0 + fieldPx + 8 + 70 * s : Math.min(w - 12, x0 + fieldPx - 8);
    this.scoreText.setScale(s).setPosition(right, 10);
    this.livesText.setScale(s).setPosition(right, 10 + 14 * s);
    this.livesIcon.setScale(Math.max(1, s - 1));
    this.powerText.setScale(s).setPosition(right, 10 + 28 * s);
    this.updateHud();
    this.rebuildOverlay?.();
  }

  private get hudScale() {
    return this.scale.width >= 700 && this.scale.height >= 600 ? 3 : 2;
  }

  /** The ground camera on a whole screen pixel. */
  private placeGroundCamera() {
    const cam = this.cameras.main;
    cam.scrollY = Math.round(this.groundY * this.zoom) / this.zoom;
  }

  private setHudVisible(on: boolean) {
    for (const o of [this.scoreText, this.livesIcon, this.livesText, this.powerText]) o.setVisible(on);
    if (!on) this.bossBar.clear();
  }

  private updateHud() {
    this.scoreText.setText(`${this.score}`);
    this.livesText.setText(`X${this.lives}`);
    this.livesIcon.setPosition(this.livesText.x - this.livesText.width - 2, this.livesText.y + (this.livesText.height - this.livesIcon.displayHeight) / 2);
    this.powerText.setText(this.power > 1 ? `P${this.power}` : '');
  }

  // ---- Terrain -----------------------------------------------------------------------------

  private updateChunks() {
    const top = Math.floor((this.groundY - CELL) / CHUNK);
    const bottom = Math.floor((this.groundY + this.fieldH) / CHUNK);
    for (let i = top; i <= bottom; i++) if (!this.chunks.has(i)) this.buildChunk(i);
    for (const [i, c] of this.chunks) {
      if (i > bottom + 1) {
        c.map.destroy();
        this.chunks.delete(i);
        for (const t of this.targets) if (t.chunk === i) t.sprite.destroy();
        this.targets = this.targets.filter((t) => t.chunk !== i);
      }
    }
  }

  private buildChunk(index: number) {
    const data = this.terrain.chunk(index);
    const map = this.make.tilemap({ data: data.tiles, tileWidth: TILE, tileHeight: TILE });
    const layer = map.createLayer(0, map.addTilesetImage(TILES)!, data.x, data.y)!;
    // Tile culling works from the camera's world view, which Phaser gets wrong for a camera zoomed
    // from its corner; a chunk is small enough to draw whole.
    (layer as Phaser.Tilemaps.TilemapLayer).skipCull = true;
    this.ground.add(layer);
    this.chunks.set(index, { map });
    if (this.state === 'playing') this.placeTargets(index, data.spots);
  }

  /** Puts guns, tanks, bunkers and trucks on some of a chunk's open ground: more, and more guns, as the run goes on. */
  private placeTargets(chunk: number, spots: { x: number; y: number }[]) {
    const inField = Phaser.Utils.Array.Shuffle(spots.filter((s) => Math.abs(s.x) < this.fieldW / 2 - 12));
    const d = this.difficulty;
    const want = Math.min(Math.floor(inField.length / 5), 1 + Math.floor(d * 4 + Math.random() * 1.5));
    const placed: { x: number; y: number }[] = [];
    for (const s of inField) {
      if (placed.length >= want) break;
      if (placed.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 40)) continue;
      placed.push(s);
      const r = Math.random();
      const early = this.t < QUIET_S;
      const kind: TargetKind = early ? (r < 0.5 ? 'truck' : 'bunker') : r < 0.3 + d * 0.15 ? 'gun' : r < 0.5 + d * 0.2 ? 'tank' : r < 0.75 ? 'bunker' : 'truck';
      const sprite = this.add.image(s.x, s.y, TILES, TARGETS[kind].frame).setDepth(1);
      this.ground.add(sprite);
      const vx = kind === 'tank' ? (Math.random() < 0.5 ? -6 : 6) : 0;
      const vy = kind === 'truck' ? -9 : 0;
      this.targets.push({ kind, sprite, chunk, x: s.x, y: s.y, vx, vy, fireT: 1 + Math.random() * 2, dead: false });
    }
  }

  private onLand(x: number, y: number) {
    return !!this.terrain.land(Math.floor(x / CELL), Math.floor(y / CELL));
  }

  // ---- Input -------------------------------------------------------------------------------

  private pointerDown(p: Phaser.Input.Pointer) {
    if (this.state !== 'playing') return;
    if (p.wasTouch) {
      if (this.drag) return;
      this.pointerMode = 'drag';
      this.drag = { id: p.id, sx: p.x, sy: p.y, px: this.px, py: this.py, t: this.time.now, moved: false };
    } else {
      this.pointerMode = 'mouse';
      this.dropBomb();
    }
  }

  private pointerMove(p: Phaser.Input.Pointer) {
    if (this.state !== 'playing') return;
    if (!p.wasTouch) this.pointerMode = 'mouse';
    else if (this.drag?.id === p.id && Math.hypot(p.x - this.drag.sx, p.y - this.drag.sy) > 10) this.drag.moved = true;
  }

  private pointerUp(p: Phaser.Input.Pointer) {
    if (!this.drag || this.drag.id !== p.id) return;
    // A quick tap that didn't move the plane drops a bomb.
    if (!this.drag.moved && this.time.now - this.drag.t < 300) this.dropBomb();
    this.drag = undefined;
  }

  private confirm() {
    if (this.state === 'title' || (this.state === 'over' && this.canRestart)) this.startGame();
  }

  private steer(dt: number) {
    const k = this.keys;
    const kx = (k && (k.right.isDown || k.d.isDown) ? 1 : 0) - (k && (k.left.isDown || k.a.isDown) ? 1 : 0);
    const ky = (k && (k.down.isDown || k.s.isDown) ? 1 : 0) - (k && (k.up.isDown || k.w.isDown) ? 1 : 0);
    if (kx || ky) {
      this.pointerMode = 'none';
      const n = Math.hypot(kx, ky);
      this.px += (kx / n) * KEY_SPEED * dt;
      this.py += (ky / n) * KEY_SPEED * dt;
    } else if (this.pointerMode === 'drag' && this.drag) {
      const p = this.input.manager.pointers.find((q) => q.id === this.drag!.id);
      if (p) {
        this.px = this.drag.px + (p.x - this.drag.sx) / this.zoom;
        this.py = this.drag.py + (p.y - this.drag.sy) / this.zoom;
      }
    } else if (this.pointerMode === 'mouse') {
      const p = this.input.activePointer;
      const at = this.airCam.getWorldPoint(p.x, p.y);
      const ox = at.x - this.px;
      const oy = at.y - this.py;
      const d = Math.hypot(ox, oy);
      const step = Math.min(d, MOUSE_SPEED * dt);
      if (d > 0.5) {
        this.px += (ox / d) * step;
        this.py += (oy / d) * step;
      }
    }
    const minX = -this.fieldW / 2 + 10;
    const maxX = this.fieldW / 2 - 10;
    const minY = this.fieldH * 0.3;
    const maxY = this.fieldH - 14;
    // Pinned at an edge, a drag picks up from there rather than from where the finger went past it.
    const cx = Phaser.Math.Clamp(this.px, minX, maxX);
    const cy = Phaser.Math.Clamp(this.py, minY, maxY);
    if (this.drag) {
      this.drag.px += cx - this.px;
      this.drag.py += cy - this.py;
    }
    this.px = cx;
    this.py = cy;
  }

  // ---- Game flow ---------------------------------------------------------------------------

  private resetRun() {
    for (const c of this.chunks.values()) c.map.destroy();
    this.chunks.clear();
    for (const list of [this.enemies, this.shots, this.enemyShots, this.targets, this.bombs, this.pickups] as { sprite: Phaser.GameObjects.Image }[][]) {
      for (const o of list) o.sprite.destroy();
    }
    for (const e of this.enemies) e.shadow.destroy();
    for (const b of this.bombs) b.shadow.destroy();
    this.enemies = [];
    this.shots = [];
    this.enemyShots = [];
    this.targets = [];
    this.bombs = [];
    this.pickups = [];
    this.terrain = new Terrain(Math.floor(Math.random() * 1e9));
    this.groundY = -this.fieldH;
    this.px = 0;
    this.py = this.fieldH * 0.8;
    this.alive = true;
    this.respawnT = this.safeT = this.shieldT = 0;
    this.fireT = this.bombRest = 0;
    this.power = 1;
    this.lives = LIVES;
    this.t = 0;
    this.nextWave = 3;
    this.nextBoss = BOSS_AT;
    this.boss = undefined;
    this.round = 0;
    this.score = this.planesDown = this.groundDown = this.bossesDown = 0;
    this.player.setVisible(true).setAlpha(1);
    this.drag = undefined;
    this.pointerMode = 'none';
  }

  private startGame() {
    playSfx(this, SFX, 'click');
    this.setOverlay();
    if (this.state === 'over') {
      this.resetRun();
      this.layout();
    }
    this.state = 'playing';
    this.canRestart = false;
    this.reticle.setVisible(true);
    this.setHudVisible(true);
    this.updateHud();
    this.banner('GO!');
    this.voice('go');
    this.music ??= this.sound.add('music', { loop: true, volume: 0.3 });
    if (!this.music.isPlaying) this.music.play();
  }

  /** 0 at the start, 1 four minutes in; each bomber brought down adds a notch on top. */
  private get difficulty() {
    return Math.min(1, this.t / 240 + this.round * 0.08);
  }

  private endGame() {
    this.state = 'over';
    this.reticle.setVisible(false);
    this.setHudVisible(false);
    this.music?.stop();
    const previous = this.best;
    const { best, isNew } = submitHighScore('island-raid', this.score);
    this.best = best;
    this.time.delayedCall(300, () => this.voice('game_over'));
    this.time.delayedCall(1200, () => this.showGameOver(isNew && previous > 0, true));
  }

  // ---- Frame loop --------------------------------------------------------------------------

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 30);
    this.groundY -= SCROLL * dt;
    this.placeGroundCamera();
    this.updateChunks();
    if (this.state === 'playing') {
      this.t += dt;
      this.updatePlayer(dt);
      this.direct();
    }
    if (this.state !== 'title') {
      this.moveEnemies(dt);
      this.moveShots(dt);
      this.moveBombs(dt);
      this.moveTargets(dt);
      this.movePickups(dt);
    }
    this.drawPlayer();
    this.drawBossBar();
  }

  private updatePlayer(dt: number) {
    this.safeT = Math.max(0, this.safeT - dt);
    if (this.shieldT > 0) {
      this.shieldT -= dt;
      if (this.shieldT <= 0) playSfx(this, SFX, 'shield', { volume: 0.25, detune: -600 });
    }
    this.bombRest = Math.max(0, this.bombRest - dt);
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    this.steer(dt);
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT += FIRE_GAP[this.power - 1];
      this.fire();
    }
  }

  private fire() {
    const add = (dx: number, frame: number, damage: number, hw: number) => {
      const sprite = this.add.image(this.px + dx, this.py - 12, TILES, frame).setDepth(8);
      this.air.add(sprite);
      this.shots.push({ sprite, x: this.px + dx, y: this.py - 12, vx: 0, vy: -BULLET_SPEED, damage, hw });
    };
    if (this.power === 1) add(0, T.bullet, 1, 3);
    else add(0, T.bulletDouble, 2, 5);
    // Wing guns from level three, a beat behind the nose gun.
    if (this.power >= 3 && this.shotCount % 2 === 0) {
      add(-11, T.bullet, 1, 3);
      add(11, T.bullet, 1, 3);
    }
    if (this.shotCount++ % 3 === 0) playSfx(this, SFX, 'shoot', { volume: 0.07, detune: Phaser.Math.Between(-100, 100) });
  }

  private dropBomb() {
    if (this.state !== 'playing' || !this.alive || this.bombRest > 0) return;
    this.bombRest = BOMB_REST;
    const sprite = this.add.image(this.px, this.py, TILES, T.bomb).setDepth(6);
    const shadow = this.shadowOf(this.add.image(this.px, this.py, TILES, T.bomb));
    this.air.add([shadow, sprite]);
    this.bombs.push({ sprite, shadow, x0: this.px, y0: this.py - 4, x1: this.px, y1: this.py - RETICLE_AHEAD, t: 0 });
    playSfx(this, SFX, 'bombDrop', { volume: 0.25 });
  }

  private respawn() {
    this.alive = true;
    this.safeT = SAFE_S;
    this.px = 0;
    this.py = this.fieldH + 20;
    this.player.setVisible(true);
    this.reticle.setVisible(true);
    this.tweens.add({ targets: this, py: this.fieldH * 0.8, duration: 500, ease: 'Quad.easeOut' });
    if (this.drag) {
      this.drag.px = 0;
      this.drag.py = this.fieldH * 0.8;
    }
  }

  private drawPlayer() {
    const show = this.alive && this.state !== 'over';
    const blink = this.safeT > 0 && Math.floor(this.time.now / 70) % 2 === 0;
    const x = this.snap(this.px);
    const y = this.snap(this.py);
    this.player.setVisible(show).setPosition(x, y).setAlpha(blink ? 0.3 : 1);
    this.playerShadow.setVisible(show).setPosition(x + 7, y + 12);
    const shieldOn = show && this.shieldT > 0 && (this.shieldT > 2 || Math.floor(this.time.now / 100) % 2 === 0);
    this.shieldRing.setVisible(shieldOn).setPosition(x, y);
    // The crosshair, gone red while it's over something to bomb.
    const rx = x;
    const ry = y - RETICLE_AHEAD;
    const gy = ry + this.cameras.main.scrollY;
    const locked = this.targets.some((t) => !t.dead && Math.hypot(t.x - rx, t.y - gy) < BLAST);
    this.reticle
      .setVisible(show)
      .setPosition(rx, ry)
      .setTint(locked ? 0xff5a4a : INK)
      .setAlpha(locked ? 1 : 0.6);
  }

  /** Rounds an air position to a whole screen pixel. */
  private snap(v: number) {
    return Math.round(v * this.zoom) / this.zoom;
  }

  // ---- Waves -------------------------------------------------------------------------------

  /** Sends in the next wave when it's due, and a big bomber now and then. */
  private direct() {
    if (this.t >= this.nextBoss && !this.boss) {
      this.nextBoss = Infinity;
      this.warnBoss();
      return;
    }
    if (this.t < this.nextWave) return;
    const d = this.difficulty;
    // While a bomber's up, just the odd line of darts.
    if (this.boss) {
      this.nextWave = this.t + 7;
      this.waveDarts(Phaser.Math.Between(3, 4));
      return;
    }
    const waves: [number, () => void][] = [
      [3, () => this.waveDarts(Phaser.Math.Between(4, 6))],
      [this.t > 20 ? 2 : 0, () => this.waveVee()],
      [this.t > 30 ? 2 : 0, () => this.waveDivers(2 + Math.floor(d * 3))],
      [this.t > 45 ? 2 : 0, () => this.waveLoopers()],
      [this.t > 60 ? 1.5 + d * 2 : 0, () => this.waveGunship()],
    ];
    let r = Math.random() * waves.reduce((s, [w]) => s + w, 0);
    for (const [w, send] of waves) {
      r -= w;
      if (r <= 0) {
        send();
        break;
      }
    }
    this.nextWave = this.t + Phaser.Math.Linear(4.2, 1.6, d) + Math.random();
  }

  private spawn(kind: EnemyKind, colour: Colour, x: number, y: number, move: Enemy['move'], extra: Partial<Enemy> = {}) {
    const size = kind === 'bomber' ? 'large' : kind === 'gunship' ? 'medium' : 'small';
    const frame = shipFrame(size, colour);
    // The big bombers are drawn at twice the size, every pixel doubled.
    const scale = kind === 'bomber' ? 2 : 1;
    const sprite = this.add.image(x, y, SHIPS, frame).setFlipY(true).setDepth(kind === 'bomber' ? 4 : 5).setScale(scale);
    const shadow = this.shadowOf(this.add.image(x, y, SHIPS, frame).setFlipY(true).setScale(scale));
    this.air.add([shadow, sprite]);
    const stats = { dart: [1, 100, 7], diver: [1, 150, 7], looper: [2, 150, 7], gunship: [8, 400, 10], bomber: [60, 3000, 22] }[kind];
    const e: Enemy = {
      kind,
      sprite,
      shadow,
      frame,
      x,
      y,
      t: 0,
      hp: stats[0],
      maxHp: stats[0],
      points: stats[1],
      r: stats[2],
      height: size === 'large' ? 26 : size === 'medium' ? 12 : 10,
      fireT: 1,
      flashT: 0,
      move,
      ...extra,
    };
    this.enemies.push(e);
    return e;
  }

  /** A file of little green darts weaving down. */
  private waveDarts(n: number) {
    const x0 = Phaser.Math.FloatBetween(-this.fieldW / 2 + 30, this.fieldW / 2 - 30);
    const amp = Phaser.Math.Between(10, 26);
    const speed = 50 + this.difficulty * 25;
    for (let i = 0; i < n; i++) {
      this.spawn('dart', 'green', x0, -16 - i * 22, (e, dt) => {
        e.y += speed * dt;
        e.x = x0 + Math.sin(e.t * 2.2 + i * 0.6) * amp;
      });
    }
  }

  /** A V of darts flying straight down together. */
  private waveVee() {
    const x0 = Phaser.Math.FloatBetween(-this.fieldW / 2 + 50, this.fieldW / 2 - 50);
    const speed = 45 + this.difficulty * 25;
    for (let i = -2; i <= 2; i++) {
      this.spawn('dart', 'green', x0 + i * 18, -16 - Math.abs(i) * 14, (e, dt) => (e.y += speed * dt));
    }
  }

  /** Red fighters that drop in, pause, then dive at where you are. */
  private waveDivers(n: number) {
    for (let i = 0; i < n; i++) {
      const x = Phaser.Math.FloatBetween(-this.fieldW / 2 + 20, this.fieldW / 2 - 20);
      const stop = this.fieldH * Phaser.Math.FloatBetween(0.15, 0.3);
      let aim: { x: number; y: number } | undefined;
      this.spawn(
        'diver',
        'red',
        x,
        -16 - i * 30,
        (e, dt) => {
          if (e.t < 1.6 + i * 0.4) {
            e.y += (stop - e.y) * Math.min(1, dt * 3);
            return;
          }
          if (!aim) {
            const dx = this.px - e.x;
            const dy = this.py - e.y;
            const d = Math.hypot(dx, dy) || 1;
            const speed = 110 + this.difficulty * 50;
            aim = { x: (dx / d) * speed, y: Math.max(0.4, dy / d) * speed };
            playSfx(this, SFX, 'warn', { volume: 0.12, detune: 600 });
          }
          e.x += aim.x * dt;
          e.y += aim.y * dt;
        },
        { y: -16 - i * 30 },
      );
    }
  }

  /** Yellow fighters swinging across in an arc from one side, each taking one shot at you. */
  private waveLoopers() {
    const side = Math.random() < 0.5 ? -1 : 1;
    const y0 = this.fieldH * Phaser.Math.FloatBetween(0.05, 0.2);
    for (let i = 0; i < 4; i++) {
      this.spawn(
        'looper',
        'yellow',
        side * (this.fieldW / 2 + 16),
        y0,
        (e) => {
          const t = e.t - i * 0.35;
          if (t < 0) return;
          // Half a lap of a wide ellipse: in from the side, dipping down and back out the far side.
          const a = Math.min(Math.PI, t * 0.9);
          e.x = side * Math.cos(a) * (this.fieldW / 2 + 16);
          e.y = y0 + Math.sin(a) * this.fieldH * 0.3 + (t > Math.PI / 0.9 ? (t - Math.PI / 0.9) * 60 : 0);
          if (t > 1.2 && e.fireT > 0) {
            e.fireT = 0;
            if (this.t > QUIET_S) this.aimedShot(e.x, e.y, 70);
          }
        },
        { fireT: 1 },
      );
    }
  }

  /** A gunship that flies in, hangs about firing fans of bullets, then makes off. */
  private waveGunship() {
    const colour = Phaser.Utils.Array.GetRandom(['red', 'green', 'yellow'] as Colour[]);
    const x0 = Phaser.Math.FloatBetween(-this.fieldW / 2 + 40, this.fieldW / 2 - 40);
    const hold = this.fieldH * Phaser.Math.FloatBetween(0.15, 0.3);
    this.spawn('gunship', colour, x0, -20, (e, dt) => {
      if (e.t < 5) {
        e.y += (hold - e.y) * Math.min(1, dt * 1.5);
        e.x = x0 + Math.sin(e.t * 0.9) * 20;
        e.fireT -= dt;
        if (e.fireT <= 0 && e.t > 1) {
          e.fireT = 1.6 - this.difficulty * 0.5;
          this.fan(e.x, e.y + 10, 3, 0.35, 65);
        }
      } else e.y += (e.t - 5) * 70 * dt;
    });
  }

  private warnBoss() {
    this.banner('WARNING', 0xff6a5c, true);
    this.voice('war_look_out');
    for (let i = 0; i < 3; i++) this.time.delayedCall(i * 450, () => playSfx(this, SFX, 'warn', { volume: 0.35 }));
    this.time.delayedCall(2200, () => {
      if (this.state !== 'playing') return;
      const colour = (['red', 'green', 'yellow'] as Colour[])[this.round % 3];
      const hp = 60 + this.round * 25;
      let pattern = 0;
      this.boss = this.spawn(
        'bomber',
        colour,
        0,
        -40,
        (e, dt) => {
          const hold = this.fieldH * 0.2;
          e.y += (hold - e.y) * Math.min(1, dt * 0.8);
          e.x = Math.sin(e.t * 0.5) * (this.fieldW / 2 - 40);
          if (e.t < 2) return;
          e.fireT -= dt;
          if (e.fireT > 0) return;
          // Rings, aimed bursts and fans in turn, quicker each time round.
          const quick = 1 + this.round * 0.12;
          if (pattern % 3 === 0) {
            this.ring(e.x, e.y + 12, 10 + this.round * 2, 55 * quick, e.t);
            e.fireT = 2.2 / quick;
          } else if (pattern % 3 === 1) {
            for (let k = 0; k < 3; k++) this.time.delayedCall(k * 160, () => !e.dead && this.aimedShot(e.x, e.y + 24, 85 * quick));
            e.fireT = 1.6 / quick;
          } else {
            this.fan(e.x - 24, e.y + 12, 3, 0.3, 70 * quick);
            this.fan(e.x + 24, e.y + 12, 3, 0.3, 70 * quick);
            e.fireT = 1.8 / quick;
          }
          pattern++;
        },
        { hp, maxHp: hp, points: 3000 + this.round * 1000, fireT: 0 },
      );
    });
  }

  // ---- Enemy fire ----------------------------------------------------------------------------

  private enemyShot(x: number, y: number, vx: number, vy: number) {
    if (this.enemyShots.length > 80) return;
    const sprite = this.add.image(x, y, TILES, T.enemyBullet).setDepth(9);
    this.air.add(sprite);
    this.enemyShots.push({ sprite, x, y, vx, vy, damage: 1, hw: 2 });
  }

  private aimedShot(x: number, y: number, speed: number) {
    if (!this.alive) return;
    const a = Math.atan2(this.py - y, this.px - x);
    this.enemyShot(x, y, Math.cos(a) * speed, Math.sin(a) * speed);
    playSfx(this, SFX, 'enemyShot', { volume: 0.12 });
  }

  /** A spread of `n` bullets `gap` radians apart, centred on the player. */
  private fan(x: number, y: number, n: number, gap: number, speed: number) {
    const a0 = Math.atan2(this.py - y, this.px - x);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i - (n - 1) / 2) * gap;
      this.enemyShot(x, y, Math.cos(a) * speed, Math.sin(a) * speed);
    }
    playSfx(this, SFX, 'enemyShot', { volume: 0.15 });
  }

  private ring(x: number, y: number, n: number, speed: number, turn: number) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + turn;
      this.enemyShot(x, y, Math.cos(a) * speed, Math.sin(a) * speed);
    }
    playSfx(this, SFX, 'enemyShot', { volume: 0.2, detune: -400 });
  }

  // ---- Moving things -------------------------------------------------------------------------

  private moveEnemies(dt: number) {
    for (const e of this.enemies) {
      e.t += dt;
      e.move(e, dt);
      e.flashT = Math.max(0, e.flashT - dt);
      const x = this.snap(e.x);
      const y = this.snap(e.y);
      e.sprite.setPosition(x, y).setFrame(e.frame + (e.flashT > 0 ? GREY : 0));
      e.shadow.setPosition(x + e.height * 0.6, y + e.height);
      // Running into a plane hurts both.
      if (this.alive && this.state === 'playing' && Math.hypot(e.x - this.px, e.y - this.py) < e.r + 4) {
        this.hitPlayer();
        this.damage(e, e.kind === 'bomber' ? 2 : 10);
      }
      const gone = e.y > this.fieldH + 30 || e.y < -120 || Math.abs(e.x) > this.fieldW / 2 + 60;
      if (gone && e.t > 1) this.removeEnemy(e);
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  private removeEnemy(e: Enemy) {
    e.dead = true;
    e.sprite.destroy();
    e.shadow.destroy();
    if (e === this.boss) this.boss = undefined;
  }

  private moveShots(dt: number) {
    for (const s of this.shots) {
      const y0 = s.y;
      s.y += s.vy * dt;
      s.sprite.setPosition(this.snap(s.x), this.snap(s.y));
      // Swept over the step, so quick bullets can't hop over a small plane.
      const hit = this.enemies.find((e) => !e.dead && e.y > -8 && Math.abs(e.x - s.x) < e.r + s.hw && e.y + e.r > s.y - 4 && e.y - e.r < y0 + 4);
      if (hit) {
        this.spark(s.x, hit.y + hit.r * 0.6);
        this.damage(hit, s.damage);
      }
      if (hit || s.y < -10) {
        s.sprite.destroy();
        s.vy = 0;
      }
    }
    this.shots = this.shots.filter((s) => s.vy !== 0);

    for (const s of this.enemyShots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.sprite.setPosition(this.snap(s.x), this.snap(s.y));
      let gone = s.y < -10 || s.y > this.fieldH + 10 || Math.abs(s.x) > this.fieldW / 2 + 10;
      if (this.alive && this.state === 'playing' && Math.hypot(s.x - this.px, s.y - this.py) < 4) {
        this.hitPlayer();
        gone = true;
      } else if (this.shieldT > 0 && this.alive && Math.hypot(s.x - this.px, s.y - this.py) < 14) {
        // The shield soaks up bullets that touch it.
        this.spark(s.x, s.y);
        gone = true;
      }
      if (gone) {
        s.sprite.destroy();
        s.damage = 0;
      }
    }
    this.enemyShots = this.enemyShots.filter((s) => s.damage !== 0);
  }

  private moveBombs(dt: number) {
    for (const b of this.bombs) {
      b.t += dt / BOMB_S;
      const k = Math.min(1, b.t);
      // It falls away below the plane: shrinking as it drops, its shadow closing in on it.
      const x = Phaser.Math.Linear(b.x0, b.x1, k);
      const y = Phaser.Math.Linear(b.y0, b.y1, k);
      const scale = k < 0.5 ? 1 : 0.5;
      b.sprite.setPosition(this.snap(x), this.snap(y)).setScale(scale);
      b.shadow.setPosition(this.snap(x + 7 * (1 - k)), this.snap(y + 12 * (1 - k))).setScale(scale);
      if (k >= 1) this.bombLands(b);
    }
    this.bombs = this.bombs.filter((b) => b.t < 1);
  }

  private bombLands(b: Bomb) {
    b.sprite.destroy();
    b.shadow.destroy();
    const gx = b.x1;
    const gy = b.y1 + this.cameras.main.scrollY;
    const hits = this.targets.filter((t) => !t.dead && Math.hypot(t.x - gx, t.y - gy) < BLAST);
    if (!this.onLand(gx, gy) && hits.length === 0) {
      this.splash(gx, gy);
      return;
    }
    this.blast(gx, gy, this.ground, 2);
    this.cameras.main.shake(90, 0.003);
    playSfx(this, SFX, 'bombHit', { volume: 0.35 });
    for (const t of hits) this.destroyTarget(t);
  }

  private moveTargets(dt: number) {
    const top = this.cameras.main.scrollY;
    for (const t of this.targets) {
      if (t.dead) continue;
      // Tanks trundle along their island and trucks up it, turning back at the shore.
      if (t.vx || t.vy) {
        const nx = t.x + t.vx * dt;
        const ny = t.y + t.vy * dt;
        if (this.onLand(nx + Math.sign(t.vx) * 9, ny + Math.sign(t.vy) * 9)) {
          t.x = nx;
          t.y = ny;
        } else {
          t.vx = -t.vx;
          t.vy = -t.vy;
          t.sprite.setFlipY(t.vy > 0);
        }
        t.sprite.setPosition(this.snap(t.x), this.snap(t.y));
      }
      if (this.state !== 'playing' || (t.kind !== 'gun' && t.kind !== 'tank') || this.t < QUIET_S) continue;
      const sy = t.y - top;
      if (sy < 8 || sy > this.fieldH * 0.7) continue;
      t.fireT -= dt;
      if (t.fireT <= 0) {
        t.fireT = (t.kind === 'gun' ? 2.6 : 3.4) - this.difficulty;
        this.aimedShot(t.x, sy, 55 + this.difficulty * 25);
        // A puff from the barrel.
        const puff = this.add.image(t.x, t.y + 6, TILES, T.flash[3]).setScale(0.5).setDepth(2);
        this.ground.add(puff);
        this.time.delayedCall(90, () => puff.destroy());
      }
    }
  }

  private movePickups(dt: number) {
    for (const p of this.pickups) {
      p.t += dt;
      p.y += 26 * dt;
      p.sprite.setPosition(this.snap(p.x + Math.sin(p.t * 3) * 6), this.snap(p.y));
      if (p.t > 0.3 && this.alive && this.state === 'playing' && Math.hypot(p.sprite.x - this.px, p.y - this.py) < 14) {
        this.collect(p);
        p.t = -1;
      } else if (p.y > this.fieldH + 12) p.t = -1;
      if (p.t < 0) p.sprite.destroy();
    }
    this.pickups = this.pickups.filter((p) => p.t >= 0);
  }

  // ---- Hits ----------------------------------------------------------------------------------

  private damage(e: Enemy, n: number) {
    if (e.dead) return;
    e.hp -= n;
    e.flashT = 0.06;
    if (e.hp > 0) {
      if (e.kind === 'bomber' || e.kind === 'gunship') playSfx(this, SFX, 'hit', { volume: 0.12 });
      return;
    }
    this.planesDown++;
    this.addScore(e.points, e.x, e.y);
    if (e.kind === 'bomber') this.bossDown(e);
    else {
      this.blast(e.x, e.y, this.air, e.kind === 'gunship' ? 2 : 1);
      playSfx(this, SFX, e.kind === 'gunship' ? 'boom' : 'pop', { volume: e.kind === 'gunship' ? 0.4 : 0.3 });
      // Every so often a plane drops something useful.
      if (e.kind === 'gunship' ? Math.random() < 0.6 : this.planesDown % 14 === 0) this.dropPickup(e.x, e.y);
    }
    this.removeEnemy(e);
  }

  private bossDown(e: Enemy) {
    this.bossesDown++;
    this.round++;
    this.nextBoss = this.t + BOSS_EVERY;
    this.nextWave = this.t + 4;
    for (let i = 0; i < 7; i++) {
      this.time.delayedCall(i * 120, () => {
        this.blast(e.x + Phaser.Math.Between(-26, 26), e.y + Phaser.Math.Between(-16, 16), this.air, i === 6 ? 3 : 2);
        playSfx(this, SFX, i % 2 ? 'pop' : 'boom', { volume: 0.4 });
      });
    }
    this.cameras.main.shake(400, 0.006);
    this.airCam.shake(400, 0.006);
    // Clear the sky of its bullets.
    for (const s of this.enemyShots) {
      this.spark(s.x, s.y);
      s.sprite.destroy();
    }
    this.enemyShots = [];
    this.dropPickup(e.x - 12, e.y, 'power');
    this.dropPickup(e.x + 12, e.y, this.lives < MAX_LIVES ? 'repair' : 'shield');
    this.time.delayedCall(900, () => {
      this.voice('war_target_destroyed');
      playSfx(this, SFX, 'victory', { volume: 0.5, detune: 0 });
      this.banner('BOMBER DOWN!', GOLD);
    });
  }

  private destroyTarget(t: Target) {
    t.dead = true;
    this.groundDown++;
    const sy = t.y - this.cameras.main.scrollY;
    this.addScore(TARGETS[t.kind].points, t.x, sy);
    // What's left: a smoking wreck that fades into the ground.
    t.sprite.setFrame(T.smoke).setTint(0x6b6f80).setAlpha(0.9);
    this.tweens.add({ targets: t.sprite, alpha: 0, delay: 1500, duration: 1500 });
    if (t.kind === 'bunker' && Math.random() < 0.7) this.dropPickup(t.x, sy);
  }

  private hitPlayer() {
    if (!this.alive || this.safeT > 0) return;
    if (this.shieldT > 0) return;
    this.alive = false;
    this.lives--;
    this.power = Math.max(1, this.power - 1);
    // A burst, then a couple more as the wreck breaks up.
    const [x, y] = [this.px, this.py];
    this.blast(x, y, this.air, 2);
    for (let i = 1; i <= 2; i++) this.time.delayedCall(i * 150, () => this.blast(x + Phaser.Math.Between(-8, 8), y + Phaser.Math.Between(-6, 6), this.air, 1));
    playSfx(this, SFX, 'boom', { volume: 0.5 });
    playSfx(this, SFX, 'hurt', { volume: 0.4 });
    this.airCam.shake(250, 0.01);
    this.cameras.main.shake(250, 0.01);
    this.reticle.setVisible(false);
    this.updateHud();
    if (this.lives <= 0) {
      this.endGame();
      return;
    }
    this.respawnT = RESPAWN_S;
  }

  private dropPickup(x: number, y: number, kind?: PickupKind) {
    const k = kind ?? (this.power < MAX_POWER && Math.random() < 0.6 ? 'power' : Math.random() < 0.5 && this.lives < MAX_LIVES ? 'repair' : 'shield');
    const frame = { power: T.power, shield: T.shield, repair: T.repair }[k];
    const sprite = this.add.image(x, y, TILES, frame).setDepth(3);
    this.air.add(sprite);
    this.pickups.push({ kind: k, sprite, x, y, t: 0 });
    this.tweens.add({ targets: sprite, scale: { from: 0, to: 1 }, duration: 250, ease: 'Back.easeOut' });
  }

  private collect(p: Pickup) {
    if (p.kind === 'power') {
      if (this.power < MAX_POWER) {
        this.power++;
        this.popup(`POWER ${this.power}`, p.x, p.y, GOLD);
        this.voice('power_up');
      } else this.addScore(1000, p.x, p.y);
      playSfx(this, SFX, 'powerUp', { volume: 0.45, detune: 0 });
    } else if (p.kind === 'shield') {
      this.shieldT = SHIELD_S;
      this.popup('SHIELD', p.x, p.y, 0x8fe8ff);
      playSfx(this, SFX, 'shield', { volume: 0.4 });
    } else {
      this.lives = Math.min(MAX_LIVES, this.lives + 1);
      this.popup('1UP', p.x, p.y, 0x9dff8f);
      playSfx(this, SFX, 'pickup', { volume: 0.5 });
    }
    this.updateHud();
  }

  private addScore(points: number, x: number, y: number) {
    this.score += points;
    this.updateHud();
    this.popup(`${points}`, x, y, 0xffffff);
  }

  // ---- Effects -------------------------------------------------------------------------------

  /** An explosion: the pack's four flash frames, then a puff of smoke drifting off. */
  private blast(x: number, y: number, layer: Phaser.GameObjects.Layer, scale: number) {
    const fx = this.add.image(this.snap(x), this.snap(y), TILES, T.flash[0]).setScale(scale).setDepth(10);
    layer.add(fx);
    T.flash.forEach((f, i) => this.time.delayedCall(i * 60, () => fx.setFrame(f)));
    this.time.delayedCall(T.flash.length * 60, () => fx.destroy());
    for (let i = 0; i < 2 + scale; i++) {
      const puff = this.add.image(this.snap(x), this.snap(y), TILES, T.smoke).setDepth(9).setAlpha(0.8);
      layer.add(puff);
      this.tweens.add({
        targets: puff,
        x: x + Phaser.Math.Between(-10, 10) * scale,
        y: y + Phaser.Math.Between(-10, 6) * scale + (layer === this.air ? 14 : 0),
        alpha: 0,
        delay: 120,
        duration: 600 + i * 100,
        ease: 'Quad.easeOut',
        onUpdate: () => puff.setPosition(this.snap(puff.x), this.snap(puff.y)),
        onComplete: () => puff.destroy(),
      });
    }
  }

  /** A bomb lost in the sea: a white ring of spray. */
  private splash(x: number, y: number) {
    const fx = this.add.image(this.snap(x), this.snap(y), TILES, T.flash[3]).setTint(0xffffff).setTintMode(Phaser.TintModes.FILL).setDepth(2);
    this.ground.add(fx);
    this.tweens.add({ targets: fx, alpha: 0, duration: 400, onComplete: () => fx.destroy() });
    playSfx(this, SFX, 'splash', { volume: 0.3 });
  }

  /** A tiny flash where a bullet strikes. */
  private spark(x: number, y: number) {
    const fx = this.add.image(this.snap(x), this.snap(y), TILES, T.flash[2]).setScale(0.5).setDepth(10);
    this.air.add(fx);
    this.time.delayedCall(50, () => fx.destroy());
  }

  /** Air coordinates to screen pixels. */
  private toScreen(x: number, y: number) {
    return { x: Math.floor(this.scale.width / 2) + x * this.zoom, y: y * this.zoom };
  }

  private popup(text: string, x: number, y: number, tint: number) {
    const at = this.toScreen(x, y);
    const s = Math.max(2, this.zoom - 1);
    const label = this.add.bitmapText(Math.round(at.x), Math.round(at.y), PIXEL_FONT, text).setOrigin(0.5).setTint(tint).setScale(s);
    this.ui.add(label);
    this.tweens.add({
      targets: label,
      y: at.y - 10 * s,
      alpha: 0,
      delay: 200,
      duration: 700,
      onUpdate: () => (label.y = Math.round(label.y)),
      onComplete: () => label.destroy(),
    });
  }

  private banner(text: string, tint = 0xffffff, flash = false) {
    const { width: w, height: h } = this.scale;
    const s = this.fitScale(text, this.hudScale * 2);
    const label = this.add.bitmapText(Math.round(w / 2), Math.round(h * 0.4), PIXEL_FONT, text).setOrigin(0.5).setTint(tint).setScale(0);
    this.ui.add(label);
    this.tweens.add({ targets: label, scale: s, duration: 300, ease: 'Back.easeOut' });
    if (flash) this.tweens.add({ targets: label, alpha: 0.2, duration: 200, yoyo: true, repeat: 4, delay: 300 });
    this.tweens.add({ targets: label, alpha: 0, duration: 400, delay: flash ? 2000 : 1000, onComplete: () => label.destroy() });
  }

  private drawBossBar() {
    const g = this.bossBar.clear();
    const e = this.boss;
    if (!e || e.dead || this.state !== 'playing') return;
    const { width: w } = this.scale;
    const s = this.hudScale;
    const bw = Math.min(this.fieldW * this.zoom - 40, 120 * s);
    const x = Math.round(w / 2 - bw / 2);
    const y = Math.round(this.fieldH * this.zoom - 10 * s);
    g.fillStyle(INK, 0.9).fillRect(x - s, y - s, bw + 2 * s, 4 * s);
    g.fillStyle(0xff5a4a).fillRect(x, y, Math.round((bw * Math.max(0, e.hp)) / e.maxHp), 2 * s);
  }

  private voice(name: Voice) {
    this.sound.play(`voice:${name}`, { volume: 0.8 });
  }

  // ---- Overlays ------------------------------------------------------------------------------

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

  private text(x: number, y: number, str: string, scale: number, tint = 0xffffff) {
    return this.add.bitmapText(Math.round(x), Math.round(y), PIXEL_FONT, str).setScale(scale).setTint(tint);
  }

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
    if (edge !== undefined) box(-u, -u, w + 2 * u, h + 2 * u, edge);
    box(0, 0, w, h, fill);
    return g;
  }

  private button(x: number, y: number, label: string, u: number, onClick: () => void) {
    const s = u + 1;
    const text = this.text(x, y, label, s).setOrigin(0.5);
    const w = Math.round(text.width + 14 * s);
    const h = Math.round(text.height + 6 * s);
    const left = Math.round(x - w / 2);
    const top = Math.round(y - h / 2);
    const face = this.panel(left, top, w, h, u, 0x3b9be0, INK);
    face.fillStyle(0x7cc4f5).fillRect(left + u, top, w - 2 * u, u);
    const zone = this.add.zone(x, y, w + 8, h + 8).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => face.setAlpha(0.85));
    zone.on('pointerout', () => (face.setAlpha(1), face.setY(0), text.setY(Math.round(y))));
    zone.on('pointerdown', () => (face.setY(u), text.setY(Math.round(y) + u)));
    zone.on('pointerup', () => {
      face.setY(0);
      text.setY(Math.round(y));
      onClick();
    });
    return { parts: [face, text, zone] as Phaser.GameObjects.GameObject[], h };
  }

  private fitScale(str: string, max: number, margin = 32) {
    const probe = this.add.bitmapText(0, 0, PIXEL_FONT, str);
    const w = probe.width;
    probe.destroy();
    return Phaser.Math.Clamp(Math.floor((Math.min(this.scale.width, this.fieldW * this.zoom) - margin) / w), 1, max);
  }

  private showTitle() {
    this.state = 'title';
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const cx = Math.round(w / 2);
      const u = this.unit;
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const ts = this.fitScale('ISLAND RAID', u * 2 + 1);
      const lines = touch
        ? ['DRAG ANYWHERE TO FLY. YOUR GUNS FIRE ON THEIR OWN', 'TAP TO DROP A BOMB ON THE CROSSHAIR']
        : ['FLY WITH THE MOUSE OR ARROW KEYS. YOUR GUNS FIRE ON THEIR OWN', 'CLICK OR SPACE TO DROP A BOMB ON THE CROSSHAIR'];
      const maxLine = Math.min(this.fieldW * this.zoom - 48, 260 * u);
      const title = this.text(cx, 0, 'ISLAND RAID', ts).setOrigin(0.5, 0);
      const how = this.text(cx, 0, lines[0], u).setOrigin(0.5, 0).setCenterAlign().setMaxWidth(maxLine);
      const bomb = this.text(cx, 0, lines[1], u, GOLD).setOrigin(0.5, 0).setCenterAlign().setMaxWidth(maxLine);
      // A row of what's on the ground worth bombing.
      const icons = [T.gun, T.tank, T.bunker, T.truck].map((f) => this.add.image(0, 0, TILES, f).setScale(u).setOrigin(0.5, 0));
      const pad = 8 * u;
      const iconH = TILE * u;
      const panelW = Math.round(Math.max(how.width, bomb.width) + pad * 2);
      const panelH = pad + how.height + 6 * u + iconH + 6 * u + bomb.height + pad;
      const btnH = 22 * (u + 1);
      const total = title.height + 8 * u + panelH + 10 * u + btnH + (this.best ? 8 * u + TILE * u : 0);
      let y = Math.max(8, Math.round((h - total) / 2 - h * 0.08));
      title.setY(y);
      this.tweens.add({ targets: title, y: y - u, duration: 600, yoyo: true, repeat: -1, ease: 'Stepped' });
      y += title.height + 8 * u;
      const panel = this.panel(Math.round(cx - panelW / 2), y, panelW, panelH, u, INK).setAlpha(0.9);
      how.setY(y + pad);
      const iconY = y + pad + how.height + 6 * u;
      icons.forEach((icon, i) => icon.setPosition(Math.round(cx + (i - 1.5) * 22 * u), iconY));
      bomb.setY(iconY + iconH + 6 * u);
      y += panelH + 10 * u;
      const play = this.button(cx, y + btnH / 2, 'TAKE OFF', u, () => this.startGame());
      y += btnH + 8 * u;
      const parts: Phaser.GameObjects.GameObject[] = [title, panel, how, ...icons, bomb, ...play.parts];
      if (this.best) parts.push(this.text(cx, y, `BEST ${this.best}`, u, GOLD).setOrigin(0.5, 0));
      return parts;
    });
  }

  private showGameOver(record: boolean, animate: boolean) {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const cx = Math.round(w / 2);
      const u = this.unit;
      const ts = this.fitScale('SHOT DOWN', u * 2 + 1);
      const title = this.text(cx, 0, 'SHOT DOWN', ts, 0xffd0cc).setOrigin(0.5, 0);
      const pad = 8 * u;
      const rowH = TILE * u + 4 * u;
      const bigS = u + 1;
      const panelW = Math.min(this.fieldW * this.zoom - 24, 150 * u);
      const rowsData = [
        ['PLANES', `${this.planesDown}`],
        ['GROUND', `${this.groundDown}`],
        ...(this.bossesDown ? [['BOMBERS', `${this.bossesDown}`]] : []),
        ['BEST', `${this.best}`],
      ];
      const panelH = pad + TILE * bigS + 6 * u + rowH * rowsData.length + pad - 4 * u;
      const btnH = 22 * (u + 1);
      const total = title.height + 8 * u + panelH + 12 * u + btnH;
      let y = Math.max(8, Math.round((h - total) / 2));
      title.setY(y);
      y += title.height + 8 * u;
      const left = Math.round(cx - panelW / 2);
      const right = left + panelW;
      const panel = this.panel(left, y, panelW, panelH, u, INK, PALE);
      let ry = y + pad;
      const scoreLabel = this.text(left + pad, ry + (TILE * bigS - TILE * u) / 2, 'SCORE', u, PALE);
      const scoreNum = this.text(right - pad, ry, animate ? '0' : `${this.score}`, bigS, GOLD).setOrigin(1, 0);
      ry += TILE * bigS + 6 * u;
      const rows = rowsData.flatMap(([name, value], i) => [
        this.text(left + pad, ry + i * rowH, name, u, PALE),
        this.text(right - pad, ry + i * rowH, value, u).setOrigin(1, 0),
      ]);
      const bestValue = rows[rows.length - 1];
      const newTag = record ? this.text(right - pad - bestValue.width - 6 * u, bestValue.y, 'NEW!', u, 0xff6a5c).setOrigin(1, 0) : undefined;
      y += panelH + 12 * u;
      const again = this.button(cx, y + btnH / 2, 'AGAIN', u, () => this.startGame());
      const shade = this.add.rectangle(0, 0, w, h, INK, 0.35).setOrigin(0);
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
        if (!newTag) return;
        newTag.setVisible(true);
        this.tweens.add({ targets: newTag, alpha: { from: 0, to: 1 }, duration: 300, yoyo: true, repeat: 2 });
        playSfx(this, SFX, 'record', { volume: 0.6, detune: 0 });
        this.later(500, () => this.voice('new_highscore'));
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
