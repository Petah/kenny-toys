import * as Phaser from 'phaser';
import { FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { submitHighScore, load } from '@shared/storage';
import { SFX, preloadAssets, type Voice } from './assets';
import { Lane, type Hit } from './Lane';
import { SpriteNumber } from './SpriteNumber';

export const WIDTH = 1280;
export const HEIGHT = 720;
const ROUND_SECONDS = 60;
const CLIP_SIZE = 6;
const COUNTER_TOP = 600;
/** Curtains cover the stall edges; shots there just hit fabric. */
const CURTAIN = { left: 175, right: WIDTH - 175, bottom: 128 };

type State = 'title' | 'countdown' | 'playing' | 'over';

const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#5a3418',
  strokeThickness: 10,
  align: 'center',
};

export class GalleryScene extends Phaser.Scene {
  private state: State = 'title';
  private lanes: Lane[] = [];
  private waters: Phaser.GameObjects.TileSprite[] = [];
  private clouds: Phaser.GameObjects.Image[] = [];
  private crosshair!: Phaser.GameObjects.Image;
  private rifle!: Phaser.GameObjects.Image;
  private scoreText!: SpriteNumber;
  private timerText!: SpriteNumber;
  private comboText!: SpriteNumber;
  private bullets: Phaser.GameObjects.Image[] = [];
  private overlay?: Phaser.GameObjects.Container;
  private music?: Phaser.Sound.BaseSound;

  private score = 0;
  private timeLeft = ROUND_SECONDS;
  private ammo = CLIP_SIZE;
  private reloading = false;
  private streak = 0;
  private shots = 0;
  private hits = 0;
  private lastCallout = 0;
  private shownMultiplier = 1;

  constructor() {
    super('gallery');
  }

  preload() {
    preloadAssets(this);
  }

  create() {
    this.buildStall();
    this.buildHud();
    this.input.setDefaultCursor('none');
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.keyboard?.on('keydown-R', () => this.reload());
    this.input.keyboard?.on('keydown-SPACE', () => this.reload());
    this.showTitle();
  }

  // ---- Scene building ---------------------------------------------------------------------

  private buildStall() {
    this.add.tileSprite(0, 0, WIDTH, HEIGHT, 'stall', 'bg_wood.png').setOrigin(0);

    this.clouds = [
      [330, 175, 'cloud1'],
      [700, 140, 'cloud2'],
      [1010, 195, 'cloud1'],
    ].map(([x, y, f]) => this.add.image(x as number, y as number, 'stall', `${f}.png`).setDepth(1));
    this.add.image(250, 335, 'stall', 'tree_pine.png').setOrigin(0.5, 1).setDepth(2);
    this.add.image(560, 345, 'stall', 'tree_oak.png').setOrigin(0.5, 1).setDepth(2).setScale(0.85);
    this.add.image(1040, 340, 'stall', 'tree_oak.png').setOrigin(0.5, 1).setDepth(2);

    // Back to front: targets behind grass, then two rows of ducks each behind a band of water.
    this.add.tileSprite(0, 300, WIDTH, 200, 'stall', 'grass1.png').setOrigin(0).setDepth(10);
    this.waters = [
      this.add.tileSprite(0, 420, WIDTH, 224, 'stall', 'water1.png').setOrigin(0).setDepth(20),
      this.add.tileSprite(0, 512, WIDTH, 223, 'stall', 'water2.png').setOrigin(0).setDepth(30),
    ];
    this.lanes = [
      new Lane(this, { kind: 'targets', y: 250, direction: -1, speed: 110, depth: 5, gap: [190, 340], coverTop: 312 }, WIDTH),
      new Lane(this, { kind: 'ducks', y: 392, direction: 1, speed: 150, depth: 15, gap: [170, 300], coverTop: 438 }, WIDTH),
      new Lane(this, { kind: 'ducks', y: 486, direction: -1, speed: 200, depth: 25, gap: [200, 360], coverTop: 530 }, WIDTH),
    ];

    this.add.tileSprite(0, COUNTER_TOP, WIDTH, HEIGHT - COUNTER_TOP, 'stall', 'bg_wood.png').setOrigin(0).setDepth(40).setTint(0xe8b47a);
    this.add.rectangle(0, COUNTER_TOP, WIDTH, 10, 0x7a4520).setOrigin(0).setDepth(41);

    this.add.tileSprite(0, 0, WIDTH, 80, 'stall', 'curtain_straight.png').setOrigin(0).setDepth(50);
    for (let x = -20; x < WIDTH; x += 196) this.add.image(x, 66, 'stall', 'curtain_top.png').setOrigin(0).setDepth(51);
    this.add.image(0, 40, 'stall', 'curtain.png').setOrigin(0).setScale(1.45, 1.6).setDepth(52);
    this.add.image(WIDTH, 40, 'stall', 'curtain.png').setOrigin(0).setScale(-1.45, 1.6).setDepth(52);
    this.add.image(40, 470, 'stall', 'curtain_rope.png').setScale(1.6).setDepth(53);
    this.add.image(WIDTH - 40, 470, 'stall', 'curtain_rope.png').setScale(-1.6, 1.6).setDepth(53);
  }

