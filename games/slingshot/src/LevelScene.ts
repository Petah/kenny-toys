import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { ROCK_FRAMES, SFX, type Voice } from './assets';
import { LEVELS } from './levels';
import { loadProgress, recordClear } from './progress';
import { DOCK_R, DT, fly, launch, launchVelocity, placeAt, step, type Flight, type Level, type Point } from './sim';
import { FOOT_H, GOLD, TEXT, button, dimStar, drawSpace, hudHeight, starRow } from './ui';

type State = 'aim' | 'flying' | 'over' | 'won';

/** How far a drag pulls back for a full-strength launch, in screen pixels. */
const PULL_MAX = 170;
/** A shorter drag than this lets go without launching. */
const PULL_MIN = 18;
/** Keyboard aiming: radians and stretch a second. */
const TURN_RATE = 0.9;
const POWER_RATE = 0.6;
/** The pack's planets fill this much of their square image. */
const PLANET_FILL = 0.94;
const PROBE_SCALE = 0.42;
/** Steps between the dots of the aiming preview. */
const DOT_STEPS = 12;
/** A flight can be called off by tapping once it's been going this long, in seconds. */
const ABORT_AFTER = 0.4;

const TIPS: Record<number, [string, string]> = {
  // [desktop, touch]
  0: ['Drag back and let go to launch. Or aim with the arrow keys and press space.', 'Drag back and let go to launch'],
  1: ['Planets pull the probe towards them', 'Planets pull the probe towards them'],
  2: ['Swing right round a planet to turn back', 'Swing right round a planet to turn back'],
};

interface Body {
  def: Point & { orbit?: Level['station']['orbit'] };
  parts: Phaser.GameObjects.Image[];
}

export class LevelScene extends Phaser.Scene {
  private levelIndex = 0;
  private level!: Level;
  private portrait = false;
  private origin = { x: 0, y: 0 };
  private hudH = 0;
  private state: State = 'aim';
  /** Seconds since the level started, advanced in whole sim steps. */
  private clock = 0;
  private acc = 0;
  /** Aim in level space: angle in radians and stretch from 0 to 1. */
  private aim = { angle: 0, power: 0.5 };
  private drag?: { x: number; y: number };
  private flight?: Flight;
  private trail: Point[] = [];
  private ghost: Point[] = [];
  private shots = 0;
  private collected = 0;

  private movers: Body[] = [];
  private probe!: Phaser.GameObjects.Image;
  private station!: Phaser.GameObjects.Image;
  private dockRing!: Phaser.GameObjects.Graphics;
  private stars: Phaser.GameObjects.Image[] = [];
  private starIcons: Phaser.GameObjects.Image[] = [];
  private aimGfx!: Phaser.GameObjects.Graphics;
  private pathGfx!: Phaser.GameObjects.Graphics;
  private offscreen!: Phaser.GameObjects.Graphics;
  private shotsText!: Phaser.GameObjects.Text;
  private tip?: Phaser.GameObjects.Text;
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private keys: Record<'left' | 'right' | 'up' | 'down', Phaser.Input.Keyboard.Key[]> = { left: [], right: [], up: [], down: [] };
  private lastTick = 0;

  constructor() {
    super('level');
  }

  init(data: { level?: number }) {
    this.levelIndex = Phaser.Math.Clamp(data.level ?? 0, 0, LEVELS.length - 1);
    this.level = LEVELS[this.levelIndex];
    this.portrait = this.scale.height > this.scale.width;
    this.hudH = hudHeight(this.portrait);
    this.origin = { x: 0, y: this.hudH };
    this.state = 'aim';
    this.clock = 0;
    this.acc = 0;
    const { start, station } = this.level;
    this.aim = { angle: Math.atan2(station.y - start.y, station.x - start.x), power: 0.5 };
    this.drag = undefined;
    this.flight = undefined;
    this.trail = [];
    this.ghost = [];
    this.shots = 0;
    this.collected = 0;
    this.movers = [];
    this.stars = [];
    this.starIcons = [];
    this.tip = undefined;
  }

