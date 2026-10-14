import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { SFX, type Voice } from './assets';
import { gyro } from './gyro';
import { LEVELS, type Level } from './levels';
import { CELL, parseMaze, transpose, type Corner, type Maze, type Point } from './maze';
import { loadProgress, recordClear } from './progress';
import { FOOT_H, PAD, TEXT, button, formatTime, hudHeight, starRow } from './ui';

type MatterImage = Phaser.Physics.Matter.Image;
type State = 'play' | 'lost' | 'won';

/** Gravity at full tilt. The ball crosses the board in about a second and a half. */
const GRAVITY = 0.9;
const MAX_SPEED = 13;
const BALL_SCALE = 0.56;
const BALL_RADIUS = 32 * BALL_SCALE;
/** How far a joystick drag goes before it counts as full tilt. */
const JOY_RANGE = 90;
const SPIN_SPEED = 1.5;
const SPINNER_SCALE = 0.75;
/** Lasers repeat every LASER_CYCLE ms and are on for the first LASER_ON of it. */
const LASER_CYCLE = 3000;
const LASER_ON = 1700;

/**
 * Walls are frictionless. The ball would really roll along a wall rather than rub on it, and
 * Matter takes the larger static friction of a pair, so its default 0.5 made the ball stick
 * whenever it was pressed into a wall.
 */
const WALL: Phaser.Types.Physics.Matter.MatterBodyConfig = { isStatic: true, restitution: 0.3, friction: 0, frictionStatic: 0, label: 'wall' };

/** block_corner.png has its right angle at the bottom left; the other corners are that turned clockwise. */
const CORNER_ANGLE: Record<Corner, number> = { 1: 0, 4: 90, 3: 180, 2: 270 };
const CORNER_VERTS: Record<Corner, number[]> = {
  1: [0, 0, CELL, CELL, 0, CELL],
  2: [CELL, 0, CELL, CELL, 0, CELL],
  3: [0, 0, CELL, 0, CELL, CELL],
  4: [0, 0, CELL, 0, 0, CELL],
};

const TIPS: Record<number, [string, string]> = {
  // [desktop, touch]
  0: ['Arrow keys, WASD or drag to tilt', 'Tilt your phone, or drag a finger'],
  1: ['Holes send you back to the start', 'Holes send you back to the start'],
  3: ['Grab the key to open the yellow blocks', 'Grab the key to open the yellow blocks'],
  5: ['Time your run past the spinners', 'Time your run past the spinners'],
  6: ['Lasers blink on and off', 'Lasers blink on and off'],
};

interface Laser {
  from: Point;
  to: Point;
  beam: Phaser.GameObjects.Image;
  offset: number;
  on: boolean;
}

export class LevelScene extends Phaser.Scene {
  private levelIndex = 0;
  private level!: Level;
  private maze!: Maze;
  private origin = { x: 0, y: 0 };
  private hudH = 0;
  private state: State = 'play';
  private ball!: MatterImage;
  private shadow!: Phaser.GameObjects.Image;
  private frameShadow!: Phaser.GameObjects.Graphics;
  private tilt = new Phaser.Math.Vector2();
  private joy?: { x: number; y: number; vec: Phaser.Math.Vector2 };
  private joyGfx!: Phaser.GameObjects.Graphics;
  private keys: Phaser.Input.Keyboard.Key[][] = [];
  private stars: { at: Point; img: Phaser.GameObjects.Image; taken: boolean }[] = [];
  private starIcons: Phaser.GameObjects.Image[] = [];
  private collected = 0;
  private key?: { at: Point; img: Phaser.GameObjects.Image };
  private hasKey = false;
  private lockedParts: Phaser.GameObjects.GameObject[] = [];
  private lockedBodies: MatterJS.BodyType[] = [];
  private goalImg!: Phaser.GameObjects.Image;
  private spinners: MatterImage[] = [];
  private lasers: Laser[] = [];
  private elapsed = 0;
  private timeText!: Phaser.GameObjects.Text;
  private tip?: Phaser.GameObjects.Text;
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private lastKnock = 0;

  constructor() {
    super('level');
  }

