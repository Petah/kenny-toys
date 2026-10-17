import * as Phaser from 'phaser';
import { FONT_BODY, FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { fitCard, makeButton } from '@shared/ui';
import { BALL, SFX, brickKey, makeBallTexture, preloadAssets, specialKey } from './assets';
import {
  BALL_R, CELL, COLOURS, HEIGHT, PADDLE_Y, ROW, SPECIALS, TOP, WIDTH,
  chain, moveBall, parseLevel, remaining,
  type Ball, type Brick, type Drop, type Power, type StepEvents,
} from './field';
import { LEVELS } from './levels';

const LIVES = 3;
const PADDLE_UNITS = 4;
const WIDE_UNITS = 6;
const WIDE_TIME = 15;
const SLOW_TIME = 10;
const DROP_SPEED = 150;
const MAX_BALLS = 12;
/** Field units of frame drawn round the play area. */
const FRAME = 14;
/** Seconds without breaking anything before bounces start to wander, so no ball loops forever. */
const STALE = 12;
const KEY_SPEED = 620;

const POWER_NAMES: Record<Power, string> = { multi: 'MULTI BALL', wide: 'WIDE PADDLE', slow: 'SLOW MO', life: '+1 LIFE' };

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#1d3f73',
  strokeThickness: 8,
  align: 'center',
};

type State = 'title' | 'play' | 'clear' | 'over';

interface BrickView {
  img: Phaser.GameObjects.Image;
  crack?: Phaser.GameObjects.Graphics;
}

export class BreakScene extends Phaser.Scene {
  private state: State = 'title';
  private bricks: Brick[] = [];
  private views = new Map<number, BrickView>();
  private balls: Ball[] = [];
  private ballImgs = new Map<number, Phaser.GameObjects.Image>();
  /** Where a stuck ball sits along the paddle. */
  private stuckAt = new Map<number, number>();
  private trails = new Map<number, { x: number; y: number }[]>();
  private drops: { drop: Drop; img: Phaser.GameObjects.Image }[] = [];
  private nextId = 1;

  private paddleX = WIDTH / 2;
  private paddleUnits = PADDLE_UNITS;
  private wideLeft = 0;
  private slowLeft = 0;

  /** Levels played this run, from 1; past the tenth they come round again. */
  private level = 1;
  private lives = LIVES;
  private score = 0;
  private best = 0;
  private combo = 0;
  private bestCombo = 0;
  private paddleHits = 0;
  private stale = 0;
  private lastWallSfx = 0;

  private s = 1;
  private bg!: Phaser.GameObjects.Graphics;
  private world!: Phaser.GameObjects.Container;
  private board!: Phaser.GameObjects.Graphics;
  private brickLayer!: Phaser.GameObjects.Container;
  private trailGfx!: Phaser.GameObjects.Graphics;
  private paddle!: Phaser.GameObjects.Image;
  private bits = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private hint!: Phaser.GameObjects.Text;
  private keys?: Phaser.Types.Input.Keyboard.CursorKeys;

  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private livesGfx: Phaser.GameObjects.Image[] = [];
  private powerText!: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private music?: Phaser.Sound.BaseSound;
  private timers: Phaser.Time.TimerEvent[] = [];

  constructor() {
    super('break');
  }

  preload() {
    preloadAssets(this);
  }