  private buildHud() {
    this.add.image(220, 170, 'hud', 'icon_duck.png').setDepth(60).setScale(1.3);
    this.scoreText = new SpriteNumber(this, 250, 170).setDepth(60).set(0);
    this.comboText = new SpriteNumber(this, 220, 220, true).setDepth(60).setVisible(false);
    this.timerText = new SpriteNumber(this, WIDTH - 205, 170, false, 'right').setDepth(60);
    this.updateTimer();

    for (let i = 0; i < CLIP_SIZE; i++) {
      const b = this.add.image(WIDTH - 210 - i * 30, 660, 'hud', 'icon_bullet_gold_long.png').setDepth(60);
      b.setInteractive().on('pointerdown', (p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        if (this.state !== 'playing' || p.rightButtonDown()) return;
        e.stopPropagation();
        this.reload();
      });
      this.bullets.push(b);
    }

    this.rifle = this.add.image(WIDTH / 2, HEIGHT + 110, 'objects', 'rifle.png').setOrigin(0.5, 1).setDepth(45).setScale(1.15);
    this.crosshair = this.add.image(WIDTH / 2, HEIGHT / 2, 'hud', 'crosshair_white_large.png').setDepth(70).setScale(1.2);
  }

  // ---- Round flow --------------------------------------------------------------------------

  private showTitle() {
    this.state = 'title';
    const best = load('duck-shoot:best', 0);
    this.setOverlay(
      this.panel(WIDTH / 2 - 470, 170, 940, best ? 320 : 280),
      this.add.text(WIDTH / 2, 270, 'DUCK SHOOT', { ...TEXT_STYLE, fontSize: '96px', strokeThickness: 14 }).setOrigin(0.5),
      this.pulse(this.add.text(WIDTH / 2, 390, 'click to start', { ...TEXT_STYLE, fontSize: '40px' }).setOrigin(0.5)),
      ...(best ? [this.add.text(WIDTH / 2, 450, `best ${best}`, { ...TEXT_STYLE, fontSize: '28px', color: '#ffd35c' }).setOrigin(0.5)] : []),
    );
  }

  private startRound() {
    this.score = 0;
    this.timeLeft = ROUND_SECONDS;
    this.streak = this.shots = this.hits = 0;
    this.lastCallout = 0;
    this.ammo = CLIP_SIZE;
    this.reloading = false;
    this.scoreText.set(0);
    this.updateTimer();
    this.updateAmmo();
    this.updateCombo();
    this.setOverlay();

    this.state = 'countdown';
    this.banner('text_ready.png', 1000);
    this.voice('ready');
    this.time.delayedCall(1200, () => {
      this.banner('text_go.png', 600);
      this.voice('go');
      this.state = 'playing';
      this.music ??= this.sound.add('music', { loop: true, volume: 0.35 });
      this.music.play();
    });
  }

  private endRound() {
    this.state = 'over';
    this.music?.stop();
    this.banner('text_timeup.png', 1400);
    this.voice('time_over');
    const { best, isNew } = submitHighScore('duck-shoot', this.score);
    const accuracy = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;

    this.time.delayedCall(1600, () => {
      if (isNew && this.score > 0) this.voice('new_highscore');
      const panel = this.panel(WIDTH / 2 - 300, 190, 600, 330);
      const scoreLabel = this.add.image(WIDTH / 2, 250, 'hud', 'text_score.png');
      const scoreNum = new SpriteNumber(this, WIDTH / 2, 330, false, 'center').set(this.score).setScale(1.4);
      const stats = this.add
        .text(WIDTH / 2, 410, `${isNew && this.score > 0 ? 'NEW BEST!' : `best ${best}`}\n${this.hits} hits · ${accuracy}% accuracy`, {
          ...TEXT_STYLE,
          fontSize: '28px',
          strokeThickness: 0,
          lineSpacing: 10,
          color: isNew && this.score > 0 ? '#ffd35c' : '#ffffff',
        })
        .setOrigin(0.5);
      const again = this.add.text(WIDTH / 2, 575, 'click to play again', { ...TEXT_STYLE, fontSize: '36px' }).setOrigin(0.5).setAlpha(0);
      this.setOverlay(panel, scoreLabel, scoreNum, stats, again);
      this.overlay!.setAlpha(0);
      this.tweens.add({ targets: this.overlay, alpha: 1, duration: 300 });
      // A short pause so a frantic last click doesn't skip the results.
      this.time.delayedCall(900, () => {
        again.setAlpha(1);
        this.pulse(again);
        this.state = 'title';
      });
    });
  }

