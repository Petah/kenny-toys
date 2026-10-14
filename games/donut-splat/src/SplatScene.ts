import * as Phaser from 'phaser';
import { FONT_HEADING } from '@shared/fonts';
import { ICONS } from '@shared/icons';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { SFX, SPLAT_COUNT, preloadAssets } from './assets';
import { DONUT_SIZE, bakeDonuts, type DonutType } from './donuts';

const BG = 0x3e7ab3;
const LIVES = 3;
const TRAIL_MS = 140;

type State = 'title' | 'playing' | 'over';

interface Flyer {
  obj: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  spin: number;
  /** "button" donuts float in place on the title and game-over screens; slicing one (re)starts. */
  kind: 'donut' | 'bomb' | 'half' | 'button';
  type?: DonutType;
}

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#21476b',
  strokeThickness: 10,
  align: 'center',
};

export class SplatScene extends Phaser.Scene {
  private state: State = 'title';
  private donutTypes: DonutType[] = [];
  private flyers: Flyer[] = [];
  private paint!: Phaser.GameObjects.RenderTexture;
  private trail!: Phaser.GameObjects.Graphics;
  private drops!: Phaser.GameObjects.Particles.ParticleEmitter;
  private points: { x: number; y: number; t: number }[] = [];
  private scoreText!: Phaser.GameObjects.Text;
  private lifeIcons: Phaser.GameObjects.Image[] = [];
  private overlay?: Phaser.GameObjects.Container;
  private music?: Phaser.Sound.BaseSound;

  private score = 0;
  private lives = LIVES;
  private elapsed = 0;
  private untilWave = 0;
  private strokeHits: { count: number; x: number; y: number; at: number } = { count: 0, x: 0, y: 0, at: 0 };
  private lastWhoosh = 0;

  constructor() {
    super('splat');
  }

  /** Gameplay scale: everything is sized relative to the screen so phones play like desktops. */
  private get u() {
    return Math.min(this.scale.height / 720, this.scale.width / 520);
  }

  preload() {
    preloadAssets(this);
  }

  create() {
    this.donutTypes = bakeDonuts(this, 24);
    this.anims.create({
      key: 'boom',
      frames: this.anims.generateFrameNames('boom', { prefix: 'regularExplosion', start: 0, end: 8, zeroPad: 2, suffix: '.png' }),
      frameRate: 24,
    });

    // The background is a canvas the splats are painted into, so it doubles as the artwork.
    this.paint = this.add.renderTexture(0, 0, Math.max(this.scale.width, 2560), Math.max(this.scale.height, 1600)).setOrigin(0);
    this.clearPaint();

    this.trail = this.add.graphics().setDepth(50);
    this.drops = this.add.particles(0, 0, 'drop', {
      speed: { min: 150, max: 480 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.08, end: 0 },
      lifespan: { min: 350, max: 700 },
      gravityY: 1100,
      emitting: false,
    });
    this.drops.setDepth(20);

    this.scoreText = this.add.text(this.scale.width / 2, 22, '', { ...TEXT, fontSize: '56px' }).setOrigin(0.5, 0).setDepth(60);
    for (let i = 0; i < LIVES; i++) this.lifeIcons.push(this.add.image(0, 0, 'donuts', 'donut_1.png').setDepth(60));
    this.layoutHud();
    this.scale.on('resize', () => this.layoutHud());

    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => (this.points = [{ x: p.x, y: p.y, t: this.time.now }]));
    this.input.on('pointerup', () => this.endStroke());

