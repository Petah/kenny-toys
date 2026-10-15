import * as Phaser from 'phaser';
import { FONT_BODY, FONT_HEADING } from '@shared/fonts';
import { preloadIcons } from '@shared/icons';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { fitCard, makeButton } from '@shared/ui';
import {
  BUBBLE_ORIGIN, BUBBLE_PX, ICONS_KEY, LOOKS, PLAIN_KEY, SFX, addArt, bubbleKey, preloadAssets, type Art, type Voice,
} from './assets';
import {
  BOMB_DROP, Board, COLS, DEAD_ROW, LAUNCH_Y, MAX_AIM, ROW_H, level, scoreFor, type Bubble, type Kind, type Level, type Shot,
} from './board';

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#1b2f57',
  align: 'center',
};

/** Shot speed, in bubbles per second. */
const SHOT_SPEED = 24;
/** Keyboard aiming, in radians per second (it speeds up the longer a key is held). */
const KEY_TURN = 1.1;
/** Milliseconds between each ring of a popping group. */
const POP_STEP = 55;
/** Gravity on dropped bubbles, in bubbles per second². */
const FALL_G = 34;
/** Wobble spring stiffness and damping. */
const SPRING = 320;
const DAMP = 13;
/** Where the next bubble waits, beside the launcher, and its size. */
const NEXT_X = COLS / 2 - 2.1;
const NEXT_SCALE = 0.72;
/** The line nothing may settle below: the bottom edge of the last safe row. */
const DEAD_Y = (DEAD_ROW - 1) * ROW_H + 1;

type State = 'title' | 'playing' | 'over';

interface Spr {
  img: Phaser.GameObjects.Image;
  /** Wobble offset and its velocity, in bubbles. */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  /** Grows in when a row arrives. */
  grow: number;
}

interface Faller {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  landed: boolean;
}

interface Flight {
  img: Phaser.GameObjects.Image;
  shot: Shot;
  bubble: Bubble;
  seg: number;
  along: number;
}

interface Drift {
  img: Phaser.GameObjects.Image;
  speed: number;
  sway: number;
}

export class PopScene extends Phaser.Scene {
  private state: State = 'title';
  private board = new Board();
  private sprites = new Map<number, Spr>();
  private fallers: Faller[] = [];
  private flight?: Flight;
  /** Rows slide down from here to 0 after a push, in bubbles. */
  private slide = 0;
  /** A shot is in flight or its pops are still playing out. */
  private busy = false;

  /** Bubble size and the field's top-left, in screen pixels. */
  private d = 60;
  private left = 0;
  private top = 0;

  private back!: Phaser.GameObjects.Graphics;
  private guide!: Phaser.GameObjects.Graphics;
  private front!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Image;
  private currentImg!: Phaser.GameObjects.Image;
  private nextImg!: Phaser.GameObjects.Image;
  private scoreText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private sparks = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private drifts: Drift[] = [];
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private overlayTimers: Phaser.Time.TimerEvent[] = [];
  private music?: Phaser.Sound.BaseSound;

  private aim = 0;
  private aiming = false;
  /** Whether to draw the guide: a mouse over the field, a finger down, or arrow keys in use. */
  private showGuide = false;
  private keys?: Record<'left' | 'right' | 'a' | 'd', Phaser.Input.Keyboard.Key>;
  private keyHeld = 0;

  private current: Kind = 0;
  private next: Kind = 1;
  private rules: Level = level(1);
  private levelNo = 1;
  private misses = 0;
  private score = 0;
  private best = 0;
  private shots = 0;
  private biggestDrop = 0;
  private danger = false;
  private canRestart = false;

  private art: Art;

  constructor(art: Art) {
    super('pop');
    this.art = art;
  }

  preload() {
    preloadAssets(this);
    preloadIcons(this);
  }