  create() {
    makeBallTexture(this, BALL_R);
    this.bg = this.add.graphics().setDepth(0);
    this.world = this.add.container(0, 0).setDepth(1);
    this.board = this.add.graphics();
    this.brickLayer = this.add.container(0, 0);
    this.trailGfx = this.add.graphics();
    this.paddle = this.add.image(0, 0, brickKey('Blue', PADDLE_UNITS)).setOrigin(0.5, 1).setScale(0.5);
    this.world.add([this.board, this.brickLayer, this.trailGfx, this.paddle]);
    // Bits of broken brick, one emitter per colour.
    for (const colour of Object.values(COLOURS)) {
      const e = this.add.particles(0, 0, brickKey(colour, 1), {
        speed: { min: 60, max: 220 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.28, end: 0.18 },
        rotate: { start: 0, end: { random: [-540, 540] } } as unknown as Phaser.Types.GameObjects.Particles.EmitterOpOnEmitType,
        alpha: { start: 1, end: 0 },
        gravityY: 700,
        lifespan: 800,
        emitting: false,
      });
      this.bits.set(colour, e);
      this.world.add(e);
    }
    this.hint = this.add.text(WIDTH / 2, PADDLE_Y - 70, '', { ...TEXT, fontFamily: FONT_BODY, fontSize: '18px', strokeThickness: 5 }).setOrigin(0.5);
    this.world.add(this.hint);
    this.tweens.add({ targets: this.hint, alpha: { from: 1, to: 0.45 }, duration: 600, yoyo: true, repeat: -1 });

    this.scoreText = this.add.text(0, 0, '0', { ...TEXT, fontSize: '40px', strokeThickness: 9 }).setDepth(30);
    this.bestText = this.add.text(0, 0, '', { ...TEXT, fontSize: '18px', strokeThickness: 6, color: '#ffe066' }).setOrigin(1, 0).setDepth(30);
    this.levelText = this.add.text(0, 0, '', { ...TEXT, fontSize: '22px', strokeThickness: 6 }).setOrigin(0.5, 0).setDepth(30);
    this.powerText = this.add.text(0, 0, '', { ...TEXT, fontFamily: FONT_BODY, fontSize: '15px', strokeThickness: 5, color: '#bdf2ff' }).setOrigin(1, 0).setDepth(30);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.aim(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.aim(p);
      this.launch();
    });
    this.keys = this.input.keyboard?.createCursorKeys();
    this.input.keyboard?.on('keydown-SPACE', () => (this.state === 'play' ? this.launch() : this.confirm()));
    this.input.keyboard?.on('keydown-ENTER', () => this.confirm());
    this.input.keyboard?.on('keydown-UP', () => this.launch());
    this.scale.on('resize', () => this.layout());