    this.showTitle();
  }

  private layoutHud() {
    const u = this.u;
    this.scoreText.setPosition(this.scale.width / 2, 18 * u).setFontSize(Math.round(56 * u));
    this.lifeIcons.forEach((icon, i) => icon.setScale(0.17 * u).setPosition(this.scale.width - (30 + i * 52) * u, 42 * u));
  }

  // ---- Screens ----------------------------------------------------------------------------

  private showTitle() {
    this.state = 'title';
    this.scoreText.setVisible(false);
    this.lifeIcons.forEach((i) => i.setVisible(false));
    const { width: w, height: h } = this.scale;
    const u = this.u;
    const best = load('donut-splat:best', 0);
    this.setOverlay(
      this.add.text(w / 2, Math.max(50 * u, 64), 'DONUT\nSPLAT', { ...TEXT, fontSize: `${Math.round(90 * u)}px`, strokeThickness: 16, lineSpacing: -10 }).setOrigin(0.5, 0),
      this.add.text(w / 2, h * 0.82, 'swipe the donut to start', { ...TEXT, fontSize: `${Math.round(30 * u)}px` }).setOrigin(0.5),
      ...(best ? [this.add.text(w / 2, h * 0.9, `best ${best}`, { ...TEXT, fontSize: `${Math.round(24 * u)}px`, color: '#ffd35c' }).setOrigin(0.5)] : []),
    );
    this.addButtonDonut(w / 2, h * 0.6);
  }

  private startRound() {
    this.setOverlay();
    this.flyers.filter((f) => f.kind === 'button').forEach((f) => this.removeFlyer(f));
    this.clearPaint();
    this.state = 'playing';
    this.score = 0;
    this.lives = LIVES;
    this.elapsed = 0;
    this.untilWave = 0.6;
    this.scoreText.setText('0').setVisible(true);
    this.lifeIcons.forEach((i) => i.setVisible(true).clearTint().setAlpha(1));
    this.music ??= this.sound.add('music', { loop: true, volume: 0.35 });
    if (!this.music.isPlaying) this.music.play();
  }

  private gameOver() {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.music?.stop();
    this.sound.play('voice:game_over');
    const { best, isNew } = submitHighScore('donut-splat', this.score);
    const { width: w, height: h } = this.scale;
    const u = this.u;

    this.time.delayedCall(1300, () => {
      this.scoreText.setVisible(false);
      if (isNew && this.score > 0) this.sound.play('voice:new_highscore');
      const saveButton = this.add
        .text(w / 2, h * 0.84, 'save my splat art', { ...TEXT, fontSize: `${Math.round(26 * u)}px`, backgroundColor: '#21476b', padding: { x: 18, y: 10 }, strokeThickness: 0 })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
          e.stopPropagation();
          this.saveArt();
        });
      this.setOverlay(
        this.add.text(w / 2, h * 0.16, `${this.score}`, { ...TEXT, fontSize: `${Math.round(120 * u)}px`, strokeThickness: 16 }).setOrigin(0.5),
        this.add
          .text(w / 2, h * 0.3, isNew && this.score > 0 ? 'NEW BEST!' : `best ${best}`, { ...TEXT, fontSize: `${Math.round(32 * u)}px`, color: '#ffd35c' })
          .setOrigin(0.5),
        this.add.text(w / 2, h * 0.72, 'swipe to play again', { ...TEXT, fontSize: `${Math.round(28 * u)}px` }).setOrigin(0.5),
        saveButton,
      );
      this.addButtonDonut(w / 2, h * 0.52);
    });
  }

  private setOverlay(...children: Phaser.GameObjects.GameObject[]) {
    // Shrink any line that would overflow a narrow (phone) screen.
    const maxWidth = this.scale.width - 32;
    for (const c of children) if (c instanceof Phaser.GameObjects.Text && c.width > maxWidth) c.setScale(maxWidth / c.width);
    this.overlay?.destroy();
    this.overlay = children.length ? this.add.container(0, 0, children).setDepth(70) : undefined;
    if (this.overlay) {
      this.overlay.setAlpha(0);
      this.tweens.add({ targets: this.overlay, alpha: 1, duration: 250 });
    }
  }

  private addButtonDonut(x: number, y: number) {
    const type = Phaser.Utils.Array.GetRandom(this.donutTypes);
    const obj = this.add.image(x, y, type.key).setScale(0).setDepth(30);
    this.tweens.add({ targets: obj, scale: 0.85 * this.u, duration: 400, ease: 'Back.easeOut' });
    this.flyers.push({ obj, vx: 0, vy: 0, spin: 0.6, kind: 'button', type });
  }

  // ---- Spawning ---------------------------------------------------------------------------

  private wave() {
    const difficulty = Math.min(1, this.elapsed / 80);
    const count = Phaser.Math.Between(1, 2 + Math.round(difficulty * 3));
    let bombs = 0;
    const maxBombs = difficulty > 0.6 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const bomb = this.elapsed > 6 && bombs < maxBombs && Math.random() < 0.12 + 0.18 * difficulty;
      if (bomb) bombs++;
      this.time.delayedCall(i * Phaser.Math.Between(60, 220), () => this.state === 'playing' && this.toss(bomb));
    }
    this.untilWave = 2.1 - 0.9 * difficulty + count * 0.12;
  }

  private toss(bomb: boolean) {
    const { width: w, height: h } = this.scale;
    const u = this.u;
    const g = 1500 * u;
    const x = Phaser.Math.FloatBetween(0.15, 0.85) * w;
    const y = h + 70 * u;
    const apex = Phaser.Math.FloatBetween(0.12, 0.4) * h;
    const vy = -Math.sqrt(2 * g * (y - apex));
    const flight = (2 * -vy) / g;
    const vx = ((w / 2 - x) * Phaser.Math.FloatBetween(0.2, 0.9)) / flight;
    const spin = Phaser.Math.FloatBetween(-4, 4);

    if (bomb) {
      const obj = this.add.image(x, y, 'bomb').setScale(1.05 * u).setDepth(31);
      // Flicker the fuse so bombs read as "don't touch" at a glance.
      const fuse = this.time.addEvent({ delay: 140, loop: true, callback: () => obj.setTexture(obj.texture.key === 'bomb' ? 'bomb-flash' : 'bomb') });
      obj.once('destroy', () => fuse.remove());
      this.flyers.push({ obj, vx, vy, spin: spin * 0.5, kind: 'bomb' });
    } else {
      const type = Phaser.Utils.Array.GetRandom(this.donutTypes);
      const obj = this.add.image(x, y, type.key).setScale(0.55 * u).setDepth(30);
      this.flyers.push({ obj, vx, vy, spin, kind: 'donut', type });
    }
    playSfx(this, SFX, 'whoosh', { volume: 0.25 });
  }

  // ---- Slicing ----------------------------------------------------------------------------

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (!pointer.isDown) return;
    const now = this.time.now;
    const prev = this.points.at(-1) ?? { x: pointer.x, y: pointer.y, t: now };
    this.points.push({ x: pointer.x, y: pointer.y, t: now });

    const speed = Phaser.Math.Distance.Between(prev.x, prev.y, pointer.x, pointer.y) / Math.max(1, now - prev.t);
    if (speed > 1.5 * this.u && now - this.lastWhoosh > 280) {
      this.lastWhoosh = now;
      playSfx(this, SFX, 'whoosh', { volume: 0.3 });
    }

    const line = new Phaser.Geom.Line(prev.x, prev.y, pointer.x, pointer.y);
    const angle = Phaser.Geom.Line.Angle(line);
    for (const f of [...this.flyers]) {
      if (f.kind === 'half') continue;
      const radius = (f.kind === 'bomb' ? 50 : DONUT_SIZE * 0.42) * Math.abs(f.obj.scaleX);
      if (Phaser.Geom.Intersects.LineToCircle(line, new Phaser.Geom.Circle(f.obj.x, f.obj.y, radius))) this.slice(f, angle);
    }
  }

  private slice(f: Flyer, angle: number) {
    if (f.kind === 'bomb') return this.explode(f);
    const { x, y } = f.obj;
    this.splitDonut(f, angle);
    this.splat(x, y, f.type!.color);
    this.removeFlyer(f);
    playSfx(this, SFX, 'slice', { volume: 0.5 });
    playSfx(this, SFX, 'splat', { volume: 0.6 });

    if (f.kind === 'button') {
      this.time.delayedCall(250, () => this.startRound());
      return;
    }
    if (this.state !== 'playing') return;
    this.score++;
    this.scoreText.setText(`${this.score}`);
    this.tweens.add({ targets: this.scoreText, scale: 1.15, duration: 70, yoyo: true });
    this.strokeHits = { count: this.strokeHits.count + 1, x, y, at: this.time.now };
  }

  /** Two cropped copies of the donut, rotated so the cut runs along the swipe, flung apart. */
  private splitDonut(f: Flyer, angle: number) {
    const u = this.u;
    const rotation = angle - Math.PI / 2;
    const half = DONUT_SIZE / 2;
    for (const side of [-1, 1]) {
      const obj = this.add
        .image(f.obj.x, f.obj.y, f.obj.texture.key)
        .setScale(f.obj.scaleX)
        .setRotation(rotation)
        .setDepth(29)
        .setCrop(side < 0 ? 0 : half, 0, half, DONUT_SIZE);
      const push = 220 * u;
      this.flyers.push({
        obj,
        vx: f.vx * 0.5 + side * Math.cos(rotation) * push,
        vy: Math.min(f.vy, 0) * 0.4 + side * Math.sin(rotation) * push - 150 * u,
        spin: side * Phaser.Math.FloatBetween(2, 5),
        kind: 'half',
      });
    }
  }

  /** A splat pops up, then gets painted permanently into the background. */
  private splat(x: number, y: number, color: number) {
    const u = this.u;
    const key = `splat${String(Phaser.Math.Between(0, SPLAT_COUNT - 1)).padStart(2, '0')}`;
    const rotation = Math.random() * Math.PI * 2;
    const scale = Phaser.Math.FloatBetween(0.55, 1.1) * u;
    const blob = this.add.image(x, y, key).setTint(color).setRotation(rotation).setScale(scale * 0.3).setDepth(10).setAlpha(0.9);
    this.tweens.add({
      targets: blob,
      scale,
      duration: 120,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.paint.stamp(key, undefined, x, y, { tint: color, rotation, scale, alpha: 0.9 });
        this.paint.render();
        blob.destroy();
      },
    });
    this.drops.setParticleTint(color);
    this.drops.setParticleScale(0.08 * u, 0);
    this.drops.explode(14, x, y);
  }

  private explode(f: Flyer) {
    const { x, y } = f.obj;
    this.removeFlyer(f);
    const boom = this.add.sprite(x, y, 'boom').setScale(1.4 * this.u).setDepth(40).play('boom');
    boom.once('animationcomplete', () => boom.destroy());
    playSfx(this, SFX, 'boom', { volume: 0.8 });
    this.cameras.main.shake(450, 0.02);
    this.cameras.main.flash(250, 255, 240, 220);
    this.paint.stamp('splat07', undefined, x, y, { tint: 0x222222, scale: 1.4 * this.u, alpha: 0.6 });
    this.paint.render();
    this.lives = 0;
    this.lifeIcons.forEach((i) => i.setTint(0x222222).setAlpha(0.35));
    this.gameOver();
  }

  private endStroke() {
    if (this.strokeHits.count >= 3 && this.state === 'playing') {
      const { count, x, y } = this.strokeHits;
      this.score += count;
      this.scoreText.setText(`${this.score}`);
      playSfx(this, SFX, 'combo', { volume: 0.6 });
      const label = this.add
        .text(x, y, `${count} donut combo\n+${count}`, { ...TEXT, fontSize: `${Math.round(34 * this.u)}px`, color: '#ffd35c' })
        .setOrigin(0.5)
        .setDepth(65);
      this.tweens.add({ targets: label, y: y - 80 * this.u, alpha: 0, delay: 500, duration: 600, onComplete: () => label.destroy() });
    }
    this.strokeHits.count = 0;
  }

  private loseLife(x: number) {
    if (this.state !== 'playing') return;
    this.lives--;
    playSfx(this, SFX, 'miss', { volume: 0.5 });
    const icon = this.lifeIcons[LIVES - 1 - this.lives];
    icon?.setTint(0x222222).setAlpha(0.35);
    if (icon) this.tweens.add({ targets: icon, scale: icon.scale * 1.5, duration: 120, yoyo: true });
    const cross = this.add
      .image(Phaser.Math.Clamp(x, 40, this.scale.width - 40), this.scale.height - 50 * this.u, ICONS, 'cross.png')
      .setScale(0.6 * this.u)
      .setTint(0xff5a6e)
      .setDepth(65);
    this.tweens.add({ targets: cross, alpha: 0, y: cross.y - 40, delay: 400, duration: 500, onComplete: () => cross.destroy() });
    if (this.lives <= 0) this.gameOver();
  }

  private removeFlyer(f: Flyer, destroy = true) {
    this.flyers = this.flyers.filter((x) => x !== f);
    if (destroy) f.obj.destroy();
  }

  private clearPaint() {
    this.paint.fill(BG);
    this.paint.render();
  }

  private saveArt() {
    this.paint.snapshotArea(0, 0, this.scale.width, this.scale.height, (image) => {
      if (!(image instanceof HTMLImageElement)) return;
      const a = document.createElement('a');
      a.href = image.src;
      a.download = 'donut-splat-art.png';
      a.click();
      playSfx(this, SFX, 'combo');
    });
  }

  // ---- Frame loop -------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 30);
    const g = 1500 * this.u;

    if (this.state === 'playing') {
      this.elapsed += dt;
      this.untilWave -= dt;
      if (this.untilWave <= 0) this.wave();
    }

    for (const f of [...this.flyers]) {
      if (f.kind === 'button') {
        f.obj.y += Math.sin(time / 400) * 0.3;
        f.obj.rotation += f.spin * dt;
        continue;
      }
      f.vy += g * dt;
      f.obj.x += f.vx * dt;
      f.obj.y += f.vy * dt;
      f.obj.rotation += f.spin * dt;
      if (f.vy > 0 && f.obj.y > this.scale.height + 120 * this.u) {
        const x = f.obj.x;
        this.removeFlyer(f);
        if (f.kind === 'donut') this.loseLife(x);
      }
    }

    // Combos count slices within one quick stroke, even if the pointer stays down.
    if (this.strokeHits.count && time - this.strokeHits.at > 250) this.endStroke();

    this.drawTrail(time);
  }

  private drawTrail(now: number) {
    this.points = this.points.filter((p) => now - p.t < TRAIL_MS);
    this.trail.clear();
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      const life = 1 - (now - b.t) / TRAIL_MS;
      this.trail.lineStyle(14 * life * this.u + 1, 0xffffff, 0.85 * life);
      this.trail.lineBetween(a.x, a.y, b.x, b.y);
    }
  }
}