  private setOverlay(...children: Phaser.GameObjects.GameObject[]) {
    this.overlay?.destroy();
    this.overlay = children.length ? this.add.container(0, 0, children).setDepth(80) : undefined;
  }

  private panel(x: number, y: number, w: number, h: number) {
    return this.add.graphics().fillStyle(0x5a3418, 0.85).fillRoundedRect(x, y, w, h, 28);
  }

  private pulse<T extends Phaser.GameObjects.Text>(text: T) {
    this.tweens.add({ targets: text, scale: 1.08, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.easeInOut' });
    return text;
  }

  private banner(frame: string, hold: number) {
    const img = this.add.image(WIDTH / 2, 300, 'hud', frame).setDepth(75).setScale(0);
    this.tweens.chain({
      targets: img,
      tweens: [
        { scale: 1.6, duration: 300, ease: 'Back.easeOut' },
        { scale: 1.4, alpha: 0, duration: 250, delay: hold, ease: 'Sine.easeIn' },
      ],
      onComplete: () => img.destroy(),
    });
  }

  private voice(name: Voice) {
    this.sound.play(`voice:${name}`, { volume: 0.9 });
  }

  // ---- Shooting -----------------------------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    this.crosshair.setPosition(pointer.worldX, pointer.worldY);
    if (this.state === 'title') return this.startRound();
    if (this.state !== 'playing') return;
    if (pointer.rightButtonDown()) return this.reload();
    this.shoot(pointer.worldX, pointer.worldY);
  }

  private shoot(x: number, y: number) {
    if (this.reloading) return;
    if (this.ammo === 0) {
      playSfx(this, SFX, 'empty');
      this.reload();
      return;
    }
    this.ammo--;
    this.shots++;
    this.updateAmmo();
    playSfx(this, SFX, 'shoot', { volume: 0.45 });
    this.cameras.main.shake(70, 0.004);
    this.tweens.add({ targets: this.rifle, y: HEIGHT + 140, duration: 50, yoyo: true, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: this.crosshair, scale: 1.5, duration: 60, yoyo: true });

    const hit = this.findHit(x, y);
    if (hit && 'target' in hit) this.onHit(hit, x, y);
    else this.onMiss(x, y, hit?.surface ?? 'wood');
    if (this.ammo === 0) this.time.delayedCall(250, () => this.ammo === 0 && !this.reloading && this.blinkAmmo());
  }

  /** Walks the stall front to back; scenery in front of a lane blocks shots at it. */
  private findHit(x: number, y: number): Hit | { surface: 'wood' | 'water' | 'grass' | 'cloth' } | null {
    if (y < CURTAIN.bottom || x < CURTAIN.left || x > CURTAIN.right) return { surface: 'cloth' };
    if (y >= COUNTER_TOP) return { surface: 'wood' };
    for (const lane of [...this.lanes].reverse()) {
      if (y >= lane.config.coverTop) return { surface: lane.config.kind === 'targets' ? 'grass' : 'water' };
      for (const target of [...lane.targets].reverse()) {
        const hit = target.hitTest(x, y);
        if (hit) return hit;
      }
    }
    return null;
  }

  private onHit(hit: Hit, x: number, y: number) {
    this.hits++;
    this.streak++;
    const multiplier = this.multiplier();
    const points = hit.points * multiplier;
    this.score += points;
    this.scoreText.set(this.score);
    this.tweens.add({ targets: this.scoreText, scale: 1.2, duration: 80, yoyo: true });
    this.updateCombo();

    const isMetal = hit.target.kind === 'target' || hit.target.kind === 'gold';
    playSfx(this, SFX, isMetal ? 'hitMetal' : 'hitWood');
    if (hit.bullseye || hit.target.kind === 'gold') playSfx(this, SFX, 'bonus', { volume: 0.5 });

    const lane = this.lanes.find((l) => l.targets.includes(hit.target));
    lane?.remove(hit.target);
    hit.target.knockDown(hit, () => {});

    const popup = new SpriteNumber(this, x, y - 30, points < 50, 'center').set(points, true).setDepth(65);
    this.tweens.add({ targets: popup, y: y - 110, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: () => popup.destroy() });
    if (hit.bullseye) {
      const label = this.add.text(x, y - 130, 'BULLSEYE!', { ...TEXT_STYLE, fontSize: '30px', color: '#ffd35c', strokeThickness: 8 }).setOrigin(0.5).setDepth(65);
      this.tweens.add({ targets: label, y: y - 170, alpha: 0, duration: 900, delay: 200, onComplete: () => label.destroy() });
    }
  }

  private onMiss(x: number, y: number, surface: 'wood' | 'water' | 'grass' | 'cloth') {
    this.streak = 0;
    this.updateCombo();
    playSfx(this, SFX, 'miss', { volume: 0.4 });
    if (surface === 'water') {
      const ring = this.add.ellipse(x, y, 16, 6).setStrokeStyle(3, 0xffffff, 0.9).setDepth(35);
      this.tweens.add({ targets: ring, scaleX: 4, scaleY: 3, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
    } else if (surface !== 'cloth') {
      const depth = y >= COUNTER_TOP ? 42 : surface === 'grass' ? 11 : 3;
      const hole = this.add.image(x, y, 'objects', 'shot_grey_small.png').setDepth(depth);
      this.tweens.add({ targets: hole, alpha: 0, delay: 3000, duration: 800, onComplete: () => hole.destroy() });
    }
  }

  private multiplier() {
    return Math.min(4, 1 + Math.floor(this.streak / 5));
  }

  private reload() {
    if (this.state !== 'playing' || this.reloading || this.ammo === CLIP_SIZE) return;
    this.reloading = true;
    this.crosshair.setFrame('crosshair_red_large.png');
    this.time.addEvent({
      delay: 120,
      repeat: CLIP_SIZE - this.ammo - 1,
      callback: () => {
        this.ammo++;
        this.updateAmmo();
        playSfx(this, SFX, 'load', { volume: 0.5 });
        if (this.ammo === CLIP_SIZE) {
          this.reloading = false;
          this.crosshair.setFrame('crosshair_white_large.png');
        }
      },
    });
  }

  // ---- HUD -------------------------------------------------------------------------------------

  private updateAmmo() {
    this.bullets.forEach((b, i) => {
      // Bullets are laid out right to left, and spent from the left.
      b.setFrame(i < this.ammo ? 'icon_bullet_gold_long.png' : 'icon_bullet_empty_long.png');
    });
  }

  private blinkAmmo() {
    this.tweens.add({ targets: this.bullets, alpha: 0.3, duration: 150, yoyo: true, repeat: 3 });
  }

  private updateCombo() {
    const m = this.multiplier();
    this.comboText.setVisible(m > 1);
    if (m > 1 && m !== this.shownMultiplier) {
      // "×2" built from the cross glyph plus a digit.
      this.comboText.set(m);
      const cross = this.add.image(-6, 0, 'hud', 'text_cross_small.png').setOrigin(1, 0.5);
      this.comboText.addAt(cross, 0);
      this.tweens.add({ targets: this.comboText, scale: { from: 1.6, to: 1 }, duration: 250, ease: 'Back.easeOut' });
    }
    this.shownMultiplier = m;
  }

  private updateTimer() {
    const s = Math.ceil(this.timeLeft);
    this.timerText.set(`0:${String(s).padStart(2, '0')}`.replace('0:60', '1:00'));
  }

  // ---- Frame loop -----------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 30);
    const pointer = this.input.activePointer;
    if (!pointer.wasTouch) this.crosshair.setPosition(pointer.worldX, pointer.worldY);

    // The rifle follows the crosshair from below and leans towards it.
    const targetX = WIDTH / 2 + (this.crosshair.x - WIDTH / 2) * 0.55 + 140;
    this.rifle.x += (targetX - this.rifle.x) * Math.min(1, dt * 12);
    this.rifle.rotation = Math.atan2(this.crosshair.x - this.rifle.x, this.rifle.y - this.crosshair.y) * 0.5;

    const t = time / 1000;
    this.waters.forEach((w, i) => {
      w.tilePositionX = Math.sin(t * 0.8 + i * 1.7) * 30;
      w.y = (i ? 512 : 420) + Math.sin(t * 1.6 + i) * 4;
    });
    for (const c of this.clouds) c.x = ((c.x + 6 * dt + 200) % (WIDTH + 400)) - 200;

    let speed = this.state === 'title' ? 0.7 : 1;
    if (this.state === 'playing') {
      this.timeLeft -= dt;
      speed = 1 + (1 - this.timeLeft / ROUND_SECONDS) * 0.8;
      const s = Math.ceil(this.timeLeft);
      if (s !== this.lastCallout) {
        this.lastCallout = s;
        if (s === 10) this.voice('hurry_up');
        if (s <= 5 && s >= 1) this.voice(String(s) as Voice);
        if (s <= 10) this.tweens.add({ targets: this.timerText, scale: 1.25, duration: 100, yoyo: true });
      }
      this.updateTimer();
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.updateTimer();
        this.endRound();
      }
    }
    for (const lane of this.lanes) lane.update(time, dt, speed);
  }
}