  create() {
    addArt(this, this.art);
    for (const [kind, look] of Object.entries(LOOKS)) {
      this.sparks.set(kind, this.add.particles(0, 0, PLAIN_KEY, {
        speed: { min: 120, max: 360 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.1, end: 0 },
        lifespan: { min: 250, max: 520 },
        gravityY: 600,
        tint: look.tint,
        emitting: false,
      }).setDepth(40));
    }
    for (let i = 0; i < 9; i++) {
      this.drifts.push({ img: this.add.image(0, 0, PLAIN_KEY).setAlpha(0.07).setDepth(0), speed: 0, sway: Math.random() * 10 });
    }
    this.back = this.add.graphics().setDepth(1);
    this.guide = this.add.graphics().setDepth(8);
    this.front = this.add.graphics().setDepth(30);
    this.ghost = this.add.image(0, 0, bubbleKey(0)).setOrigin(BUBBLE_ORIGIN.x, BUBBLE_ORIGIN.y).setAlpha(0.3).setDepth(9).setVisible(false);
    this.currentImg = this.add.image(0, 0, bubbleKey(0)).setOrigin(BUBBLE_ORIGIN.x, BUBBLE_ORIGIN.y).setDepth(31).setVisible(false);
    this.nextImg = this.add.image(0, 0, bubbleKey(0)).setOrigin(BUBBLE_ORIGIN.x, BUBBLE_ORIGIN.y).setDepth(31).setVisible(false);
    this.scoreText = this.add.text(0, 0, '0', { ...TEXT, fontSize: '38px', strokeThickness: 8 }).setOrigin(0.5, 0).setDepth(50);
    this.levelText = this.add.text(0, 0, '', { ...TEXT, fontSize: '18px', color: '#ffe066', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(50);

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('gameout', () => {
      if (!this.aiming) this.showGuide = false;
    });
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');
      this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', a: 'A', d: 'D' }) as PopScene['keys'];
      kb.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    }
    this.scale.on('resize', () => this.layout());

    this.best = load('emote-pop:best', 0);
    this.layout();
    this.resetDrifts();
    this.showTitle();
  }

  // ---- Layout ------------------------------------------------------------------------------

  /** UI scale: 1 at 1280×720, smaller on phones. */
  private get k() {
    return Math.min(this.scale.height / 720, this.scale.width / 480);
  }

  private layout() {
    const { width: w, height: h } = this.scale;
    const k = this.k;
    const hud = 96 * k;
    const below = 10 * k;
    const tall = LAUNCH_Y + 0.85;
    this.d = Math.floor(Math.min((w - 20) / COLS, (h - hud - below) / tall, 76));
    this.left = Math.round((w - this.d * COLS) / 2);
    this.top = Math.round(h - below - this.d * tall);

    this.drawBack();
    this.scoreText.setPosition(w / 2, this.top - 62 * k).setScale(k);
    this.levelText.setPosition(w / 2, this.top - 88 * k).setScale(k);
    if (this.state === 'playing') this.showLauncher();
    this.rebuildOverlay?.();
  }

  private sx(x: number) {
    return this.left + x * this.d;
  }

  private sy(y: number) {
    return this.top + y * this.d;
  }

  private get bubbleScale() {
    return this.d / BUBBLE_PX;
  }

  private drawBack() {
    const g = this.back.clear();
    const d = this.d;
    const x = this.left;
    const y = this.top;
    const w = COLS * d;
    const h = (LAUNCH_Y + 0.85) * d;
    const pad = 8;
    g.fillStyle(0x000000, 0.2).fillRoundedRect(x - pad, y - pad + 6, w + pad * 2, h + pad, 22);
    g.fillStyle(0x1b2f57, 0.9).fillRoundedRect(x - pad, y - pad, w + pad * 2, h + pad, 22);
    // A faint honeycomb of where bubbles can sit, so the rows read even when the wall is thin.
    g.fillStyle(0xffffff, 0.035);
    for (let row = 0; row < DEAD_ROW; row++) {
      const odd = this.board.rows[row]?.odd ?? row % 2 === 1;
      for (let col = 0; col < (odd ? COLS - 1 : COLS); col++) g.fillCircle(x + (col + 0.5 + (odd ? 0.5 : 0)) * d, y + (0.5 + row * ROW_H) * d, d * 0.42);
    }
    // The ceiling the wall hangs from.
    g.fillStyle(0x0f1d3a, 1).fillRoundedRect(x - pad, y - pad, w + pad * 2, pad + 3, { tl: 22, tr: 22, bl: 0, br: 0 });
  }

  /** The dead line, the launcher and the misses left, redrawn each frame (the line pulses in danger). */
  private drawFront() {
    const g = this.front.clear();
    if (this.state === 'title') return;
    const d = this.d;
    const lineY = this.sy(DEAD_Y);
    const pulse = this.danger ? 0.55 + 0.45 * Math.sin(this.time.now / 110) : 0.35;
    g.lineStyle(Math.max(2, d * 0.05), this.danger ? 0xff6b6b : 0xffffff, pulse);
    for (let x = this.sx(0.1); x < this.sx(COLS - 0.1); x += d * 0.32) g.lineBetween(x, lineY, Math.min(x + d * 0.16, this.sx(COLS - 0.1)), lineY);

    // A stubby pointer out of the launcher.
    const lx = this.sx(COLS / 2);
    const ly = this.sy(LAUNCH_Y);
    const dx = Math.sin(this.aim);
    const dy = -Math.cos(this.aim);
    if (this.state === 'playing') {
      const r0 = d * 0.62;
      const r1 = d * 1.05;
      g.lineStyle(d * 0.12, 0xffffff, 0.85).lineBetween(lx + dx * r0, ly + dy * r0, lx + dx * r1, ly + dy * r1);
      const tip = d * 1.28;
      const px = -dy;
      const py = dx;
      g.fillStyle(0xffffff, 0.85).fillTriangle(
        lx + dx * tip, ly + dy * tip,
        lx + dx * r1 + px * d * 0.17, ly + dy * r1 + py * d * 0.17,
        lx + dx * r1 - px * d * 0.17, ly + dy * r1 - py * d * 0.17,
      );
    }
    // The launcher's base.
    g.fillStyle(0x0f1d3a, 1).fillEllipse(lx, ly + d * 0.48, d * 1.5, d * 0.42);

    // Misses left before the wall comes down: dots to the right of the launcher.
    const n = this.rules.misses;
    const gap = d * 0.3;
    const mx = this.sx(COLS / 2 + 1.25);
    const my = ly + d * 0.25;
    for (let i = 0; i < n; i++) {
      const cx = mx + i * gap;
      const left = i < this.misses;
      const last = left && this.misses === 1;
      const r = d * 0.09 * (last ? 1 + 0.25 * Math.sin(this.time.now / 90) : 1);
      if (left) g.fillStyle(last ? 0xff6b6b : 0xffffff, 0.9).fillCircle(cx, my, r);
      else g.lineStyle(2, 0xffffff, 0.3).strokeCircle(cx, my, r);
    }
  }

  // ---- Game flow ---------------------------------------------------------------------------

  private startGame() {
    playSfx(this, SFX, 'click');
    this.setOverlay();
    this.state = 'playing';
    this.score = 0;
    this.shots = 0;
    this.biggestDrop = 0;
    this.levelNo = 1;
    this.canRestart = false;
    this.aim = 0;
    this.scoreText.setText('0').setVisible(true);
    this.startLevel();
    this.voice('go');
    this.time.delayedCall(400, () => this.banner('LEVEL 1', `miss ${this.rules.misses} times and the wall comes down`));
    this.music ??= this.sound.add('music', { loop: true, volume: 0.22 });
    if (!this.music.isPlaying) this.music.play();
  }

  private startLevel() {
    this.rules = level(this.levelNo);
    this.levelText.setText(`LEVEL ${this.levelNo}`).setVisible(true);
    this.misses = this.rules.misses;
    this.clearSprites();
    this.board.fill(this.rules.rows, this.rules.kinds, this.rules.stones);
    this.spawnAll(true);
    this.current = this.pickKind();
    this.next = this.pickKind();
    this.busy = false;
    this.danger = false;
    this.drawBack();
    this.showLauncher(true);
  }

  /** A kind still on the wall, so every shot has somewhere to go. */
  private pickKind(): Kind {
    const left = this.board.kindsLeft();
    if (!left.length) return Phaser.Math.Between(0, this.rules.kinds - 1);
    return left[Phaser.Math.Between(0, left.length - 1)];
  }

  private showLauncher(pop = false) {
    const show = this.state === 'playing';
    const s = this.bubbleScale;
    this.currentImg.setVisible(show).setTexture(bubbleKey(this.current)).setPosition(this.sx(COLS / 2), this.sy(LAUNCH_Y));
    this.nextImg.setVisible(show).setTexture(bubbleKey(this.next)).setPosition(this.sx(NEXT_X), this.sy(LAUNCH_Y + 0.15));
    if (pop) {
      this.tweens.add({ targets: this.currentImg, scale: { from: 0, to: s }, duration: 220, ease: 'Back.easeOut' });
      this.tweens.add({ targets: this.nextImg, scale: { from: 0, to: s * NEXT_SCALE }, duration: 220, delay: 80, ease: 'Back.easeOut' });
    } else {
      this.currentImg.setScale(s);
      this.nextImg.setScale(s * NEXT_SCALE);
    }
  }

  private swap() {
    if (this.state !== 'playing' || this.busy) return;
    [this.current, this.next] = [this.next, this.current];
    playSfx(this, SFX, 'swap', { volume: 0.4 });
    const s = this.bubbleScale;
    const a = { x: this.sx(COLS / 2), y: this.sy(LAUNCH_Y) };
    const b = { x: this.sx(NEXT_X), y: this.sy(LAUNCH_Y + 0.15) };
    this.currentImg.setTexture(bubbleKey(this.current)).setPosition(b.x, b.y).setScale(s * NEXT_SCALE);
    this.nextImg.setTexture(bubbleKey(this.next)).setPosition(a.x, a.y).setScale(s);
    this.tweens.add({ targets: this.currentImg, x: a.x, y: a.y, scale: s, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.nextImg, x: b.x, y: b.y, scale: s * NEXT_SCALE, duration: 160, ease: 'Back.easeOut' });
  }

  private fire() {
    if (this.state !== 'playing' || this.busy) return;
    this.busy = true;
    this.shots++;
    const shot = this.board.trace(this.aim);
    const bubble = this.board.make(this.current);
    const img = this.add.image(this.currentImg.x, this.currentImg.y, bubbleKey(this.current))
      .setOrigin(BUBBLE_ORIGIN.x, BUBBLE_ORIGIN.y).setScale(this.bubbleScale).setDepth(20);
    this.flight = { img, shot, bubble, seg: 0, along: 0 };
    playSfx(this, SFX, 'shoot', { volume: 0.35 });
    // The next bubble loads straight away, though it can't fire until this shot has played out.
    this.current = this.next;
    this.next = this.pickKind();
    this.showLauncher(true);
  }

  private fly(dt: number) {
    const f = this.flight;
    if (!f) return;
    let step = SHOT_SPEED * dt;
    const path = f.shot.path;
    while (step > 0 && f.seg < path.length - 1) {
      const a = path[f.seg];
      const b = path[f.seg + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (f.along + step < len) {
        f.along += step;
        step = 0;
      } else {
        step -= len - f.along;
        f.seg++;
        f.along = 0;
        if (f.seg < path.length - 1) playSfx(this, SFX, 'bounce', { volume: 0.3 });
      }
    }
    if (f.seg >= path.length - 1) {
      this.flight = undefined;
      this.land(f);
      return;
    }
    const a = path[f.seg];
    const b = path[f.seg + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = f.along / len;
    f.img.setPosition(this.sx(a.x + (b.x - a.x) * t), this.sy(a.y + (b.y - a.y) * t));
  }

  private land(f: Flight) {
    const { cell } = f.shot;
    const at = this.board.pos(cell);
    const result = this.board.place(cell, f.bubble);
    // The shot becomes a wall bubble where it stuck, with a little squash.
    f.img.setDepth(this.depthFor(cell.row));
    const spr = this.addSprite(f.bubble, f.img);
    this.tweens.add({ targets: spr, grow: { from: 1.15, to: 1 }, duration: 220, ease: 'Back.easeOut' });
    this.knock(at.x, at.y, f.bubble.kind === 'bomb' ? 9 : 4);
    playSfx(this, SFX, 'stick', { volume: 0.45 });

    const popped = result.popped.length;
    const dropped = result.dropped.length;
    if (f.bubble.kind === 'bomb') this.boom(at.x, at.y);
    let wait = 0;
    for (const p of result.popped) {
      const s = this.sprites.get(p.bubble.id);
      this.sprites.delete(p.bubble.id);
      if (!s) continue;
      const delay = (f.bubble.kind === 'bomb' ? 0 : 60) + p.step * POP_STEP;
      wait = Math.max(wait, delay);
      this.time.delayedCall(delay, () => this.pop(s, p.bubble.kind, p.step));
    }
    if (dropped) {
      this.time.delayedCall(wait + 90, () => {
        for (const dr of result.dropped) {
          const s = this.sprites.get(dr.bubble.id);
          this.sprites.delete(dr.bubble.id);
          if (s) this.drop(s, this.board.pos(dr.cell));
        }
      });
    }

    const points = scoreFor(popped, dropped);
    if (points) {
      this.addScore(points);
      const all = [...result.popped.map((p) => p.cell), ...result.dropped.map((p) => p.cell)].map((c) => this.board.pos(c));
      const cx = all.reduce((s, p) => s + p.x, 0) / all.length;
      const cy = all.reduce((s, p) => s + p.y, 0) / all.length;
      this.time.delayedCall(wait * 0.5, () => this.popup(this.sx(cx), this.sy(cy), `+${group(points)}`, dropped >= 3 ? `${dropped} DROPPED!` : undefined));
    }
    this.biggestDrop = Math.max(this.biggestDrop, dropped);
    const earned = dropped >= BOMB_DROP && f.bubble.kind !== 'bomb';

    // Once the pops have played out: the wall may come down a row, the level may be clear, or it's over.
    this.time.delayedCall(wait + (dropped ? 200 : 60), () => {
      if (this.state !== 'playing') return;
      if (this.board.lowest() >= DEAD_ROW) return this.gameOver();
      if (this.board.count === 0) return this.levelClear();
      if (!popped) {
        this.misses--;
        if (this.misses <= 0) {
          this.misses = this.rules.misses;
          this.pushRow();
          if (this.board.lowest() >= DEAD_ROW) {
            this.time.delayedCall(300, () => this.gameOver());
            return;
          }
        }
      }
      this.turnDone(earned);
    });
  }

  /** Readies the next shot: kinds that have gone from the wall are swapped for ones still on it. */
  private turnDone(bomb: boolean) {
    const was = [this.current, this.next];
    const left = this.board.kindsLeft();
    if (typeof this.current === 'number' && !left.includes(this.current)) this.current = this.pickKind();
    if (typeof this.next === 'number' && !left.includes(this.next)) this.next = this.pickKind();
    if (bomb) {
      this.next = this.current;
      this.current = 'bomb';
      playSfx(this, SFX, 'earn', { volume: 0.5, detune: 0 });
      this.voice('power_up');
      this.banner('BOMB!', 'it blows a hole wherever it lands');
    }
    const danger = this.board.lowest() >= DEAD_ROW - 2;
    if (danger && !this.danger) playSfx(this, SFX, 'warn', { volume: 0.45 });
    this.danger = danger;
    this.busy = false;
    if (was[0] !== this.current || was[1] !== this.next) this.showLauncher(true);
  }

  private pushRow() {
    this.board.push(this.rules.kinds, this.rules.stones);
    playSfx(this, SFX, 'push', { volume: 0.6 });
    this.cameras.main.shake(160, 0.006);
    for (const b of this.board.rows[0].cells) if (b) this.addSprite(b).grow = 0;
    for (const b of this.board.rows[0].cells) {
      const s = b && this.sprites.get(b.id);
      if (s) this.tweens.add({ targets: s, grow: 1, duration: 260, delay: Phaser.Math.Between(0, 120), ease: 'Back.easeOut' });
    }
    this.slide = -ROW_H;
    this.tweens.add({ targets: this, slide: 0, duration: 260, ease: 'Bounce.easeOut' });
    this.drawBack();
  }

  private levelClear() {
    this.busy = true;
    const bonus = 1000 * this.levelNo;
    this.addScore(bonus);
    playSfx(this, SFX, 'clear', { volume: 0.6, detune: 0 });
    this.voice('level_up');
    this.banner('CLEAR!', `+${group(bonus)} bonus`);
    this.currentImg.setVisible(false);
    this.nextImg.setVisible(false);
    this.time.delayedCall(1600, () => {
      if (this.state !== 'playing') return;
      this.levelNo++;
      this.startLevel();
      this.banner(`LEVEL ${this.levelNo}`, this.levelNo === 4 ? 'clouds never pop: cut them loose' : this.rules.kinds > level(this.levelNo - 1).kinds ? 'a new emote joins in' : 'the wall comes down sooner');
    });
  }

  private gameOver() {
    this.state = 'over';
    this.busy = true;
    this.showGuide = false;
    this.currentImg.setVisible(false);
    this.nextImg.setVisible(false);
    this.music?.stop();
    playSfx(this, SFX, 'over', { volume: 0.6, detune: 0 });
    this.voice('game_over');
    this.cameras.main.shake(300, 0.01);
    // The wall goes grey from the bottom up.
    const rows = [...this.board.cells()].sort((a, b) => b[0].row - a[0].row);
    rows.forEach(([cell, b], i) => this.time.delayedCall(i * 12 + (DEAD_ROW - cell.row) * 30, () => this.sprites.get(b.id)?.img.setTint(0x7d8794)));
    const previous = this.best;
    const { best, isNew } = submitHighScore('emote-pop', this.score);
    this.best = best;
    this.time.delayedCall(1300, () => this.showGameOver(isNew && previous > 0, true));
  }

  private addScore(n: number) {
    this.score += n;
    this.scoreText.setText(group(this.score));
    this.tweens.add({ targets: this.scoreText, scale: { from: 1.25 * this.k, to: this.k }, duration: 250, ease: 'Back.easeOut' });
  }

  // ---- Sprites -----------------------------------------------------------------------------

  private depthFor(row: number) {
    // Lower rows draw over higher ones, so each balloon's tail tucks in behind the row below.
    return 10 + row * 0.01;
  }

  private addSprite(b: Bubble, img?: Phaser.GameObjects.Image) {
    img ??= this.add.image(0, 0, bubbleKey(b.kind)).setOrigin(BUBBLE_ORIGIN.x, BUBBLE_ORIGIN.y);
    const s: Spr = { img, ox: 0, oy: 0, vx: 0, vy: 0, grow: 1 };
    this.sprites.set(b.id, s);
    return s;
  }

  /** Sprites for the whole wall; entering ones grow in row by row from the top. */
  private spawnAll(enter: boolean) {
    for (const [cell, b] of this.board.cells()) {
      const s = this.addSprite(b);
      if (!enter) continue;
      s.grow = 0;
      this.tweens.add({ targets: s, grow: 1, duration: 280, delay: cell.row * 70 + cell.col * 18, ease: 'Back.easeOut' });
    }
    if (enter) this.time.delayedCall(80, () => playSfx(this, SFX, 'push', { volume: 0.4 }));
  }

  private clearSprites() {
    for (const s of this.sprites.values()) s.img.destroy();
    this.sprites.clear();
    for (const f of this.fallers) f.img.destroy();
    this.fallers = [];
    this.flight?.img.destroy();
    this.flight = undefined;
  }

  /** Bubbles near a hit get shoved away from it and spring back. */
  private knock(x: number, y: number, strength: number) {
    for (const [cell, b] of this.board.cells()) {
      const s = this.sprites.get(b.id);
      if (!s) continue;
      const p = this.board.pos(cell);
      const dx = p.x - x;
      const dy = p.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.01 || dist > 2.6) continue;
      const push = strength / (dist * dist + 0.6);
      s.vx += (dx / dist) * push;
      s.vy += (dy / dist) * push;
    }
  }

  /** A popped bubble swells and vanishes, and its emote floats up out of it as if said aloud. */
  private pop(s: Spr, kind: Kind, step: number) {
    const look = LOOKS[String(kind)];
    const { x, y } = s.img;
    const scale = s.img.scale;
    if (kind === 'stone') playSfx(this, SFX, 'stone', { volume: 0.4 });
    else playSfx(this, SFX, 'pop', { volume: 0.5, detune: Math.min(step, 8) * 110 - 200 });
    this.sparks.get(String(kind))?.setParticleScale(this.d / 400, 0).explode(7, x, y);
    s.img.setDepth(35);
    this.tweens.add({
      targets: s.img, scale: scale * 1.35, alpha: 0, duration: 170, ease: 'Cubic.easeOut',
      onComplete: () => s.img.destroy(),
    });
    const icon = this.add.image(x, y, ICONS_KEY, look.icon).setScale(scale).setDepth(36);
    this.tweens.add({
      targets: icon, y: y - this.d * 0.9, scale: scale * 1.15, angle: Phaser.Math.Between(-15, 15), duration: 520, ease: 'Cubic.easeOut',
    });
    this.tweens.add({ targets: icon, alpha: 0, duration: 260, delay: 300, onComplete: () => icon.destroy() });
  }

  /** A cut-loose bubble hops and falls, bouncing once off the launcher shelf before it fades. */
  private drop(s: Spr, at: { x: number; y: number }) {
    s.img.setDepth(25);
    this.fallers.push({
      img: s.img, x: at.x + s.ox, y: at.y + s.oy + this.slide,
      vx: Phaser.Math.FloatBetween(-1.6, 1.6), vy: Phaser.Math.FloatBetween(-4, -1.5), spin: Phaser.Math.FloatBetween(-4, 4), landed: false,
    });
  }

  private boom(x: number, y: number) {
    playSfx(this, SFX, 'bomb', { volume: 0.7 });
    this.cameras.main.shake(260, 0.012);
    const ring = this.add.graphics().setDepth(38);
    const sx = this.sx(x);
    const sy = this.sy(y);
    const r = { t: 0 };
    this.tweens.add({
      targets: r, t: 1, duration: 360, ease: 'Cubic.easeOut',
      onUpdate: () => {
        ring.clear().fillStyle(0xfff3bf, 0.6 * (1 - r.t)).fillCircle(sx, sy, this.d * 2 * r.t);
        ring.lineStyle(this.d * 0.12 * (1 - r.t) + 1, 0xffffff, 1 - r.t).strokeCircle(sx, sy, this.d * 2.2 * r.t);
      },
      onComplete: () => ring.destroy(),
    });
  }

  // ---- Input -------------------------------------------------------------------------------

  private aimAt(px: number, py: number) {
    const lx = this.sx(COLS / 2);
    const ly = this.sy(LAUNCH_Y);
    // Points below the launcher still aim, mirrored up, so dragging low doesn't flip the arrow.
    const a = Math.atan2(px - lx, Math.max(ly - py, this.d * 0.2));
    this.aim = Phaser.Math.Clamp(a, -MAX_AIM, MAX_AIM);
  }

  private nearNext(x: number, y: number) {
    return Math.hypot(x - this.sx(NEXT_X), y - this.sy(LAUNCH_Y + 0.15)) < this.d * 0.6;
  }

  private nearLauncher(x: number, y: number) {
    return Math.hypot(x - this.sx(COLS / 2), y - this.sy(LAUNCH_Y)) < this.d * 0.6;
  }

  /** Below the top of the launcher a release doesn't fire, so a drag can be called off. */
  private inCancelZone(y: number) {
    return y > this.sy(LAUNCH_Y - 0.6);
  }

  private onDown(p: Phaser.Input.Pointer) {
    if (this.state !== 'playing') return;
    if (this.nearNext(p.x, p.y) || this.nearLauncher(p.x, p.y)) {
      this.swap();
      return;
    }
    this.aiming = true;
    this.showGuide = true;
    this.aimAt(p.x, p.y);
  }

  private onMove(p: Phaser.Input.Pointer) {
    if (this.state !== 'playing') return;
    const touch = p.wasTouch;
    if (touch && !this.aiming) return;
    this.showGuide = touch ? !this.inCancelZone(p.y) : true;
    this.aimAt(p.x, p.y);
  }

  private onUp(p: Phaser.Input.Pointer) {
    if (!this.aiming) return;
    this.aiming = false;
    if (p.wasTouch) this.showGuide = false;
    if (this.state !== 'playing' || this.inCancelZone(p.y)) return;
    this.aimAt(p.x, p.y);
    this.fire();
  }

  private onKey(e: KeyboardEvent) {
    if (this.state !== 'playing') {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && (this.state === 'title' || this.canRestart)) this.startGame();
      return;
    }
    if (e.repeat) return;
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'w' || e.key === 'W') {
      this.showGuide = true;
      this.fire();
    } else if (e.key === 'ArrowDown' || e.key === 'x' || e.key === 'X' || e.key === 'Shift' || e.key === 's' || e.key === 'S') {
      this.swap();
    }
  }