    this.best = load('brick-breaker:best', 0);
    this.buildLevel(false);
    this.layout();
    this.showTitle();
  }

  // ---- Layout ------------------------------------------------------------------------------

  private get k() {
    return Math.min(this.scale.width / 520, this.scale.height / 760, 1.4);
  }

  private layout() {
    const { width: w, height: h } = this.scale;
    const narrow = w < 700;
    const top = narrow ? 92 : 62;
    // The board from the frame round its ceiling down to the bottom of the screen.
    const ceiling = TOP - ROW - FRAME;
    const fw = WIDTH + FRAME * 2;
    const fh = HEIGHT - ceiling;
    this.s = Math.min((w - 12) / fw, (h - top - 4) / fh);
    const spare = h - top - 4 - fh * this.s;
    this.world.setScale(this.s).setPosition((w - WIDTH * this.s) / 2, top + spare / 2 - ceiling * this.s);

    this.bg.clear().fillGradientStyle(0x52b0e8, 0x52b0e8, 0x2a7cc4, 0x2a7cc4, 1).fillRect(0, 0, w, h);
    const g = this.board.clear();
    // Runs on past the bottom of the screen, however tall it is.
    const below = HEIGHT + h / this.s;
    g.fillStyle(0x0f3d6e, 0.35).fillRoundedRect(-FRAME, ceiling + 6, fw, below, 18);
    g.fillStyle(0xe8f4fc, 1).fillRoundedRect(-FRAME, ceiling, fw, below, 18);
    g.fillStyle(0x2f86cc, 1).fillRect(0, TOP - ROW, WIDTH, below);
    // A baseplate's studs, faintly.
    g.fillStyle(0xffffff, 0.06);
    for (let y = TOP - ROW + CELL / 2; y < HEIGHT; y += CELL) for (let x = CELL / 2; x < WIDTH; x += CELL) g.fillCircle(x, y, 9);
    g.fillStyle(0x1d5f9c, 0.6).fillRect(0, PADDLE_Y + 30, WIDTH, below);

    const k = Math.min(1, w / 460);
    this.scoreText.setPosition(narrow ? 14 : 160, narrow ? 50 : 10).setScale(k);
    this.levelText.setPosition(w / 2, narrow ? 14 : 18).setScale(k);
    if (narrow) this.levelText.setX(w / 2 + 50);
    this.bestText.setPosition(w - 14, narrow ? 58 : 14).setScale(k);
    this.powerText.setPosition(w - 14, narrow ? 78 : 36).setScale(k);
    this.drawLives();
    this.rebuildOverlay?.();
  }

  private drawLives() {
    for (const l of this.livesGfx) l.destroy();
    this.livesGfx = [];
    if (this.state !== 'play' && this.state !== 'clear') return;
    const k = Math.min(1, this.scale.width / 460);
    const narrow = this.scale.width < 700;
    for (let i = 0; i < this.lives; i++) {
      // Phones: a centred row under the level, clear of a long score. Wider: left of the level.
      const x = narrow ? this.scale.width / 2 + 50 + (i - (this.lives - 1) / 2) * 26 * k : this.scale.width / 2 - 110 * k - i * 26 * k;
      const y = narrow ? 64 : 32;
      this.livesGfx.push(this.add.image(x, y, BALL).setScale(0.36 * k).setDepth(30));
    }
  }

  private aim(p: Phaser.Input.Pointer) {
    if (this.state !== 'play') return;
    this.paddleX = (p.x - this.world.x) / this.s;
    this.clampPaddle();
  }

  private get paddleW() {
    return this.paddleUnits * CELL;
  }

  private clampPaddle() {
    this.paddleX = Phaser.Math.Clamp(this.paddleX, this.paddleW / 2, WIDTH - this.paddleW / 2);
  }

  // ---- Level -------------------------------------------------------------------------------

  private buildLevel(animate: boolean) {
    for (const v of this.views.values()) {
      v.img.destroy();
      v.crack?.destroy();
    }
    this.views.clear();
    const def = LEVELS[(this.level - 1) % LEVELS.length];
    this.bricks = parseLevel(def.map);
    // Lower bricks first, so each brick's studs tuck under the one above.
    const order = [...this.bricks].sort((a, b) => b.y - a.y);
    for (const k of order) {
      const key = k.special ? specialKey(SPECIALS[k.special].frame) : brickKey(k.colour!, k.units);
      const img = this.add.image(k.x, k.y + k.h, key).setOrigin(0, 1).setScale(0.5);
      this.brickLayer.add(img);
      this.views.set(k.id, { img });
      if (animate) {
        const to = img.y;
        img.y = to - HEIGHT;
        this.tweens.add({ targets: img, y: to, duration: 520, delay: (k.x / WIDTH) * 180 + ((HEIGHT - k.y) / HEIGHT) * 260, ease: 'Bounce.easeOut' });
      }
    }
  }

  private newBall(stuck: boolean, from?: Ball): Ball {
    const b: Ball = from
      ? { ...from, id: this.nextId++ }
      : { id: this.nextId++, x: this.paddleX, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, stuck };
    this.balls.push(b);
    const img = this.add.image(b.x, b.y, BALL).setScale(0.25);
    this.world.add(img);
    this.ballImgs.set(b.id, img);
    this.trails.set(b.id, []);
    if (stuck) this.stuckAt.set(b.id, Phaser.Math.Between(-12, 12));
    return b;
  }

  private removeBall(b: Ball) {
    this.balls = this.balls.filter((o) => o !== b);
    this.ballImgs.get(b.id)?.destroy();
    this.ballImgs.delete(b.id);
    this.stuckAt.delete(b.id);
    this.trails.delete(b.id);
  }

  private clearBalls() {
    for (const b of [...this.balls]) this.removeBall(b);
    for (const d of this.drops) d.img.destroy();
    this.drops = [];
  }

  private get speed() {
    const base = 300 + Math.min(this.level - 1, 15) * 12;
    return Math.min(base + this.paddleHits * 3, base + 150) * (this.slowLeft > 0 ? 0.7 : 1);
  }

  private launch() {
    if (this.state !== 'play') return;
    const stuck = this.balls.filter((b) => b.stuck);
    if (!stuck.length) return;
    for (const b of stuck) {
      const off = (this.stuckAt.get(b.id) ?? 0) / (this.paddleW / 2);
      const a = Phaser.Math.Clamp(off, -1, 1) * 0.5 + Phaser.Math.FloatBetween(-0.12, 0.12);
      b.vx = Math.sin(a) * this.speed;
      b.vy = -Math.cos(a) * this.speed;
      b.stuck = false;
      this.stuckAt.delete(b.id);
    }
    this.hint.setText('');
    playSfx(this, SFX, 'launch', { volume: 0.5 });
  }

  // ---- Play --------------------------------------------------------------------------------

  private step(dt: number) {
    if (this.keys?.left.isDown) this.paddleX -= KEY_SPEED * dt;
    if (this.keys?.right.isDown) this.paddleX += KEY_SPEED * dt;
    this.clampPaddle();

    if (this.wideLeft > 0) {
      this.wideLeft -= dt;
      if (this.wideLeft <= 0) this.setPaddle(PADDLE_UNITS);
    }
    if (this.slowLeft > 0) this.slowLeft -= dt;
    this.drawPowers();

    this.stale += dt;
    const speed = this.speed;
    const ev: StepEvents = { hits: [], walls: 0, paddle: [], lost: [], explode: [] };
    for (const b of [...this.balls]) {
      if (b.stuck) {
        b.x = this.paddleX + (this.stuckAt.get(b.id) ?? 0);
        b.y = PADDLE_Y - BALL_R;
        continue;
      }
      // Keep every ball at the current speed (slow-mo and the slow climb with paddle hits).
      const v = Math.hypot(b.vx, b.vy) || 1;
      b.vx *= speed / v;
      b.vy *= speed / v;
      const walls = ev.walls;
      moveBall(b, dt, this.bricks, { x: this.paddleX, w: this.paddleW }, ev);
      if (ev.walls > walls && this.stale > STALE) {
        // Nudge a ball that's been looping without breaking anything.
        const a = Math.atan2(b.vy, b.vx) + Phaser.Math.FloatBetween(-0.25, 0.25);
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
        if (Math.abs(b.vy) < speed * 0.35) b.vy = Math.sign(b.vy || 1) * speed * 0.35;
      }
    }

    if (ev.walls && this.time.now - this.lastWallSfx > 60) {
      this.lastWallSfx = this.time.now;
      playSfx(this, SFX, 'wall', { volume: 0.25 });
    }
    for (const b of ev.paddle) this.onPaddle(b);
    for (const h of ev.hits) this.onHit(h.brick, h.broke);
    for (const b of ev.lost) this.removeBall(b);
    if (ev.lost.length && !this.balls.length) this.loseLife();

    this.stepDrops(dt);
    if (this.state === 'play' && remaining(this.bricks) === 0) this.levelClear();
  }

  private onPaddle(b: Ball) {
    this.paddleHits++;
    if (this.combo >= 5) this.floatText(`COMBO ×${this.combo}`, b.x, PADDLE_Y - 40, '#ffe066', 22);
    this.combo = 0;
    playSfx(this, SFX, 'paddle', { volume: 0.45 });
    this.tweens.killTweensOf(this.paddle);
    this.paddle.setScale(0.5);
    this.tweens.add({ targets: this.paddle, scaleY: 0.42, scaleX: 0.53, duration: 60, yoyo: true });
  }

  private onHit(k: Brick, broke: boolean) {
    const v = this.views.get(k.id);
    if (!broke) {
      if (k.hp === 0) {
        // Stone.
        playSfx(this, SFX, 'stone', { volume: 0.35 });
      } else {
        // A black brick's first hit cracks it.
        playSfx(this, SFX, 'crack', { volume: 0.45 });
        if (v && !v.crack) {
          const c = this.add.graphics();
          c.lineStyle(1.5, 0xffffff, 0.75);
          for (let u = 0; u < k.units; u++) {
            const x = k.x + u * CELL + 8 + ((u * 7) % 14);
            c.beginPath().moveTo(x, k.y + 1).lineTo(x + 5, k.y + 6).lineTo(x - 1, k.y + 9).lineTo(x + 4, k.y + k.h - 1).strokePath();
          }
          this.brickLayer.add(c);
          v.crack = c;
        }
      }
      if (v) this.tweens.add({ targets: v.img, y: v.img.y - 2, duration: 50, yoyo: true });
      return;
    }
    const gone = chain(k, this.bricks);
    if (gone.length > 1) this.explodeFx(gone);
    for (const g of gone) this.smash(g);
    this.stale = 0;
  }

  /** Takes a broken brick off the board with a burst of bits, points and maybe a power. */
  private smash(k: Brick) {
    const v = this.views.get(k.id);
    this.views.delete(k.id);
    v?.crack?.destroy();
    if (v) {
      const img = v.img;
      this.tweens.add({ targets: img, alpha: 0, scaleX: 0.55, scaleY: 0.55, y: img.y - 4, duration: 90, onComplete: () => img.destroy() });
    }
    const spec = k.special ? SPECIALS[k.special] : undefined;
    const colour = k.colour ?? (spec?.explode ? 'Red' : 'Yellow');
    const e = this.bits.get(colour)!;
    for (let u = 0; u < k.units; u++) e.explode(k.rows > 1 ? 4 : 2, k.x + u * CELL + CELL / 2, k.y + k.h / 2);
    if (spec?.explode) this.bits.get('Yellow')!.explode(6, k.x + k.w / 2, k.y + k.h / 2);

    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const base = k.special ? (spec?.power ? 50 : 30) : k.units * (k.colour === 'Black' ? 20 : 10);
    const pts = base + (this.combo - 1) * 5;
    this.score += pts;
    this.scoreText.setText(String(this.score));
    playSfx(this, SFX, 'pop', { volume: 0.4, rate: 1 + Math.min(this.combo, 12) * 0.04 });
    if (this.combo > 1 && this.combo % 5 === 0) {
      playSfx(this, SFX, 'combo', { volume: 0.3, detune: 0 });
      this.floatText(`×${this.combo}`, k.x + k.w / 2, k.y, '#ffe066', 22);
    } else this.floatText(`+${pts}`, k.x + k.w / 2, k.y + k.h / 2, '#ffffff', 13);

    if (spec?.power) {
      const d: Drop = { id: this.nextId++, x: k.x + k.w / 2, y: k.y + k.h / 2, power: spec.power };
      const img = this.add.image(d.x, d.y, specialKey(spec.frame)).setScale(0.22);
      this.world.add(img);
      this.tweens.add({ targets: img, angle: { from: -10, to: 10 }, duration: 260, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.drops.push({ drop: d, img });
      playSfx(this, SFX, 'release', { volume: 0.35 });
    }
  }

  private explodeFx(gone: Brick[]) {
    playSfx(this, SFX, 'boom', { volume: 0.55 });
    this.cameras.main.shake(200, 0.01);
    for (const k of gone) {
      if (!k.special || !SPECIALS[k.special].explode) continue;
      const ring = this.add.graphics();
      ring.lineStyle(8, 0xfff2b0, 1).strokeCircle(0, 0, 70);
      ring.fillStyle(0xffb03a, 0.35).fillCircle(0, 0, 70);
      ring.setPosition(k.x + k.w / 2, k.y + k.h / 2).setScale(0.2);
      this.world.add(ring);
      this.tweens.add({ targets: ring, scale: 1, alpha: 0, duration: 340, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
    }
  }

  private stepDrops(dt: number) {
    for (const d of [...this.drops]) {
      d.drop.y += DROP_SPEED * dt;
      d.img.setPosition(d.drop.x, d.drop.y);
      const caught = d.drop.y + 14 >= PADDLE_Y && d.drop.y - 14 <= PADDLE_Y + 16 && Math.abs(d.drop.x - this.paddleX) <= this.paddleW / 2 + 14;
      if (caught || d.drop.y > HEIGHT + 30) {
        this.drops = this.drops.filter((o) => o !== d);
        d.img.destroy();
        if (caught) this.power(d.drop.power, d.drop.x);
      }
    }
  }

  private power(p: Power, x: number) {
    playSfx(this, SFX, 'power', { volume: 0.5 });
    this.later(250, () => playSfx(this, SFX, 'powerVoice', { volume: 0.5, detune: 0 }));
    this.floatText(POWER_NAMES[p], x, PADDLE_Y - 30, '#bdf2ff', 20);
    this.score += 100;
    this.scoreText.setText(String(this.score));
    if (p === 'multi') {
      const moving = this.balls.filter((b) => !b.stuck);
      if (!moving.length) this.launch();
      for (const b of this.balls.filter((o) => !o.stuck)) {
        for (const turn of [-0.35, 0.35]) {
          if (this.balls.length >= MAX_BALLS) break;
          const a = Math.atan2(b.vy, b.vx) + turn;
          const s = Math.hypot(b.vx, b.vy);
          const nb = this.newBall(false, b);
          nb.vx = Math.cos(a) * s;
          nb.vy = Math.sin(a) * s;
          // Never send a copy downwards past the horizontal.
          if (Math.abs(nb.vy) < s * 0.35) nb.vy = -s * 0.35;
        }
      }
    } else if (p === 'wide') {
      this.wideLeft = WIDE_TIME;
      this.setPaddle(WIDE_UNITS);
    } else if (p === 'slow') {
      this.slowLeft = SLOW_TIME;
    } else if (p === 'life') {
      this.lives++;
      this.drawLives();
    }
  }

  private setPaddle(units: number) {
    if (units === this.paddleUnits) return;
    this.paddleUnits = units;
    this.paddle.setTexture(brickKey('Blue', units));
    this.clampPaddle();
    this.tweens.killTweensOf(this.paddle);
    this.paddle.setScale(0.5);
    this.tweens.add({ targets: this.paddle, scaleX: { from: units > PADDLE_UNITS ? 0.36 : 0.62, to: 0.5 }, duration: 260, ease: 'Back.easeOut' });
  }

  private drawPowers() {
    const parts: string[] = [];
    if (this.wideLeft > 0) parts.push(`WIDE ${Math.ceil(this.wideLeft)}`);
    if (this.slowLeft > 0) parts.push(`SLOW ${Math.ceil(this.slowLeft)}`);
    this.powerText.setText(parts.join('  '));
  }

  private loseLife() {
    this.lives--;
    this.combo = 0;
    playSfx(this, SFX, 'lost', { volume: 0.5, detune: 0 });
    this.cameras.main.shake(160, 0.006);
    this.cameras.main.flash(160, 255, 80, 80);
    for (const d of this.drops) d.img.destroy();
    this.drops = [];
    this.wideLeft = 0;
    this.slowLeft = 0;
    this.setPaddle(PADDLE_UNITS);
    this.drawLives();
    if (this.lives <= 0) {
      void this.gameOver();
      return;
    }
    this.newBall(true);
    this.hint.setText(this.tapHint());
  }

  private tapHint() {
    return this.sys.game.device.input.touch ? 'tap to launch' : 'click or space to launch';
  }

  private levelClear() {
    this.state = 'clear';
    const bonus = 250 + this.lives * 50;
    this.score += bonus;
    this.scoreText.setText(String(this.score));
    for (const b of this.balls) {
      const img = this.ballImgs.get(b.id);
      if (img) this.tweens.add({ targets: img, alpha: 0, scale: 0.6, duration: 300 });
    }
    playSfx(this, SFX, 'clear', { volume: 0.5, detune: 0 });
    this.later(700, () => playSfx(this, SFX, 'levelUp', { volume: 0.6, detune: 0 }));
    this.banner('WALL DOWN!', `+${bonus} bonus`);
    this.later(2000, () => {
      this.clearBalls();
      this.level++;
      this.startLevel();
    });
  }

  private startLevel() {
    this.state = 'play';
    this.paddleHits = 0;
    this.combo = 0;
    this.stale = 0;
    this.wideLeft = 0;
    this.slowLeft = 0;
    this.setPaddle(PADDLE_UNITS);
    this.buildLevel(true);
    this.newBall(true);
    const def = LEVELS[(this.level - 1) % LEVELS.length];
    const lap = Math.floor((this.level - 1) / LEVELS.length);
    this.levelText.setText(`LEVEL ${this.level}`);
    this.banner(`LEVEL ${this.level}`, lap ? `${def.name} · faster!` : def.name);
    this.hint.setText(this.tapHint());
    this.drawLives();
  }

  private banner(big: string, small: string) {
    const { width: w, height: h } = this.scale;
    const k = this.k;
    const t = this.add.text(w / 2, h * 0.5, big, { ...TEXT, fontSize: '56px', strokeThickness: 12 }).setOrigin(0.5).setDepth(45);
    const sub = this.add.text(w / 2, h * 0.5 + 50 * k, small, { ...TEXT, fontFamily: FONT_BODY, fontSize: '22px', strokeThickness: 6, color: '#ffe066' }).setOrigin(0.5).setDepth(45);
    const fit = Math.min(k, (w - 32) / t.width);
    t.setScale(0);
    sub.setScale(Math.min(k, (w - 32) / sub.width)).setAlpha(0);
    this.tweens.add({ targets: t, scale: fit, duration: 320, ease: 'Back.easeOut' });
    this.tweens.add({ targets: sub, alpha: 1, duration: 300, delay: 150 });
    this.tweens.add({ targets: [t, sub], alpha: 0, y: '-=30', duration: 400, delay: 1500, onComplete: () => { t.destroy(); sub.destroy(); } });
  }

  private floatText(text: string, x: number, y: number, colour: string, size: number) {
    const t = this.add.text(x, y, text, { ...TEXT, fontSize: `${size}px`, color: colour, strokeThickness: Math.max(4, size / 4) }).setOrigin(0.5);
    this.world.add(t);
    this.tweens.add({ targets: t, y: y - 30, alpha: { from: 1, to: 0 }, duration: 800, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
    this.tweens.add({ targets: t, scale: { from: 0.4, to: 1 }, duration: 200, ease: 'Back.easeOut' });
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(this.time.delayedCall(ms, fn));
  }

  // ---- Flow --------------------------------------------------------------------------------

  private setOverlay(build?: () => Phaser.GameObjects.GameObject[]) {
    this.rebuildOverlay = build && (() => this.setOverlay(build));
    this.overlay?.destroy();
    this.overlay = undefined;
    if (!build) return;
    this.overlay = this.add.container(0, 0, build()).setDepth(50);
  }

  private button(x: number, y: number, label: string, onClick: () => void) {
    return makeButton(this, x, y, label, onClick, { textStyle: TEXT, color: 0xe8473a, onPress: () => playSfx(this, SFX, 'click', { volume: 0.4 }) }).parts;
  }

  private setHud(on: boolean) {
    for (const o of [this.scoreText, this.bestText, this.levelText, this.powerText, this.paddle]) o.setVisible(on);
    this.bestText.setText(this.best ? `best ${this.best}` : '');
    this.drawLives();
  }

  private confirm() {
    if (this.state === 'title' || this.state === 'over') this.start();
  }

  private showTitle() {
    this.state = 'title';
    this.setHud(false);
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const shade = this.add.rectangle(0, 0, w, h, 0x0f2d5c, 0.45).setOrigin(0);
      const card = this.add.container(w / 2, h * 0.45);
      const title = this.add.text(0, -140, 'BRICK BREAKER', { ...TEXT, fontSize: '68px', strokeThickness: 13 }).setOrigin(0.5);
      this.tweens.add({ targets: title, angle: { from: -2, to: 2 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const faces = ['a', 'b', 'c', 'd', 'e'].map((c, i) => {
        const img = this.add.image((i - 2) * 76, -40, specialKey(`extra_character_${c}`)).setScale(0.5);
        this.tweens.add({ targets: img, y: -54, duration: 420 + i * 60, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        return img;
      });
      const how = this.add.text(0, 50, 'Bounce the ball to knock down every brick.\nBreak the little characters for power-ups!', { ...TEXT, fontFamily: FONT_BODY, fontSize: '20px', strokeThickness: 6, lineSpacing: 6 }).setOrigin(0.5);
      const parts: Phaser.GameObjects.GameObject[] = [title, ...faces, how, ...this.button(0, 150, 'PLAY', () => this.start())];
      if (this.best) parts.push(this.add.text(0, 224, `best ${this.best}`, { ...TEXT, fontSize: '24px', color: '#ffe066', strokeThickness: 7 }).setOrigin(0.5));
      card.add(parts);
      fitCard(card, this.k, w, 620, title);
      return [shade, card];
    });
  }

  private start() {
    for (const t of this.timers) t.remove();
    this.timers = [];
    this.music ??= this.sound.add('music', { loop: true, volume: 0.3 });
    if (!this.music.isPlaying) this.music.play();
    this.clearBalls();
    this.level = 1;
    this.lives = LIVES;
    this.score = 0;
    this.bestCombo = 0;
    this.paddleX = WIDTH / 2;
    this.scoreText.setText('0');
    this.setOverlay();
    this.state = 'play';
    this.setHud(true);
    this.startLevel();
    playSfx(this, SFX, 'go', { volume: 0.6, detune: 0 });
  }

  private async gameOver() {
    this.state = 'over';
    this.hint.setText('');
    const { best, isNew } = submitHighScore('brick-breaker', this.score);
    this.best = best;
    const record = isNew && this.score > 0;
    this.later(400, () => playSfx(this, SFX, record ? 'best' : 'gameOver', { volume: 0.6, detune: 0 }));
    this.later(1200, () => playSfx(this, SFX, 'done', { volume: 0.5, detune: 0 }));
    this.setHud(false);
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const shade = this.add.rectangle(0, 0, w, h, 0x0f2d5c, 0.5).setOrigin(0);
      const card = this.add.container(w / 2, h * 0.45);
      const title = this.add.text(0, -170, record ? 'NEW BEST!' : 'GAME OVER', { ...TEXT, fontSize: '62px', strokeThickness: 12 }).setOrigin(0.5);
      const panel = this.add.graphics();
      panel.fillStyle(0x0f2d5c, 0.4).fillRoundedRect(-200, -102, 400, 200, 26);
      panel.fillStyle(0xeaf3ff, 1).fillRoundedRect(-200, -110, 400, 200, 26);
      panel.lineStyle(5, 0xe8473a, 1).strokeRoundedRect(-200, -110, 400, 200, 26);
      const label = { ...TEXT, fontSize: '20px', color: '#c4382c', strokeThickness: 0 };
      const big = { ...TEXT, color: '#1d3f73', strokeThickness: 0 };
      card.add([
        title, panel,
        this.add.text(0, -88, 'SCORE', label).setOrigin(0.5),
        this.add.text(0, -40, String(this.score), { ...big, fontSize: '58px' }).setOrigin(0.5),
        this.add.text(-120, 18, 'BEST', label).setOrigin(0.5),
        this.add.text(-120, 52, String(this.best), { ...big, fontSize: '28px' }).setOrigin(0.5),
        this.add.text(0, 18, 'LEVEL', label).setOrigin(0.5),
        this.add.text(0, 52, String(this.level), { ...big, fontSize: '28px' }).setOrigin(0.5),
        this.add.text(120, 18, 'COMBO', label).setOrigin(0.5),
        this.add.text(120, 52, `×${this.bestCombo}`, { ...big, fontSize: '28px' }).setOrigin(0.5),
        ...this.button(0, 160, 'AGAIN', () => this.start()),
      ]);
      fitCard(card, this.k, w, 440, title);
      return [shade, card];
    });
  }

  update(_t: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 30);
    if (this.state === 'play') this.step(dt);
    this.paddle.setPosition(this.paddleX, PADDLE_Y + 22);
    const g = this.trailGfx.clear();
    for (const b of this.balls) {
      this.ballImgs.get(b.id)?.setPosition(b.x, b.y);
      const trail = this.trails.get(b.id)!;
      if (!b.stuck && this.state === 'play') trail.push({ x: b.x, y: b.y });
      if (trail.length > 8 || (trail.length && (b.stuck || this.state !== 'play'))) trail.shift();
      trail.forEach((p, i) => g.fillStyle(0xffffff, (i / trail.length) * 0.22).fillCircle(p.x, p.y, BALL_R * (0.4 + (0.5 * i) / trail.length)));
    }
  }
}