  create() {
    this.cameras.main.setBackgroundColor(0x3a2e3f).fadeIn(180, 58, 46, 63);
    drawSpace(this, `level${this.levelIndex}`);
    this.pathGfx = this.add.graphics().setDepth(2);
    this.buildBodies();
    this.buildProbe();
    this.aimGfx = this.add.graphics().setDepth(5);
    this.offscreen = this.add.graphics().setDepth(45);
    this.buildHud();

    const kb = this.input.keyboard!;
    const k = (...names: string[]) => names.map((n) => kb.addKey(n));
    this.keys = { left: k('LEFT', 'A'), right: k('RIGHT', 'D'), up: k('UP', 'W'), down: k('DOWN', 'S') };
    kb.on('keydown-SPACE', () => (this.state === 'aim' ? this.fire() : this.abort()));
    kb.on('keydown-R', () => this.restart());
    kb.on('keydown-ESC', () => this.toMenu());
    kb.on('keydown-ENTER', () => this.state === 'won' && this.next());

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.state === 'aim') this.drag = { x: p.x, y: p.y };
      else this.abort();
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.drag && this.pullTo(p.x, p.y));
    this.input.on('pointerup', () => this.release());
    this.input.on('pointerupoutside', () => this.release());

    const music = this.sound.get('music') ?? this.sound.add('music', { loop: true, volume: 0.25 });
    if (!music.isPlaying) music.play();
    this.intro();
  }

  // ---- Layout ------------------------------------------------------------------------------------

  /** Level space to screen. Portrait mirrors the field on its diagonal. */
  private view(p: Point): Point {
    return this.portrait ? { x: this.origin.x + p.y, y: this.origin.y + p.x } : { x: this.origin.x + p.x, y: this.origin.y + p.y };
  }

  /** A direction on screen as one in level space; the mirror is its own inverse. */
  private flip(x: number, y: number): Point {
    return this.portrait ? { x: y, y: x } : { x, y };
  }

  private buildBodies() {
    const { level } = this;
    for (const p of level.planets) {
      const at = this.view(placeAt(p, 0));
      const reach = p.r * 2 * 2.6 * Math.sqrt(p.mass ?? 1);
      const glow = this.add.image(at.x, at.y, 'glow').setDisplaySize(reach, reach).setTint(0x9f8cff).setAlpha(0.22).setDepth(1);
      const img = this.add.image(at.x, at.y, `planet:${p.skin}`).setDisplaySize((p.r * 2) / PLANET_FILL, (p.r * 2) / PLANET_FILL).setDepth(3);
      this.movers.push({ def: p, parts: [glow, img] });
    }
    level.rocks.forEach((r, i) => {
      const at = this.view(placeAt(r, 0));
      const img = this.add.image(at.x, at.y, ROCK_FRAMES[i % ROCK_FRAMES.length]).setDepth(3);
      // The meteors are a little lumpy; size them so the body's circle sits just inside.
      img.setScale((r.r * 2.25) / Math.max(img.width, img.height)).setAngle(i * 67);
      this.tweens.add({ targets: img, angle: img.angle + (i % 2 ? 360 : -360), duration: 9000 + (i % 4) * 2500, repeat: -1 });
      this.movers.push({ def: r, parts: [img] });
    });

    const st = this.view(placeAt(level.station, 0));
    const beacon = this.add.image(st.x, st.y, 'glow').setDisplaySize(DOCK_R * 4, DOCK_R * 4).setTint(0x5dffa0).setAlpha(0.3).setDepth(3);
    this.tweens.add({ targets: beacon, alpha: 0.12, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.station = this.add.image(st.x, st.y, 'station').setScale(0.5).setDepth(4);
    if (!this.portrait) this.station.setAngle(90);
    this.dockRing = this.add.graphics().setDepth(4);
    this.movers.push({ def: level.station, parts: [beacon, this.station] });

    this.stars = level.stars.map((s) => {
      const at = this.view(s);
      const img = this.add.image(at.x, at.y, 'star').setScale(1.3).setDepth(4);
      this.tweens.add({ targets: img, angle: { from: -12, to: 12 }, scale: 1.45, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.easeInOut' });
      return img;
    });

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

  private buildProbe() {
    const at = this.view(this.level.start);
    // A dashed ring marks the launch spot. It's drawn round (0, 0) so it turns about its centre.
    const pad = this.add.graphics({ x: at.x, y: at.y }).setDepth(2);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pad.lineStyle(3, 0xffffff, 0.35).beginPath().arc(0, 0, 30, a, a + Math.PI / 16).strokePath();
    }
    this.tweens.add({ targets: pad, angle: 360, duration: 12000, repeat: -1 });
    this.probe = this.add.image(at.x, at.y, 'probe').setScale(PROBE_SCALE).setDepth(6);
  }

  private buildHud() {
    const { width, height } = this.scale;
    this.add.text(width / 2, this.hudH - 36, `${this.levelIndex + 1}. ${this.level.name}`, { ...TEXT, fontSize: '38px', strokeThickness: 9 }).setOrigin(0.5).setDepth(50);

    const footY = height - FOOT_H / 2;
    const pad = 24;
    this.starIcons = [0, 1, 2].map((i) => dimStar(this.add.image(pad + 26 + i * 46, footY, 'star').setScale(1.2).setDepth(50)));
    // A small label over a big count, narrow enough to clear the buttons on a portrait screen.
    this.add.text(width - pad, footY - 26, 'LAUNCHES', { ...TEXT, fontSize: '16px', strokeThickness: 4 }).setOrigin(1, 0.5).setDepth(50);
    this.shotsText = this.add.text(width - pad, footY + 14, '0', { ...TEXT, fontSize: '36px', strokeThickness: 8 }).setOrigin(1, 0.5).setDepth(50);
    const best = loadProgress().best[this.levelIndex];
    if (best) {
      this.add
        .text(width - pad - 64, footY + 16, `best ${best}`, { ...TEXT, fontSize: '18px', strokeThickness: 4, color: GOLD })
        .setOrigin(1, 0.5)
        .setDepth(50);
    }
    button(this, 'restart', () => this.restart(), { icon: 'return.png', w: 76, h: 60, size: 34 }).setPosition(width / 2 - 46, footY).setDepth(50);
    button(this, 'menu', () => this.toMenu(), { icon: 'menuList.png', w: 76, h: 60, size: 30 }).setPosition(width / 2 + 46, footY).setDepth(50);

    const tip = TIPS[this.levelIndex];
    if (tip) {
      const touch = this.sys.game.device.input.touch;
      this.tip = this.add
        .text(width / 2, this.hudH + 40, tip[touch ? 1 : 0], { ...TEXT, fontSize: '24px', strokeThickness: 6, color: GOLD, wordWrap: { width: width - 60 } })
        .setOrigin(0.5, 0)
        .setDepth(50);
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

  // ---- Aiming ------------------------------------------------------------------------------------

  /** Sets the aim from a drag: pulling back launches the other way, harder the further it goes. */
  private pullTo(x: number, y: number) {
    const dx = this.drag!.x - x;
    const dy = this.drag!.y - y;
    const len = Math.hypot(dx, dy);
    if (len < PULL_MIN) return;
    const dir = this.flip(dx, dy);
    const power = Math.min(1, (len - PULL_MIN) / (PULL_MAX - PULL_MIN));
    // A tick now and then while stretching, rising in pitch.
    if (Math.abs(power - this.aim.power) > 0.08 && this.time.now - this.lastTick > 50) {
      this.lastTick = this.time.now;
      playSfx(this, SFX, 'tick', { volume: 0.25, detune: power * 900 - 300 });
    }
    this.aim = { angle: Math.atan2(dir.y, dir.x), power };
  }

  private release() {
    const drag = this.drag;
    this.drag = undefined;
    if (!drag || this.state !== 'aim') return;
    const p = this.input.activePointer;
    if (Math.hypot(p.x - drag.x, p.y - drag.y) >= PULL_MIN) this.fire();
  }

  private keyAim(dt: number) {
    const down = (keys: Phaser.Input.Keyboard.Key[]) => keys.some((key) => key.isDown);
    const turn = (down(this.keys.right) ? 1 : 0) - (down(this.keys.left) ? 1 : 0);
    const push = (down(this.keys.up) ? 1 : 0) - (down(this.keys.down) ? 1 : 0);
    if (!turn && !push) return;
    // Turn on screen, so right is always clockwise whichever way round the field is.
    const screen = this.flip(Math.cos(this.aim.angle), Math.sin(this.aim.angle));
    const a = Math.atan2(screen.y, screen.x) + turn * TURN_RATE * dt;
    const level = this.flip(Math.cos(a), Math.sin(a));
    this.aim = { angle: Math.atan2(level.y, level.x), power: Phaser.Math.Clamp(this.aim.power + push * POWER_RATE * dt, 0, 1) };
  }

  /** The stretched band behind the probe and the dotted start of its path. */
  private drawAim() {
    const g = this.aimGfx.clear();
    if (this.state !== 'aim') return;
    const at = this.view(this.level.start);
    const dir = this.flip(Math.cos(this.aim.angle), Math.sin(this.aim.angle));
    const back = 24 + this.aim.power * 70;
    const tail = { x: at.x - dir.x * back, y: at.y - dir.y * back };
    const side = { x: -dir.y * 16, y: dir.x * 16 };
    g.lineStyle(4, 0xffd54a, 0.85).beginPath();
    g.moveTo(at.x + side.x, at.y + side.y).lineTo(tail.x, tail.y).lineTo(at.x - side.x, at.y - side.y).strokePath();
    g.fillStyle(0xffd54a).fillCircle(tail.x, tail.y, 7);

    const v = launchVelocity(this.aim.angle, this.aim.power);
    const { flight, path } = fly(this.level, this.clock, v.x, v.y, this.level.preview, DOT_STEPS);
    path.forEach((p, i) => {
      if (i === 0) return;
      const s = this.view(p);
      const fade = 1 - i / (path.length + 1);
      g.fillStyle(0xffffff, 0.85 * fade).fillCircle(s.x, s.y, 3.5 + fade * 1.5);
    });
    if (flight.outcome === 'crashed' || flight.outcome === 'docked') {
      const s = this.view(flight);
      g.lineStyle(3, flight.outcome === 'docked' ? 0x5dffa0 : 0xff6b6b, 0.9).strokeCircle(s.x, s.y, 9);
    }
    this.probe.setRotation(Math.atan2(dir.y, dir.x) + Math.PI / 2);
  }

  // ---- Flight ------------------------------------------------------------------------------------

  private fire() {
    if (this.state !== 'aim') return;
    const v = launchVelocity(this.aim.angle, this.aim.power);
    this.flight = launch(this.level, this.clock, v.x, v.y);
    this.trail = [{ ...this.level.start }];
    this.state = 'flying';
    this.shots++;
    this.shotsText.setText(String(this.shots));
    playSfx(this, SFX, 'launch', { volume: 0.35 + this.aim.power * 0.25 });
    if (this.tip) {
      const tip = this.tip;
      this.tip = undefined;
      this.tweens.add({ targets: tip, alpha: 0, duration: 400, onComplete: () => tip.destroy() });
    }
  }

  /** Calls off a flight that's clearly going nowhere. */
  private abort() {
    const f = this.flight;
    if (this.state !== 'flying' || !f || f.t < ABORT_AFTER) return;
    f.outcome = 'lost';
    this.endFlight(f, true);
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta, 100) / 1000;
    if (this.state === 'aim') this.keyAim(dt);
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.clock += DT;
      const f = this.flight;
      if (this.state !== 'flying' || !f) continue;
      step(this.level, f);
      if (Math.round(f.t / DT) % 3 === 0) this.trail.push({ x: f.x, y: f.y });
      this.checkStars(f);
      if (f.outcome !== 'flying') this.endFlight(f, false);
    }
    this.placeMovers();
    this.drawProbe();
    this.drawPaths();
    this.drawAim();
  }

  private placeMovers() {
    for (const { def, parts } of this.movers) {
      if (!def.orbit) continue;
      const at = this.view(placeAt(def, this.clock));
      for (const part of parts) part.setPosition(at.x, at.y);
    }
    const st = this.view(placeAt(this.level.station, this.clock));
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 4);
    this.dockRing.clear().lineStyle(3, 0x5dffa0, 0.35 + pulse * 0.35).strokeCircle(st.x, st.y, DOCK_R - 4 + pulse * 4);
  }

  private drawProbe() {
    const f = this.flight;
    this.offscreen.clear();
    if (this.state !== 'flying' || !f) return;
    const at = this.view(f);
    const vel = this.flip(f.vx, f.vy);
    this.probe.setPosition(at.x, at.y).setRotation(Math.atan2(vel.y, vel.x) + Math.PI / 2);
    // When it strays off screen, an arrow at the edge shows where it went.
    const { width, height } = this.scale;
    const m = 22;
    if (at.x >= 0 && at.x <= width && at.y >= 0 && at.y <= height) return;
    const ex = Phaser.Math.Clamp(at.x, m, width - m);
    const ey = Phaser.Math.Clamp(at.y, m, height - m);
    const a = Math.atan2(at.y - ey, at.x - ex);
    const tri = [0, 2.4, -2.4].map((o) => ({ x: ex + Math.cos(a + o) * 14, y: ey + Math.sin(a + o) * 14 }));
    this.offscreen.fillStyle(0xffd54a, 0.9).fillTriangle(tri[0].x, tri[0].y, tri[1].x, tri[1].y, tri[2].x, tri[2].y);
  }

  /** The current flight's trail, and the last one's fainter behind it. */
  private drawPaths() {
    const g = this.pathGfx.clear();
    const line = (pts: Point[], width: number, colour: number, alpha: number) => {
      if (pts.length < 2) return;
      g.lineStyle(width, colour, alpha).beginPath();
      pts.forEach((p, i) => {
        const s = this.view(p);
        if (i === 0) g.moveTo(s.x, s.y);
        else g.lineTo(s.x, s.y);
      });
      g.strokePath();
    };
    line(this.ghost, 2, 0xffffff, 0.18);
    if (this.state === 'flying' || this.state === 'over') line(this.trail, 3, 0xffd54a, 0.55);
  }

  private checkStars(f: Flight) {
    while (this.collected < f.stars.length) {
      const i = f.stars[this.collected++];
      const star = this.stars[i];
      playSfx(this, SFX, 'star', { volume: 0.4, detune: this.collected * 150 });
      this.sparkles.emitParticleAt(star.x, star.y, 12);
      this.tweens.killTweensOf(star);
      this.tweens.add({ targets: star, scale: 2.4, alpha: 0, duration: 300, onComplete: () => star.setVisible(false) });
      const icon = this.starIcons[this.collected - 1].clearTint().setAlpha(1);
      this.tweens.add({ targets: icon, scale: { from: 2.2, to: 1.2 }, duration: 300, ease: 'Back.easeOut' });
    }
  }

  private endFlight(f: Flight, aborted: boolean) {
    this.ghost = this.trail.concat([{ x: f.x, y: f.y }]);
    if (f.outcome === 'docked') {
      this.win(f);
      return;
    }
    this.state = 'over';
    const at = this.view(f);
    if (f.outcome === 'crashed') {
      this.probe.setVisible(false);
      const boom = this.add.sprite(at.x, at.y, 'boom').setScale(0.55).setDepth(7);
      boom.play('boom');
      boom.once('animationcomplete', () => boom.destroy());
      playSfx(this, SFX, 'boom', { volume: 0.5 });
      this.cameras.main.shake(180, 0.006);
    } else if (!aborted) {
      playSfx(this, SFX, 'lost', { volume: 0.4 });
      const text = this.add
        .text(this.scale.width / 2, this.hudH + 60, f.outcome === 'stuck' ? 'LOST IN ORBIT' : 'LOST IN SPACE', { ...TEXT, fontSize: '40px', strokeThickness: 9, color: '#ff9b9b' })
        .setOrigin(0.5)
        .setDepth(60);
      this.tweens.add({ targets: text, alpha: 0, y: text.y - 20, delay: 700, duration: 400, onComplete: () => text.destroy() });
    }
    this.time.delayedCall(aborted ? 150 : f.outcome === 'crashed' ? 900 : 800, () => this.respawn());
  }

  private respawn() {
    const at = this.view(this.level.start);
    this.flight = undefined;
    this.trail = [];
    this.tweens.killTweensOf(this.probe);
    this.probe.setVisible(true).setPosition(at.x, at.y).setScale(0);
    this.tweens.add({ targets: this.probe, scale: PROBE_SCALE, duration: 250, ease: 'Back.easeOut' });
    playSfx(this, SFX, 'respawn', { volume: 0.25 });
    // Stars come back for the next try: only the ones picked up on the docking flight count.
    this.collected = 0;
    this.starIcons.forEach(dimStar);
    this.stars.forEach((star) => {
      if (star.visible && star.alpha === 1) return;
      this.tweens.killTweensOf(star);
      star.setVisible(true).setAlpha(1).setScale(0).setAngle(0);
      this.tweens.chain({
        targets: star,
        tweens: [
          { scale: 1.3, duration: 250, ease: 'Back.easeOut' },
          { angle: { from: -12, to: 12 }, scale: 1.45, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.easeInOut' },
        ],
      });
    });
    this.state = 'aim';
  }

  // ---- Winning -----------------------------------------------------------------------------------

  private win(f: Flight) {
    this.state = 'won';
    const st = this.view(placeAt(this.level.station, this.clock));
    playSfx(this, SFX, 'dock', { volume: 0.5 });
    this.tweens.add({ targets: this.probe, x: st.x, y: st.y, scale: 0, duration: 450, ease: 'Quad.easeIn' });
    this.sparkles.emitParticleAt(st.x, st.y, 20);

    const last = this.levelIndex === LEVELS.length - 1;
    const stars = f.stars.length;
    const record = recordClear(this.levelIndex, this.shots, stars);
    this.sound.play(last ? 'jingle:finale' : 'jingle:win', { volume: 0.5 });
    this.time.delayedCall(500, () => this.voice(last ? 'congratulations' : record.isNew ? 'new_highscore' : 'mission_completed'));
    this.time.delayedCall(900, () => this.showPanel(stars, record.best, record.isNew, last));
  }

  private showPanel(stars: number, best: number, isNew: boolean, last: boolean) {
    const { width, height } = this.scale;
    const w = Math.min(620, width - 40);
    const h = 440;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.28).fillRoundedRect(-w / 2, -h / 2 + 10, w, h, 30);
    g.fillStyle(0x4a3d99).fillRoundedRect(-w / 2, -h / 2, w, h, 30);
    g.lineStyle(6, 0xffffff, 0.4).strokeRoundedRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16, 24);
    const heading = this.add.text(0, -h / 2 + 64, last ? 'ALL DONE!' : 'DOCKED!', { ...TEXT, fontSize: '56px', strokeThickness: 11 }).setOrigin(0.5);

    const row = starRow(this, stars, 2.2, 100);
    row.forEach((star, i) => {
      const scale = star.scale;
      star.setScale(0);
      this.tweens.add({
        targets: star,
        scale,
        duration: 320,
        delay: 350 + i * 300,
        ease: 'Back.easeOut',
        onStart: () => i < stars && playSfx(this, SFX, 'star', { volume: 0.4, detune: i * 200 }),
      });
    });
    const starsC = this.add.container(0, -h / 2 + 160, row);
    const count = this.add
      .text(0, -h / 2 + 248, this.shots === 1 ? '1 launch' : `${this.shots} launches`, { ...TEXT, fontSize: '46px', strokeThickness: 9 })
      .setOrigin(0.5);
    const bestText = this.add
      .text(0, -h / 2 + 296, isNew ? 'New best!' : `best ${best}`, { ...TEXT, fontSize: '24px', strokeThickness: 6, color: GOLD })
      .setOrigin(0.5);
    const retry = button(this, 'RETRY', () => this.restart(), { w: 200, h: 72, size: 30, color: 0x7a8a94 }).setPosition(-115, h / 2 - 64);
    const next = button(this, last ? 'MENU' : 'NEXT', () => this.next(), { w: 200, h: 72, size: 30, color: 0x2ecc71 }).setPosition(115, h / 2 - 64);

    const shade = this.add.rectangle(0, 0, width * 2, height * 2, 0x140e26, 0.5);
    const panel = this.add.container(width / 2, height / 2, [shade, g, heading, starsC, count, bestText, retry, next]).setDepth(80).setAlpha(0);
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