  // ---- Frame loop --------------------------------------------------------------------------

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 20);
    this.steer(dt);
    this.fly(dt);
    this.wobble(dt);
    this.fall(dt);
    this.drawWall();
    this.drawGuide();
    this.drawFront();
    this.drawDrifts(dt);
  }

  private steer(dt: number) {
    const k = this.keys;
    if (!k || this.state !== 'playing') return;
    const dir = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    if (!dir) {
      this.keyHeld = 0;
      return;
    }
    // Starts fine for small corrections, then speeds up to sweep across.
    this.keyHeld += dt;
    this.showGuide = true;
    this.aim = Phaser.Math.Clamp(this.aim + dir * KEY_TURN * Math.min(2.2, 0.35 + this.keyHeld * 2) * dt, -MAX_AIM, MAX_AIM);
  }

  private wobble(dt: number) {
    for (const s of this.sprites.values()) {
      if (!s.vx && !s.vy && !s.ox && !s.oy) continue;
      s.vx += (-SPRING * s.ox - DAMP * s.vx) * dt;
      s.vy += (-SPRING * s.oy - DAMP * s.vy) * dt;
      s.ox += s.vx * dt;
      s.oy += s.vy * dt;
      if (Math.abs(s.ox) + Math.abs(s.oy) + Math.abs(s.vx) + Math.abs(s.vy) < 0.002) s.ox = s.oy = s.vx = s.vy = 0;
    }
  }

  private fall(dt: number) {
    const floor = LAUNCH_Y + 0.35;
    this.fallers = this.fallers.filter((f) => {
      f.vy += FALL_G * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < 0.5 || f.x > COLS - 0.5) {
        f.x = Phaser.Math.Clamp(f.x, 0.5, COLS - 0.5);
        f.vx = -f.vx * 0.6;
      }
      // Each bubble bounces once off the floor with a knock, then drops out of the field and fades.
      if (!f.landed && f.y > floor) {
        f.landed = true;
        f.y = floor;
        f.vy = -f.vy * 0.35;
        f.vx *= 0.7;
        playSfx(this, SFX, 'fall', { volume: 0.25 });
        this.sparks.get(String(this.kindOf(f.img)))?.setParticleScale(this.d / 600, 0).explode(3, this.sx(f.x), this.sy(f.y + 0.4));
      }
      f.img.angle += f.spin * dt * 60;
      f.img.setPosition(this.sx(f.x), this.sy(f.y));
      if (f.landed) f.img.setAlpha(Math.max(0, f.img.alpha - dt * 2.2));
      if (f.img.alpha <= 0 || f.y > LAUNCH_Y + 3) {
        f.img.destroy();
        return false;
      }
      return true;
    });
  }

  private kindOf(img: Phaser.GameObjects.Image) {
    return img.texture.key.slice('bubble:'.length);
  }

  /** Places every wall sprite at its cell, plus any slide from a push and its wobble, breathing gently. */
  private drawWall() {
    const s = this.bubbleScale;
    const now = this.time.now;
    for (const [cell, b] of this.board.cells()) {
      const spr = this.sprites.get(b.id);
      if (!spr) continue;
      const p = this.board.pos(cell);
      const breathe = 1 + 0.018 * Math.sin(now / 420 + b.id * 1.7);
      spr.img.setPosition(this.sx(p.x + spr.ox), this.sy(p.y + spr.oy + this.slide)).setScale(s * spr.grow * breathe).setDepth(this.depthFor(cell.row));
    }
    if (this.flight) this.flight.img.setScale(s);
  }

  private drawGuide() {
    const g = this.guide.clear();
    const show = this.state === 'playing' && !this.busy && this.showGuide;
    this.ghost.setVisible(show);
    if (!show) return;
    const shot = this.board.trace(this.aim);
    const look = LOOKS[String(this.current)];
    // Dots along the path, marching outward, fading with distance. `next` is how far along the
    // whole path the next dot goes, so spacing stays even round the bounces.
    const spacing = 0.42;
    let next = spacing - (((this.time.now / 1000) * 1.4) % spacing);
    let travelled = 0;
    const path = shot.path;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // Stop short of the landing cell so the dots end at the ghost's edge.
      const usable = i === path.length - 2 ? len - 0.5 : len;
      for (; next - travelled <= usable; next += spacing) {
        const t = (next - travelled) / len;
        if (next < 0.75) continue;
        const fade = Math.max(0.25, 1 - next / 16);
        g.fillStyle(look.tint, 0.9 * fade).fillCircle(this.sx(a.x + (b.x - a.x) * t), this.sy(a.y + (b.y - a.y) * t), this.d * 0.075);
      }
      travelled += len;
    }
    const end = this.board.pos(shot.cell);
    this.ghost.setTexture(bubbleKey(this.current)).setPosition(this.sx(end.x), this.sy(end.y)).setScale(this.bubbleScale).setAlpha(0.32 + 0.08 * Math.sin(this.time.now / 140));
  }

  // ---- Backdrop ----------------------------------------------------------------------------

  /** Big faint balloons drifting up behind everything. */
  private resetDrifts() {
    const { width: w, height: h } = this.scale;
    for (const dr of this.drifts) this.placeDrift(dr, Math.random() * w, Math.random() * h);
  }

  private placeDrift(dr: Drift, x: number, y: number) {
    const size = Phaser.Math.FloatBetween(1.2, 3.2) * 70 * Math.max(0.6, this.k);
    dr.img.setScale(size / BUBBLE_PX).setPosition(x, y).setFlipX(Math.random() < 0.5);
    dr.speed = Phaser.Math.FloatBetween(10, 26);
  }

  private drawDrifts(dt: number) {
    const { width: w, height: h } = this.scale;
    for (const dr of this.drifts) {
      dr.sway += dt;
      dr.img.y -= dr.speed * dt;
      dr.img.x += Math.sin(dr.sway * 0.6) * 6 * dt;
      if (dr.img.y < -dr.img.displayHeight) this.placeDrift(dr, Math.random() * w, h + dr.img.displayHeight * 0.6);
    }
  }

  // ---- Effects -----------------------------------------------------------------------------

  private popup(x: number, y: number, text: string, sub?: string) {
    const k = this.k;
    const parts = [this.add.text(0, 0, text, { ...TEXT, fontSize: '32px', color: '#ffe066', strokeThickness: 8 }).setOrigin(0.5)];
    if (sub) parts.push(this.add.text(0, 32, sub, { ...TEXT, fontSize: '20px', strokeThickness: 6 }).setOrigin(0.5));
    const c = this.add.container(x, y, parts).setDepth(45);
    this.tweens.add({ targets: c, scale: { from: 0.3 * k, to: k }, duration: 240, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, y: y - 50 * k, alpha: 0, duration: 600, delay: 700, ease: 'Cubic.easeIn', onComplete: () => c.destroy() });
  }

  private banner(title: string, sub?: string) {
    const { width: w } = this.scale;
    const k = this.k;
    const parts: Phaser.GameObjects.Text[] = [this.add.text(0, 0, title, { ...TEXT, fontSize: '58px', strokeThickness: 12 }).setOrigin(0.5)];
    if (sub) parts.push(this.add.text(0, 50, sub, { ...TEXT, fontFamily: FONT_BODY, fontSize: '22px', color: '#ffe066', strokeThickness: 7 }).setOrigin(0.5));
    const c = this.add.container(w / 2, this.sy(DEAD_Y * 0.55), parts).setScale(0).setDepth(55);
    const fit = Math.min(k, (w - 32) / (Math.max(...parts.map((p) => p.width)) + 20));
    this.tweens.add({ targets: c, scale: fit, duration: 380, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, alpha: 0, y: c.y - 30 * k, duration: 400, delay: 1300, onComplete: () => c.destroy() });
  }

  private voice(name: Voice) {
    this.sound.play(`voice:${name}`, { volume: 0.8 });
  }

  // ---- Overlays ----------------------------------------------------------------------------

  private setOverlay(build?: () => Phaser.GameObjects.GameObject[]) {
    this.rebuildOverlay = build && (() => this.setOverlay(build));
    this.overlayTimers.forEach((t) => t.remove());
    this.overlayTimers = [];
    this.overlay?.destroy();
    this.overlay = undefined;
    if (!build) return;
    this.overlay = this.add.container(0, 0, build()).setDepth(60);
  }

  private later(ms: number, fn: () => void) {
    this.overlayTimers.push(this.time.delayedCall(ms, fn));
  }

  private button(x: number, y: number, label: string, onClick: () => void) {
    return makeButton(this, x, y, label, onClick, { textStyle: TEXT, color: 0x3aa55c, onPress: () => playSfx(this, SFX, 'click') }).parts;
  }

  private panel(w: number, h: number, y: number) {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.3).fillRoundedRect(-w / 2, y + 8, w, h, 26);
    g.fillStyle(0x1b2f57, 0.96).fillRoundedRect(-w / 2, y, w, h, 26);
    g.lineStyle(4, 0xa5d8ff, 1).strokeRoundedRect(-w / 2, y, w, h, 26);
    return g;
  }

  /** The title hangs a full wall of every emote behind the card. */
  private showTitle() {
    this.state = 'title';
    this.scoreText.setVisible(false);
    this.levelText.setVisible(false);
    this.currentImg.setVisible(false);
    this.nextImg.setVisible(false);
    this.clearSprites();
    this.rules = level(4);
    this.board.fill(7, 6);
    this.spawnAll(true);
    this.drawBack();
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.5);
      const shade = this.panel(600, this.best ? 320 : 280, -150);
      const title = this.add.text(0, -94, 'EMOTE POP', { ...TEXT, fontSize: '64px', strokeThickness: 12 }).setOrigin(0.5);
      const body = { ...TEXT, fontFamily: FONT_BODY, fontSize: '20px', strokeThickness: 6 };
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const how = touch ? 'Drag to aim, let go to shoot.' : 'Aim with the mouse, click to shoot.';
      const tag = this.add.text(0, -22, `${how}\nMatch 3 emotes to pop them!`, { ...body, lineSpacing: 6 }).setOrigin(0.5);
      const play = this.button(0, 70, 'PLAY', () => this.startGame());
      const parts: Phaser.GameObjects.GameObject[] = [shade, title, tag, ...play];
      if (this.best) parts.push(this.add.text(0, 140, `best ${group(this.best)}`, { ...TEXT, fontSize: '24px', color: '#ffe066', strokeThickness: 7 }).setOrigin(0.5));
      card.add(parts);
      fitCard(card, this.k, w, 640, title);
      return [card];
    });
  }

  private showGameOver(record: boolean, animate: boolean) {
    this.scoreText.setVisible(false);
    this.levelText.setVisible(false);
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.46);
      const title = this.add.text(0, -190, 'GAME OVER', { ...TEXT, fontSize: '60px', strokeThickness: 12 }).setOrigin(0.5);
      const panel = this.panel(420, 300, -130);
      const label = { ...TEXT, fontSize: '20px', color: '#a5d8ff', strokeThickness: 0 };
      const big = { ...TEXT, fontSize: '52px', color: '#ffe066', strokeThickness: 8 };
      const small = { ...big, fontSize: '30px', color: '#ffffff' };
      const scoreLabel = this.add.text(0, -108, 'SCORE', label).setOrigin(0.5);
      const scoreNum = this.add.text(0, -62, animate ? '0' : group(this.score), big).setOrigin(0.5);
      const bestLabel = this.add.text(-100, -4, 'BEST', label).setOrigin(0.5);
      const bestNum = this.add.text(-100, 32, group(this.best), small).setOrigin(0.5);
      const levelLabel = this.add.text(100, -4, 'LEVEL', label).setOrigin(0.5);
      const levelNum = this.add.text(100, 32, `${this.levelNo}`, small).setOrigin(0.5);
      const dropLabel = this.add.text(0, 80, 'BIGGEST DROP', label).setOrigin(0.5);
      const dropNum = this.add.text(0, 114, `${this.biggestDrop}`, { ...small, fontSize: '26px' }).setOrigin(0.5);
      const newTag = record ? this.add.text(160, -84, 'NEW!', { ...TEXT, fontSize: '26px', color: '#ff6b6b', stroke: '#ffffff', strokeThickness: 6 }).setOrigin(0.5).setAngle(14) : undefined;
      const again = this.button(0, 230, 'AGAIN', () => this.startGame());
      const parts = [title, panel, scoreLabel, scoreNum, bestLabel, bestNum, levelLabel, levelNum, dropLabel, dropNum, newTag, ...again];
      card.add(parts.filter((p): p is NonNullable<typeof p> => !!p));
      fitCard(card, this.k, w, 460, title);
      if (!animate) {
        this.canRestart = true;
        return [card];
      }
      again.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
      newTag?.setVisible(false);
      this.tweens.add({ targets: title, y: { from: -360, to: -190 }, duration: 450, ease: 'Back.easeOut' });
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        this.later(400 + i * 40, () => {
          scoreNum.setText(group(Math.round((this.score * i) / steps)));
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
      return [card];
    });
  }
}

/** 12345 → "12,345". */
function group(n: number) {
  return n.toLocaleString('en-US');
}