  init(data: { level?: number }) {
    this.levelIndex = Phaser.Math.Clamp(data.level ?? 0, 0, LEVELS.length - 1);
    this.level = LEVELS[this.levelIndex];
    const portrait = this.scale.height > this.scale.width;
    this.maze = parseMaze(portrait ? transpose(this.level.rows) : this.level.rows);
    this.hudH = hudHeight(portrait);
    this.origin = { x: PAD, y: this.hudH + PAD };
    this.state = 'play';
    this.tilt.set(0, 0);
    this.joy = undefined;
    this.stars = [];
    this.starIcons = [];
    this.collected = 0;
    this.key = undefined;
    this.hasKey = false;
    this.lockedParts = [];
    this.lockedBodies = [];
    this.spinners = [];
    this.lasers = [];
    this.elapsed = 0;
    this.tip = undefined;
  }

  create() {
    this.cameras.main.setBackgroundColor(0x3498db).fadeIn(180, 52, 152, 219);
    this.matter.world.setGravity(0, 0);
    this.buildBoard();
    this.buildPieces();
    this.buildBall();
    this.buildHud();

    const kb = this.input.keyboard!;
    const k = (...names: string[]) => names.map((n) => kb.addKey(n));
    this.keys = [k('LEFT', 'A'), k('RIGHT', 'D'), k('UP', 'W'), k('DOWN', 'S')];
    kb.on('keydown-R', () => this.restart());
    kb.on('keydown-ESC', () => this.toMenu());
    kb.on('keydown-ENTER', () => this.state === 'won' && this.next());

    this.joyGfx = this.add.graphics().setDepth(60);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.state === 'play') this.joy = { x: p.x, y: p.y, vec: new Phaser.Math.Vector2() };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.joy) return;
      this.joy.vec.set(p.x - this.joy.x, p.y - this.joy.y).scale(1 / JOY_RANGE).limit(1);
    });
    const release = () => {
      this.joy = undefined;
      this.joyGfx.clear();
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);

    this.matter.world.on('collisionstart', this.onCollisions, this);
    // Whatever angle the phone is held at when a level starts counts as level.
    gyro.calibrate();

    const music = this.sound.get('music') ?? this.sound.add('music', { loop: true, volume: 0.2 });
    if (!music.isPlaying) music.play();
    this.intro();
  }

  // ---- Board -------------------------------------------------------------------------------------

  private at(p: Point) {
    return { x: this.origin.x + p.x, y: this.origin.y + p.y };
  }

  private buildBoard() {
    const { x, y } = this.origin;
    const w = this.maze.cols * CELL;
    const h = this.maze.rows * CELL;
    this.frameShadow = this.add.graphics().fillStyle(0x000000, 0.2).fillRoundedRect(x - 12, y - 12, w + 24, h + 24, 16);
    this.add.graphics().fillStyle(0xffffff).fillRoundedRect(x - 10, y - 10, w + 20, h + 20, 14);
    this.add.tileSprite(x, y, w, h, 'rb', `background_${this.level.board}.png`).setOrigin(0);

    // The frame's walls, just outside the board.
    const t = 100;
    this.matter.add.rectangle(x + w / 2, y - t / 2, w + t * 2, t, WALL);
    this.matter.add.rectangle(x + w / 2, y + h + t / 2, w + t * 2, t, WALL);
    this.matter.add.rectangle(x - t / 2, y + h / 2, t, h, WALL);
    this.matter.add.rectangle(x + w + t / 2, y + h / 2, t, h, WALL);
  }

  private buildPieces() {
    const { maze } = this;

    const start = this.at(maze.start);
    this.add.image(start.x, start.y, 'rb', 'hole_start.png');
    for (const hole of maze.holes) {
      const p = this.at(hole);
      this.add.image(p.x, p.y, 'rb', 'hole.png');
    }
    const goal = this.at(maze.goal);
    this.goalImg = this.add.image(goal.x, goal.y, 'rb', maze.goal.locked ? 'hole_large_end_locked.png' : 'hole_large_end.png');

    for (const r of maze.walls) {
      const p = this.at(r);
      this.add.nineslice(p.x + r.w / 2, p.y + r.h / 2, 'rb', 'block_square.png', r.w, r.h, 14, 14, 14, 14);
      this.matter.add.rectangle(p.x + r.w / 2, p.y + r.h / 2, r.w, r.h, WALL);
    }
    for (const r of maze.locked) {
      const p = this.at(r);
      for (let cy = 0; cy < r.h; cy += CELL) {
        for (let cx = 0; cx < r.w; cx += CELL) {
          this.lockedParts.push(this.add.image(p.x + cx + CELL / 2, p.y + cy + CELL / 2, 'rb', 'block_locked_square.png'));
        }
      }
      this.lockedBodies.push(this.matter.add.rectangle(p.x + r.w / 2, p.y + r.h / 2, r.w, r.h, WALL));
    }
    for (const tri of maze.triangles) {
      const p = this.at(tri);
      this.add.image(p.x, p.y, 'rb', 'block_corner.png').setAngle(CORNER_ANGLE[tri.corner]);
      // Matter centres a vertex body on its centroid, so place it there.
      const v = CORNER_VERTS[tri.corner];
      const cx = (v[0] + v[2] + v[4]) / 3;
      const cy = (v[1] + v[3] + v[5]) / 3;
      this.matter.add.fromVertices(p.x - CELL / 2 + cx, p.y - CELL / 2 + cy, v.join(' '), WALL);
    }

    this.maze.lasers.forEach((laser, i) => {
      const from = this.at(laser.from);
      const to = this.at(laser.to);
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      const beam = this.add
        .image((from.x + to.x) / 2, (from.y + to.y) / 2, 'rb', 'laser.png')
        .setDisplaySize(20, len)
        .setAngle(laser.horizontal ? 90 : 0);
      // The shooter's prongs point up in the art; turn each to face along the beam.
      this.add.image(from.x, from.y, 'rb', 'laser_shooter.png').setAngle(laser.horizontal ? 90 : 180);
      this.add.image(to.x, to.y, 'rb', 'laser_shooter.png').setAngle(laser.horizontal ? -90 : 0);
      this.lasers.push({ from, to, beam, offset: i * 1100, on: false });
    });

    this.spinners = maze.spinners.map((s, i) => {
      const p = this.at(s);
      const bar = this.matter.add.image(p.x, p.y, 'rb', 'block_rotate_narrow.png', { ...WALL, restitution: 0.4 });
      // At three quarters size the tip clears the 3 x 3 cells around it by more than the ball's width,
      // so a ball resting against a wall there can't get pinned.
      bar.setScale(SPINNER_SCALE).setRotation(i * 0.9);
      return bar;
    });

    this.stars = maze.stars.map((s) => {
      const p = this.at(s);
      const img = this.add.image(p.x, p.y, 'rb', 'star.png').setScale(1.3);
      this.tweens.add({ targets: img, angle: { from: -12, to: 12 }, scale: 1.45, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.easeInOut' });
      return { at: p, img, taken: false };
    });
    if (maze.key) {
      const p = this.at(maze.key);
      const img = this.add.image(p.x, p.y, 'rb', 'key.png').setScale(1.3);
      this.tweens.add({ targets: img, y: p.y - 6, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.easeInOut' });
      this.key = { at: p, img };
    }

    this.sparkles = this.add
      .particles(0, 0, 'sparkle', {
        lifespan: { min: 400, max: 700 },
        speed: { min: 80, max: 220 },
        scale: { start: 0.1, end: 0 },
        rotate: { min: 0, max: 360 },
        tint: [0xffe27a, 0xffffff, 0xfff3b0],
        emitting: false,
      })
      .setDepth(40);
  }

  private buildBall() {
    const start = this.at(this.maze.start);
    const frame = this.level.board === 'blue' ? 'ball_red_large.png' : 'ball_blue_large.png';
    this.shadow = this.add.image(start.x + 4, start.y + 6, 'rb', frame).setScale(BALL_SCALE).setTint(0x000000).setAlpha(0.25).setDepth(19);
    this.ball = this.matter.add.image(start.x, start.y, 'rb', frame, {
      shape: { type: 'circle', radius: 32 },
      restitution: 0.4,
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0.012,
      label: 'ball',
    });
    // The highlight is painted on, so the ball mustn't visibly spin.
    this.ball.setScale(BALL_SCALE).setFixedRotation().setDepth(20);
  }

  // ---- HUD ---------------------------------------------------------------------------------------

  private buildHud() {
    const { width, height } = this.scale;
    this.add.text(width / 2, this.hudH - 36, `${this.levelIndex + 1}. ${this.level.name}`, { ...TEXT, fontSize: '38px', strokeThickness: 9 }).setOrigin(0.5);

    const footY = height - FOOT_H / 2;
    this.starIcons = [0, 1, 2].map((i) => this.add.image(PAD + 26 + i * 46, footY, 'rb', 'star_outline.png').setScale(1.3));
    this.timeText = this.add.text(width - PAD, footY, formatTime(0), { ...TEXT, fontSize: '34px', strokeThickness: 8 }).setOrigin(1, 0.5);
    const best = loadProgress().best[this.levelIndex];
    if (best) {
      this.add
        .text(width - PAD, footY + 30, `best ${formatTime(best)}`, { ...TEXT, fontSize: '18px', strokeThickness: 4, color: '#ffe27a' })
        .setOrigin(1, 0.5);
    }
    button(this, 'restart', () => this.restart(), { icon: 'return.png', w: 76, h: 60, size: 34, color: 0x2a78b5 }).setPosition(width / 2 - 46, footY);
    button(this, 'menu', () => this.toMenu(), { icon: 'menuList.png', w: 76, h: 60, size: 30, color: 0x2a78b5 }).setPosition(width / 2 + 46, footY);

    const tip = TIPS[this.levelIndex];
    if (tip) {
      const touch = this.sys.game.device.input.touch;
      this.tip = this.add
        .text(width / 2, this.origin.y + this.maze.rows * CELL - 30, tip[touch ? 1 : 0], {
          ...TEXT,
          fontSize: '24px',
          strokeThickness: 6,
          color: '#ffe27a',
          wordWrap: { width: this.maze.cols * CELL - 40 },
        })
        .setOrigin(0.5)
        .setDepth(50);
      this.tweens.add({ targets: this.tip, alpha: 0, delay: 5000, duration: 600 });
    }
  }

  private intro() {
    const { width, height } = this.scale;
    const banner = this.add
      .text(width / 2, height / 2, `LEVEL ${this.levelIndex + 1}`, { ...TEXT, fontSize: '96px', strokeThickness: 16 })
      .setOrigin(0.5)
      .setScale(0)
      .setDepth(70);
    this.tweens.chain({
      targets: banner,
      tweens: [
        { scale: 1, duration: 350, ease: 'Back.easeOut' },
        { alpha: 0, scale: 1.2, duration: 300, delay: 500, onComplete: () => banner.destroy() },
      ],
    });
    this.voice('level');
    this.time.delayedCall(500, () => this.voice(String(this.levelIndex + 1) as Voice));
  }

  // ---- Frame loop --------------------------------------------------------------------------------

  update(_time: number, delta: number) {
    this.updateSpinners(delta);
    this.updateLasers();
    if (this.state !== 'play') return;

    this.elapsed += delta;
    this.timeText.setText(formatTime(Math.floor(this.elapsed / 100)));

    const want = this.wantedTilt();
    this.tilt.lerp(want, 1 - Math.exp(-delta / 90));
    this.matter.world.setGravity(this.tilt.x * GRAVITY, this.tilt.y * GRAVITY);
    this.frameShadow.setPosition(-this.tilt.x * 8, -this.tilt.y * 8 + 6);
    this.drawJoystick();

    const v = this.velocity();
    const speed = Math.hypot(v.x, v.y);
    if (speed > MAX_SPEED) this.ball.setVelocity((v.x / speed) * MAX_SPEED, (v.y / speed) * MAX_SPEED);
    this.shadow.setPosition(this.ball.x + 4 + this.tilt.x * 3, this.ball.y + 6 + this.tilt.y * 3);
    // The tip gets out of the way once the ball's rolling.
    if (this.tip && speed > 2) {
      const tip = this.tip;
      this.tip = undefined;
      this.tweens.killTweensOf(tip);
      this.tweens.add({ targets: tip, alpha: 0, duration: 400 });
    }

    this.checkPickups();
    this.checkHoles(delta);
    this.checkLasers();
  }

  /** Tilt asked for by a drag, the keys or the phone, in that order. */
  private wantedTilt() {
    if (this.joy) return this.joy.vec;
    const [left, right, up, down] = this.keys.map((ks) => (ks.some((k) => k.isDown) ? 1 : 0));
    if (left || right || up || down) return new Phaser.Math.Vector2(right - left, down - up).limit(1);
    const g = gyro.read();
    return g ? new Phaser.Math.Vector2(g.x, g.y) : Phaser.Math.Vector2.ZERO;
  }

  private drawJoystick() {
    this.joyGfx.clear();
    if (!this.joy) return;
    const { x, y, vec } = this.joy;
    this.joyGfx.lineStyle(4, 0xffffff, 0.5).strokeCircle(x, y, JOY_RANGE);
    this.joyGfx.fillStyle(0xffffff, 0.45).fillCircle(x + vec.x * JOY_RANGE, y + vec.y * JOY_RANGE, 26);
  }

  private updateSpinners(delta: number) {
    this.spinners.forEach((bar, i) => bar.setRotation(bar.rotation + (i % 2 ? -1 : 1) * SPIN_SPEED * (delta / 1000)));
  }

  private updateLasers() {
    const now = this.time.now;
    for (const laser of this.lasers) {
      const on = (now + laser.offset) % LASER_CYCLE < LASER_ON;
      if (on && !laser.on && this.state === 'play') playSfx(this, SFX, 'laser', { volume: 0.12 });
      laser.on = on;
      laser.beam.setAlpha(on ? 0.75 + Math.random() * 0.25 : 0.12);
    }
  }

  private distanceTo(p: Point) {
    return Math.hypot(this.ball.x - p.x, this.ball.y - p.y);
  }

  private checkPickups() {
    for (const star of this.stars) {
      if (star.taken || this.distanceTo(star.at) > 30) continue;
      star.taken = true;
      this.collected++;
      playSfx(this, SFX, 'star', { volume: 0.5 });
      this.sparkles.emitParticleAt(star.at.x, star.at.y, 12);
      this.tweens.killTweensOf(star.img);
      this.tweens.add({ targets: star.img, scale: 2.4, alpha: 0, duration: 300, onComplete: () => star.img.destroy() });
      const icon = this.starIcons[this.collected - 1];
      icon.setFrame('star.png');
      this.tweens.add({ targets: icon, scale: { from: 2.2, to: 1.3 }, duration: 300, ease: 'Back.easeOut' });
    }
    if (this.key && !this.hasKey && this.distanceTo(this.key.at) < 30) this.takeKey();
  }

  private takeKey() {
    this.hasKey = true;
    const { img, at } = this.key!;
    playSfx(this, SFX, 'key', { volume: 0.5 });
    this.sparkles.emitParticleAt(at.x, at.y, 10);
    this.tweens.killTweensOf(img);
    this.tweens.add({ targets: img, scale: 2.4, alpha: 0, angle: 180, duration: 350, onComplete: () => img.destroy() });
    this.time.delayedCall(250, () => {
      playSfx(this, SFX, 'unlock', { volume: 0.5 });
      for (const body of this.lockedBodies) this.matter.world.remove(body);
      this.tweens.add({ targets: this.lockedParts, alpha: 0, scale: 0.6, duration: 350, ease: 'Back.easeIn' });
      if (this.maze.goal.locked) {
        this.goalImg.setFrame('hole_large_end.png');
        this.sparkles.emitParticleAt(this.goalImg.x, this.goalImg.y, 14);
        this.tweens.add({ targets: this.goalImg, scale: { from: 1.3, to: 1 }, duration: 350, ease: 'Back.easeOut' });
      }
    });
  }

  /** The ball's velocity in Matter's per-1/60s units, whatever the step rate. */
  private velocity() {
    return this.matter.body.getVelocity(this.ball.body as MatterJS.BodyType);
  }

  private checkHoles(delta: number) {
    const goal = this.at(this.maze.goal);
    const goalOpen = !this.maze.goal.locked || this.hasKey;
    if (goalOpen && this.pull(goal, 40, 16, delta)) {
      this.win(goal);
      return;
    }
    for (const hole of this.maze.holes) {
      const p = this.at(hole);
      if (this.pull(p, 28, 12, delta)) {
        this.lose(p, 'fall');
        return;
      }
    }
  }

  /** Draws the ball towards a hole's centre once it's over the rim. True when it drops in. */
  private pull(p: Point, rim: number, drop: number, delta: number) {
    const d = this.distanceTo(p);
    if (d > rim) return false;
    if (d < drop) return true;
    // Scaled by frame time, so the pull is as strong at 120 frames a second as at 60.
    const strength = 0.35 * (1 - d / rim) * (delta / (1000 / 60));
    const v = this.velocity();
    this.ball.setVelocity(v.x + ((p.x - this.ball.x) / d) * strength, v.y + ((p.y - this.ball.y) / d) * strength);
    return false;
  }

  private checkLasers() {
    for (const laser of this.lasers) {
      if (!laser.on) continue;
      const { from, to } = laser;
      // Distance from the ball's centre to the beam's segment.
      const len2 = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
      const t = Phaser.Math.Clamp(((this.ball.x - from.x) * (to.x - from.x) + (this.ball.y - from.y) * (to.y - from.y)) / len2, 0, 1);
      const d = Math.hypot(this.ball.x - (from.x + t * (to.x - from.x)), this.ball.y - (from.y + t * (to.y - from.y)));
      if (d < BALL_RADIUS + 4) {
        this.lose({ x: this.ball.x, y: this.ball.y }, 'zap');
        return;
      }
    }
  }

  private onCollisions(event: Phaser.Physics.Matter.Events.CollisionStartEvent) {
    for (const pair of event.pairs) {
      if (pair.bodyA.label !== 'ball' && pair.bodyB.label !== 'ball') continue;
      const v = this.velocity();
      const n = pair.collision.normal;
      const speed = Math.abs(v.x * n.x + v.y * n.y);
      if (speed < 2 || this.time.now - this.lastKnock < 60) continue;
      this.lastKnock = this.time.now;
      playSfx(this, SFX, 'knock', { volume: Math.min(0.6, speed / 14) });
    }
  }

  // ---- Losing and winning ------------------------------------------------------------------------------

  /** Takes the ball out of play: no collisions, no gravity, still. */
  private freeze() {
    this.ball.setVelocity(0, 0).setSensor(true).setIgnoreGravity(true);
    this.joy = undefined;
    this.joyGfx.clear();
  }

  private lose(at: Point, how: 'fall' | 'zap') {
    this.state = 'lost';
    this.freeze();
    this.shadow.setVisible(false);
    if (how === 'fall') {
      playSfx(this, SFX, 'fall', { volume: 0.5 });
      this.tweens.add({ targets: this.ball, x: at.x, y: at.y, scale: 0, duration: 320, ease: 'Quad.easeIn' });
    } else {
      playSfx(this, SFX, 'zap', { volume: 0.5 });
      this.cameras.main.shake(150, 0.006);
      this.ball.setTint(0xff5a5a);
      this.tweens.add({ targets: this.ball, scale: BALL_SCALE * 1.6, alpha: 0, duration: 300 });
    }
    this.time.delayedCall(650, () => this.respawn());
  }

  private respawn() {
    const start = this.at(this.maze.start);
    this.ball.clearTint().setAlpha(1).setPosition(start.x, start.y).setScale(0);
    this.ball.setSensor(false).setIgnoreGravity(false).setVelocity(0, 0);
    this.tilt.set(0, 0);
    this.shadow.setVisible(true).setPosition(start.x + 4, start.y + 6);
    playSfx(this, SFX, 'respawn', { volume: 0.35 });
    this.tweens.add({ targets: this.ball, scale: BALL_SCALE, duration: 250, ease: 'Back.easeOut' });
    this.state = 'play';
  }

  private win(goal: Point) {
    this.state = 'won';
    this.freeze();
    this.shadow.setVisible(false);
    this.matter.world.setGravity(0, 0);
    playSfx(this, SFX, 'goal', { volume: 0.5 });
    this.tweens.add({ targets: this.ball, x: goal.x, y: goal.y, scale: 0, duration: 450, ease: 'Quad.easeIn' });
    this.sparkles.emitParticleAt(goal.x, goal.y, 20);

    const last = this.levelIndex === LEVELS.length - 1;
    const tenths = Math.max(1, Math.floor(this.elapsed / 100));
    const record = recordClear(this.levelIndex, tenths, this.collected);
    this.sound.play(last ? 'jingle:finale' : 'jingle:win', { volume: 0.5 });
    this.time.delayedCall(500, () => this.voice(last ? 'congratulations' : record.isNew ? 'new_highscore' : 'you_win'));
    this.time.delayedCall(900, () => this.showPanel(tenths, record.best, record.isNew, last));
  }

  private showPanel(tenths: number, best: number, isNew: boolean, last: boolean) {
    const { width, height } = this.scale;
    const w = Math.min(620, width - 40);
    const h = 440;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.28).fillRoundedRect(-w / 2, -h / 2 + 10, w, h, 30);
    g.fillStyle(0x2a78b5).fillRoundedRect(-w / 2, -h / 2, w, h, 30);
    g.lineStyle(6, 0xffffff, 0.4).strokeRoundedRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16, 24);
    const heading = this.add.text(0, -h / 2 + 64, last ? 'ALL DONE!' : 'NICE ROLL!', { ...TEXT, fontSize: '56px', strokeThickness: 11 }).setOrigin(0.5);

    const row = starRow(this, this.collected, 2.6, 100);
    row.forEach((star, i) => {
      const scale = star.scale;
      star.setScale(0);
      this.tweens.add({
        targets: star,
        scale,
        duration: 320,
        delay: 350 + i * 300,
        ease: 'Back.easeOut',
        onStart: () => i < this.collected && playSfx(this, SFX, 'star', { volume: 0.5, detune: i * 200 }),
      });
    });
    const stars = this.add.container(0, -h / 2 + 160, row);
    const time = this.add.text(0, -h / 2 + 248, formatTime(tenths), { ...TEXT, fontSize: '46px', strokeThickness: 9 }).setOrigin(0.5);
    const bestText = this.add
      .text(0, -h / 2 + 296, isNew ? 'New best time!' : `best ${formatTime(best)}`, { ...TEXT, fontSize: '24px', strokeThickness: 6, color: '#ffe27a' })
      .setOrigin(0.5);
    const retry = button(this, 'RETRY', () => this.restart(), { w: 200, h: 72, size: 30, color: 0x7a8a94 }).setPosition(-115, h / 2 - 64);
    const next = button(this, last ? 'MENU' : 'NEXT', () => this.next(), { w: 200, h: 72, size: 30, color: 0x2ecc71 }).setPosition(115, h / 2 - 64);

    const shade = this.add.rectangle(0, 0, width * 2, height * 2, 0x0d3550, 0.45);
    const panel = this.add.container(width / 2, height / 2, [shade, g, heading, stars, time, bestText, retry, next]).setDepth(80).setAlpha(0);
    this.tweens.add({ targets: panel, alpha: 1, duration: 220 });
    heading.setScale(0.4);
    this.tweens.add({ targets: heading, scale: 1, duration: 380, ease: 'Back.easeOut' });
  }

  private next() {
    if (this.levelIndex === LEVELS.length - 1) this.toMenu();
    else this.scene.restart({ level: this.levelIndex + 1 });
  }

  private restart() {
    this.scene.restart({ level: this.levelIndex });
  }

  private toMenu() {
    this.scene.start('title');
  }

  private voice(name: Voice) {
    this.sound.play(`voice:${name}`, { volume: 0.8 });
  }
}
