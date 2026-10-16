import * as Phaser from 'phaser';
import { FONT_BODY, FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { load, save } from '@shared/storage';
import { fitCard, makeButton } from '@shared/ui';
import { SFX, SHEET, preloadAssets } from './assets';
import {
  BAR, HALF_GOAL, SPOT, ballAt, cpuKick, flightOf, judge, keeperGuess, stepKeeper, wobble,
  type Flight, type Keeper, type Kick, type Result,
} from './shot';

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = { fontFamily: FONT_HEADING, color: '#ffffff', stroke: '#1d4a26', strokeThickness: 8, align: 'center' };

/** The teams to beat, one after another, each a little better. */
const TEAMS = [
  { name: 'Reds', sheet: 'Red', skill: 0.2, colour: '#e8603a' },
  { name: 'Greens', sheet: 'Green', skill: 0.45, colour: '#4cc06a' },
  { name: 'Whites', sheet: 'White', skill: 0.65, colour: '#f2f2f2' },
  { name: 'Golds', sheet: 'Special', skill: 0.85, colour: '#ffd23f' },
];
const KICKS = 5;

type State = 'title' | 'aim' | 'runup' | 'flight' | 'result' | 'keep' | 'over';

interface Person {
  box: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  armL: Phaser.GameObjects.Image;
  armR: Phaser.GameObjects.Image;
}

export class KickScene extends Phaser.Scene {
  private state: State = 'title';
  /** Pixels per metre, and where the goal line's middle is on screen. */
  private k = 20;
  private gx = 0;
  private gy = 0;
  private pitch!: Phaser.GameObjects.Graphics;
  private net!: Phaser.GameObjects.Graphics;
  private aimG!: Phaser.GameObjects.Graphics;
  private shadow!: Phaser.GameObjects.Ellipse;
  private ball!: Phaser.GameObjects.Image;
  private kicker!: Person;
  private keeper!: Person;
  private hud!: Phaser.GameObjects.Container;
  private banner?: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;

  private team = 0;
  private wins = 0;
  private best = 0;
  private mine: (boolean | undefined)[] = [];
  private theirs: (boolean | undefined)[] = [];
  /** True while the player is the one kicking. */
  private shooting = true;
  private kick?: Kick;
  private flight?: Flight;
  private keep: Keeper = { x: 0, target: 0, wait: 0, diving: false };
  private t = 0;
  private wait = 0;
  private result?: Result;
  private drag?: { x: number; y: number };
  private aim = { x: 0, power: 0.5 };
  private ripple = 0;
  private rippleX = 0;
  private bounce?: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  private chosen = false;
  private music?: Phaser.Sound.BaseSound;
  private keys?: Record<'left' | 'right' | 'up' | 'down' | 'space', Phaser.Input.Keyboard.Key>;

  constructor() {
    super('kick');
  }

  preload() {
    preloadAssets(this);
  }

  create() {
    this.pitch = this.add.graphics();
    this.net = this.add.graphics();
    this.aimG = this.add.graphics().setDepth(4);
    this.shadow = this.add.ellipse(0, 0, 10, 6, 0x000000, 0.25).setDepth(2);
    this.kicker = this.makePerson('Blue', 1);
    this.keeper = this.makePerson('Special', 1);
    this.ball = this.add.image(0, 0, SHEET, 'ball_soccer1.png').setDepth(6);
    this.hud = this.add.container(0, 0).setDepth(20);
    this.best = load('spot-kick:best', 0);
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('LEFT,RIGHT,UP,DOWN,SPACE');
      this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN', space: 'SPACE' }) as typeof this.keys;
      kb.on('keydown-SPACE', () => this.keySpace());
      kb.on('keydown-ENTER', () => (this.state === 'title' || this.state === 'over') && this.startRun());
      kb.on('keydown-LEFT', () => this.keyDive(-1));
      kb.on('keydown-RIGHT', () => this.keyDive(1));
      kb.on('keydown-DOWN', () => this.keyDive(0));
    }
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.down(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveDrag(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.up(p));
    this.scale.on('resize', () => this.layout());
    this.layout();
    this.showTitle();
  }

  // ---- Layout and drawing ------------------------------------------------------------------

  private layout() {
    const { width: w, height: h } = this.scale;
    // From two metres behind the goal to a few past the spot.
    // Wide screens show the whole box; tall ones crop the sides to make the goal bigger.
    const top = w < 560 ? 112 : 70;
    this.k = Math.min(w / (w < h ? 15 : 22), (h - top - 10) / 17);
    this.gx = w / 2;
    this.gy = top + Math.max(2.5 * this.k, (h - top - 17 * this.k) / 2 + 2.5 * this.k);
    this.drawPitch();
    const s = (this.k * 1.3) / 31;
    for (const p of [this.kicker, this.keeper]) p.box.setScale(s);
    this.ball.setScale((this.k * 0.6) / 18);
    this.shadow.setSize(this.k * 0.6, this.k * 0.35);
    this.drawHud();
    this.rebuildOverlay?.();
    if (this.state === 'aim') this.placeForKick();
  }

  /** Screen position of a pitch point (metres), lifted by height `z`. */
  private sp(x: number, y: number, z = 0) {
    return { x: this.gx + x * this.k, y: this.gy + y * this.k - z * this.k * 0.55 };
  }

  private drawPitch() {
    const g = this.pitch.clear();
    const { width: w, height: h } = this.scale;
    // Mown stripes across the pitch.
    const stripe = 2 * this.k;
    for (let y = this.gy - 6 * this.k, i = 0; y < h; y += stripe, i++) {
      g.fillStyle(i % 2 ? 0x4fb35a : 0x46a751, 1).fillRect(0, y, w, stripe + 1);
    }
    const line = Math.max(2, this.k * 0.12);
    g.lineStyle(line, 0xffffff, 0.95);
    const p = (x: number, y: number) => this.sp(x, y);
    const rect = (x0: number, y0: number, x1: number, y1: number) => {
      const a = p(x0, y0);
      const b = p(x1, y1);
      g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    };
    g.lineBetween(0, this.gy, w, this.gy);
    rect(-9.16, 0, 9.16, 5.5);
    rect(-20.16, 0, 20.16, 16.5);
    // The arc at the top of the box, and the spot.
    const spot = p(0, SPOT);
    g.beginPath();
    const r = 9.15 * this.k;
    const a0 = Math.asin((16.5 - SPOT) / 9.15);
    g.arc(spot.x, spot.y, r, a0, Math.PI - a0, false);
    g.strokePath();
    g.fillStyle(0xffffff, 1).fillCircle(spot.x, spot.y, this.k * 0.16);
    this.drawNet();
  }

  /** The goal from above: a net behind the line, white posts, and the bar along the line. */
  private drawNet() {
    const g = this.net.clear();
    const a = this.sp(-HALF_GOAL, -2);
    const b = this.sp(HALF_GOAL, 0);
    g.fillStyle(0x2f6b38, 0.55).fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    g.lineStyle(1, 0xffffff, 0.55);
    const step = this.k * 0.3;
    // A ripple pushes the mesh back where the ball went in.
    const bulge = (x: number) => this.ripple * Math.exp(-((x - this.rippleX) ** 2) / 2) * this.k * 0.6;
    for (let x = a.x; x <= b.x + 0.5; x += step) {
      const mx = (x - this.gx) / this.k;
      g.lineBetween(x, a.y - bulge(mx), x, b.y);
    }
    for (let y = a.y; y <= b.y + 0.5; y += step) {
      g.beginPath();
      for (let x = a.x; x <= b.x; x += step / 2) {
        const mx = (x - this.gx) / this.k;
        const yy = y - bulge(mx) * (1 - (y - a.y) / (b.y - a.y));
        if (x === a.x) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.strokePath();
    }
    const post = Math.max(3, this.k * 0.18);
    g.lineStyle(post, 0xffffff, 1).lineBetween(a.x, b.y, b.x, b.y);
    g.lineStyle(Math.max(2, this.k * 0.08), 0xffffff, 0.9).lineBetween(a.x, a.y, a.x, b.y).lineBetween(b.x, a.y, b.x, b.y).lineBetween(a.x, a.y, b.x, a.y);
    g.fillStyle(0xffffff, 1).fillCircle(a.x, b.y, post * 0.75).fillCircle(b.x, b.y, post * 0.75);
  }

  private makePerson(sheet: string, n: number): Person {
    const body = this.add.image(0, 0, SHEET, `character${sheet} (${n}).png`);
    const arm = `character${sheet} (11).png`;
    const armL = this.add.image(0, -12, SHEET, arm).setOrigin(0, 0.5);
    const armR = this.add.image(0, 12, SHEET, arm).setOrigin(0, 0.5);
    const box = this.add.container(0, 0, [armL, armR, body]).setDepth(5);
    return { box, body, armL, armR };
  }

  private dress(p: Person, sheet: string, n: number) {
    p.body.setFrame(`character${sheet} (${n}).png`);
    p.armL.setFrame(`character${sheet} (11).png`);
    p.armR.setFrame(`character${sheet} (11).png`);
  }

  // ---- HUD ---------------------------------------------------------------------------------

  private drawHud() {
    this.hud.removeAll(true);
    if (this.state === 'title') return;
    const { width: w } = this.scale;
    const team = TEAMS[Math.min(this.team, TEAMS.length - 1)];
    const k = Math.min(1, w / 460);
    const row = (y: number, label: string, colour: string, marks: (boolean | undefined)[]) => {
      this.hud.add(this.add.text(w - 16, y, label, { ...TEXT, fontSize: `${Math.round(18 * k)}px`, strokeThickness: 5, color: colour }).setOrigin(1, 0.5));
      const n = Math.max(KICKS, marks.length);
      for (let i = 0; i < n; i++) {
        const x = w - 16 - 96 * k - (n - 1 - i) * 20 * k;
        const g = this.add.graphics();
        const m = marks[i];
        g.fillStyle(m === undefined ? 0x1d4a26 : m ? 0x7ee05a : 0xff5a4e, m === undefined ? 0.4 : 1).fillCircle(x, y, 7 * k);
        g.lineStyle(2, 0xffffff, 0.9).strokeCircle(x, y, 7 * k);
        this.hud.add(g);
      }
    };
    const top = w < 560 ? 60 : 18;
    row(top, 'YOU', '#7fc4ff', this.mine);
    row(top + 24 * k, team.name.toUpperCase(), team.colour, this.theirs);
    this.hud.add(this.add.text(w < 560 ? 16 : 170, w < 560 ? top + 34 * k : top - 4, `MATCH ${this.team + 1}${this.wins ? `, ${this.wins} WON` : ''}`, { ...TEXT, fontSize: `${Math.round(18 * k)}px`, strokeThickness: 5 }).setOrigin(0, 0));
  }

  private say(text: string, colour = '#ffffff', sub = '') {
    this.banner?.destroy();
    const { width: w, height: h } = this.scale;
    const t = this.add.text(w / 2, h * 0.5, sub ? `${text}\n` : text, { ...TEXT, fontSize: `${Math.round(Math.min(64, w / 7))}px`, color: colour, strokeThickness: 10 }).setOrigin(0.5).setDepth(30);
    if (sub) t.setText([text, sub]).setLineSpacing(4);
    this.banner = t;
    this.tweens.add({ targets: t, scale: { from: 0.4, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 1000, duration: 300 });
  }

  // ---- Flow --------------------------------------------------------------------------------

  private startRun() {
    playSfx(this, SFX, 'click');
    this.music ??= this.sound.add('music', { loop: true, volume: 0.25 });
    if (!this.music.isPlaying) this.music.play();
    this.team = 0;
    this.wins = 0;
    this.startMatch();
  }

  private startMatch() {
    this.setOverlay();
    this.mine = [];
    this.theirs = [];
    this.shooting = true;
    this.nextKick();
  }

  /** Sets up the next kick: yours or theirs, whichever's due. */
  private nextKick() {
    this.bounce = undefined;
    this.flight = undefined;
    this.result = undefined;
    this.chosen = false;
    this.ripple = 0;
    this.drawNet();
    const round = Math.max(this.mine.length, this.theirs.length) + (this.shooting ? 1 : 0);
    const team = TEAMS[Math.min(this.team, TEAMS.length - 1)];
    if (this.shooting) {
      if (round <= KICKS) playSfx(this, SFX, `round${round}`, { volume: 0.5, detune: 0 });
      else if (round === KICKS + 1) playSfx(this, SFX, 'sudden', { volume: 0.5, detune: 0 });
      this.state = 'aim';
      this.dress(this.kicker, 'Blue', 1 + ((round * 3) % 5));
      this.dress(this.keeper, 'Special', 6 + (round % 5));
      this.aim = { x: 0, power: 0.55 };
    } else {
      this.state = 'keep';
      this.dress(this.kicker, team.sheet, 1 + ((round * 2) % 5));
      this.dress(this.keeper, 'Special', 1 + (round % 5));
      this.kick = cpuKick(team.skill, Math.random);
      this.wait = 1.1;
    }
    this.keep = { x: 0, target: 0, wait: 0, diving: false };
    this.placeForKick();
    this.drawHud();
  }

  /** Kicker behind the ball, keeper on the line, ball on the spot. */
  private placeForKick() {
    const b = this.sp(0, SPOT);
    this.ball.setPosition(b.x, b.y).setAngle(0);
    this.shadow.setPosition(b.x, b.y + this.k * 0.08);
    // The computer's kicker lines up a little to one side of where it'll shoot.
    const lean = !this.shooting && this.kick ? Math.sign(this.kick.aimX) * -0.6 : -0.5;
    const kp = this.sp(lean, SPOT + 2.4);
    this.kicker.box.setPosition(kp.x, kp.y).setAngle(-90 + lean * 8);
    const kk = this.sp(this.keep.x, 0.3);
    this.keeper.box.setPosition(kk.x, kk.y).setAngle(90);
  }

  /** The kick: the kicker runs in, then the ball's away. */
  private shoot(k: Kick) {
    this.kick = this.shooting ? wobble(k, Math.random) : k;
    this.state = 'runup';
    this.aimG.clear();
    const b = this.sp(0, SPOT + 0.5);
    this.tweens.add({ targets: this.kicker.box, x: b.x - this.k * 0.3, y: b.y, duration: 380, ease: 'Quad.easeIn', onComplete: () => this.strike() });
  }

  private strike() {
    const k = this.kick!;
    this.flight = flightOf(k);
    this.t = 0;
    this.state = 'flight';
    playSfx(this, SFX, 'kick', { volume: 0.6 });
    playSfx(this, SFX, 'whoosh', { volume: 0.25 });
    if (this.shooting) this.keep = keeperGuess(this.flight, TEAMS[Math.min(this.team, TEAMS.length - 1)].skill, Math.random);
    this.kicker.box.setAngle(-90 + (k.aimX / SPOT) * 57);
  }

  private settle(result: Result) {
    this.result = result;
    this.state = 'result';
    this.wait = 1.6;
    const f = this.flight!;
    const scored = result === 'goal';
    if (this.shooting) this.mine.push(scored);
    else this.theirs.push(scored);
    const mineSide = this.shooting;
    if (scored) {
      this.ripple = 1;
      this.rippleX = f.x;
      playSfx(this, SFX, 'net', { volume: 0.6 });
      playSfx(this, SFX, mineSide ? 'goal' : 'conceded', { volume: 0.5, detune: 0 });
      this.say('GOAL!', mineSide ? '#ffffff' : '#ffb0a0');
    } else if (result === 'saved') {
      playSfx(this, SFX, 'save', { volume: 0.6 });
      playSfx(this, SFX, mineSide ? 'missed' : 'saved', { volume: 0.5, detune: 0 });
      this.say('SAVED!', mineSide ? '#ffb0a0' : '#7ee05a');
    } else if (result === 'post') {
      playSfx(this, SFX, 'post', { volume: 0.6 });
      this.say(f.z > BAR - 0.4 ? 'OFF THE BAR!' : 'OFF THE POST!', mineSide ? '#ffb0a0' : '#7ee05a');
    } else {
      playSfx(this, SFX, mineSide ? 'missed' : 'saved', { volume: 0.5, detune: 0 });
      this.say(result === 'over' ? 'OVER THE BAR!' : 'WIDE!', mineSide ? '#ffb0a0' : '#7ee05a');
    }
    // The ball's way on: into the net, back off the keeper or the woodwork, or away past the goal.
    const at = ballAt(f, f.time);
    const speed = Math.hypot(f.vx, f.vy);
    if (scored) this.bounce = { ...at, vx: f.vx * 0.15, vy: -2, vz: 0.5 };
    else if (result === 'saved' || result === 'post') this.bounce = { ...at, vx: (Math.random() - 0.5) * 8 + (at.x - this.keep.x) * 2, vy: speed * 0.35, vz: 2.5 };
    else this.bounce = { ...at, vx: f.vx, vy: f.vy, vz: f.vz - 9.8 * f.time };
    this.drawHud();
  }

  /** After each kick: is the match decided? */
  private decide(): 'win' | 'lose' | undefined {
    const m = this.mine.filter(Boolean).length;
    const t = this.theirs.filter(Boolean).length;
    const mLeft = Math.max(0, KICKS - this.mine.length);
    const tLeft = Math.max(0, KICKS - this.theirs.length);
    if (this.mine.length <= KICKS && this.theirs.length <= KICKS) {
      if (m > t + tLeft) return 'win';
      if (t > m + mLeft) return 'lose';
      return undefined;
    }
    // Sudden death: after each pair of kicks.
    if (this.mine.length === this.theirs.length && m !== t) return m > t ? 'win' : 'lose';
    return undefined;
  }

  private afterResult() {
    const d = this.decide();
    if (d) {
      this.endMatch(d === 'win');
      return;
    }
    this.shooting = !this.shooting;
    this.nextKick();
  }

  private endMatch(won: boolean) {
    this.state = 'over';
    if (won) {
      this.wins++;
      playSfx(this, SFX, this.team + 1 >= TEAMS.length ? 'winner' : 'youWin', { volume: 0.6, detune: 0 });
    } else playSfx(this, SFX, 'youLose', { volume: 0.6, detune: 0 });
    const record = this.wins > this.best;
    if (record) {
      this.best = this.wins;
      save('spot-kick:best', this.wins);
    }
    const team = TEAMS[Math.min(this.team, TEAMS.length - 1)];
    const score = `${this.mine.filter(Boolean).length}-${this.theirs.filter(Boolean).length}`;
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const shade = this.add.rectangle(0, 0, w, h, 0x0f2a16, 0.5).setOrigin(0);
      const card = this.add.container(w / 2, h * 0.45);
      const title = this.add.text(0, -110, won ? 'YOU WIN!' : 'KNOCKED OUT', { ...TEXT, fontSize: '64px', strokeThickness: 12 }).setOrigin(0.5);
      const line = this.add.text(0, -30, won ? `Beat the ${team.name} ${score}` : `Lost to the ${team.name} ${score}`, { ...TEXT, fontFamily: FONT_BODY, fontSize: '26px', strokeThickness: 7 }).setOrigin(0.5);
      const note = this.add.text(0, 20, won ? '' : this.wins ? `${this.wins} match${this.wins === 1 ? '' : 'es'} won${record ? ', a new best!' : `, best ${this.best}`}` : 'Better luck next time', { ...TEXT, fontFamily: FONT_BODY, fontSize: '22px', color: '#ffe066', strokeThickness: 6 }).setOrigin(0.5);
      const label = won ? (this.team + 1 >= TEAMS.length ? 'CHAMPIONS! AGAIN?' : 'NEXT MATCH') : 'TRY AGAIN';
      const btn = makeButton(this, 0, 110, label, () => {
        if (won) {
          this.team++;
          this.startMatch();
        } else this.startRun();
      }, { textStyle: TEXT, color: 0xf08a24, w: 300, onPress: () => playSfx(this, SFX, 'click') }).parts;
      card.add([title, line, note, ...btn]);
      fitCard(card, Math.min(w / 560, h / 760, 1.3), w, 520, title);
      return [shade, card];
    });
  }

  private setOverlay(build?: () => Phaser.GameObjects.GameObject[]) {
    this.rebuildOverlay = build && (() => this.setOverlay(build));
    this.overlay?.destroy();
    this.overlay = undefined;
    if (!build) return;
    this.overlay = this.add.container(0, 0, build()).setDepth(40);
  }

  private showTitle() {
    this.state = 'title';
    this.placeForKick();
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.42);
      const title = this.add.text(0, -110, 'SPOT KICK', { ...TEXT, fontSize: '84px', strokeThickness: 14 }).setOrigin(0.5);
      const touch = this.sys.game.device.input.touch;
      const how = this.add.text(0, -10, touch ? 'Drag back from the ball to aim and shoot.\nIn goal, tap where to dive.' : 'Drag back from the ball to aim and shoot.\nIn goal, click where to dive (or use the arrow keys).', { ...TEXT, fontFamily: FONT_BODY, fontSize: '22px', strokeThickness: 6, lineSpacing: 6 }).setOrigin(0.5);
      const play = makeButton(this, 0, 90, 'KICK OFF', () => this.startRun(), { textStyle: TEXT, color: 0xf08a24, w: 260, onPress: () => playSfx(this, SFX, 'click') }).parts;
      const parts: Phaser.GameObjects.GameObject[] = [title, how, ...play];
      if (this.best) parts.push(this.add.text(0, 160, `best run: ${this.best} match${this.best === 1 ? '' : 'es'} won`, { ...TEXT, fontSize: '22px', color: '#ffe066', strokeThickness: 6 }).setOrigin(0.5));
      card.add(parts);
      fitCard(card, Math.min(w / 560, h / 760, 1.3), w, 560, title);
      return [card];
    });
  }

  // ---- Input -------------------------------------------------------------------------------

  private down(p: Phaser.Input.Pointer) {
    if (this.state === 'aim') {
      this.drag = { x: p.x, y: p.y };
      this.aim = { x: 0, power: 0 };
      return;
    }
    if (this.state === 'keep' || (this.state === 'flight' && !this.shooting)) {
      // Dive towards where you tapped, along the line.
      const x = Phaser.Math.Clamp((p.x - this.gx) / this.k, -HALF_GOAL + 0.3, HALF_GOAL - 0.3);
      this.dive(x);
    }
  }

  private moveDrag(p: Phaser.Input.Pointer) {
    if (this.state !== 'aim' || !this.drag || !p.isDown) return;
    // Pull back (down the screen) to shoot up it; the further, the harder.
    const dx = this.drag.x - p.x;
    const dy = this.drag.y - p.y;
    if (dy > -4) {
      this.aim = { x: 0, power: 0 };
      this.drawAim();
      return;
    }
    const along = -dy;
    const aimX = Phaser.Math.Clamp((dx / along) * SPOT, -6, 6);
    const power = Phaser.Math.Clamp(Math.hypot(dx, dy) / (this.k * 7), 0, 1);
    this.aim = { x: aimX, power };
    this.drawAim();
  }

  private up(_p: Phaser.Input.Pointer) {
    if (this.state !== 'aim' || !this.drag) return;
    this.drag = undefined;
    if (this.aim.power < 0.08) {
      this.aimG.clear();
      return;
    }
    this.shoot({ aimX: this.aim.x, power: this.aim.power });
  }

  /** An arrow from the ball towards the goal: longer and redder the harder the kick. */
  private drawAim() {
    const g = this.aimG.clear();
    if (this.state !== 'aim' || this.aim.power <= 0) return;
    const from = this.sp(0, SPOT);
    const to = this.sp(this.aim.x * (0.25 + this.aim.power * 0.75), SPOT - SPOT * (0.25 + this.aim.power * 0.75));
    const p = this.aim.power;
    const colour = p > 0.85 ? 0xff5a4e : p > 0.7 ? 0xffc93a : 0xffffff;
    g.lineStyle(Math.max(3, this.k * 0.15), colour, 0.9).lineBetween(from.x, from.y, to.x, to.y);
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const s = this.k * 0.6;
    g.fillStyle(colour, 0.95).fillTriangle(to.x + Math.cos(ang) * s, to.y + Math.sin(ang) * s, to.x + Math.cos(ang + 2.4) * s, to.y + Math.sin(ang + 2.4) * s, to.x + Math.cos(ang - 2.4) * s, to.y + Math.sin(ang - 2.4) * s);
    // Where on the goal line it's heading.
    const goal = this.sp(this.aim.x, 0);
    g.lineStyle(2, colour, 0.6).strokeCircle(goal.x, goal.y, this.k * 0.35);
  }

  private keySpace() {
    if (this.state === 'title' || this.state === 'over') {
      if (this.state === 'title') this.startRun();
      return;
    }
    if (this.state === 'aim') this.shoot({ aimX: this.aim.x, power: Math.max(0.3, this.aim.power || 0.55) });
  }

  private keyDive(dir: number) {
    if (this.state === 'keep' || (this.state === 'flight' && !this.shooting)) this.dive(dir * 2.6);
  }

  private dive(x: number) {
    if (this.chosen) return;
    this.chosen = true;
    this.keep.target = x;
    this.keep.wait = 0;
    playSfx(this, SFX, 'whoosh', { volume: 0.3 });
  }

  // ---- Frame -------------------------------------------------------------------------------

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.05);
    // Keyboard aiming.
    if (this.state === 'aim' && this.keys) {
      const k = this.keys;
      let changed = false;
      if (k.left.isDown) (this.aim.x -= dt * 5), (changed = true);
      if (k.right.isDown) (this.aim.x += dt * 5), (changed = true);
      if (k.up.isDown) (this.aim.power = Math.min(1, (this.aim.power || 0.55) + dt * 0.6)), (changed = true);
      if (k.down.isDown) (this.aim.power = Math.max(0.1, (this.aim.power || 0.55) - dt * 0.6)), (changed = true);
      if (changed) {
        this.aim.x = Phaser.Math.Clamp(this.aim.x, -6, 6);
        this.drawAim();
      }
    }
    if (this.state === 'keep') {
      this.wait -= dt;
      if (this.wait <= 0) this.shoot(this.kick!);
    }
    if (this.state === 'flight' && this.flight) {
      this.t += dt;
      stepKeeper(this.keep, dt);
      const f = this.flight;
      if (this.t >= f.time) {
        this.t = f.time;
        this.settle(judge(f, this.keep));
      }
      const b = ballAt(f, this.t);
      this.drawBall(b.x, b.y, b.z);
    } else if (this.state === 'result' && this.bounce) {
      const b = this.bounce;
      b.vz -= 9.8 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.z < 0) {
        b.z = 0;
        b.vz = -b.vz * 0.4;
        b.vx *= 0.8;
        b.vy *= 0.8;
      }
      // The net stops it.
      if (this.result === 'goal' && b.y < -1.8) {
        b.y = -1.8;
        b.vy = 0;
        b.vx *= 0.5;
      }
      this.drawBall(b.x, b.y, b.z);
      this.wait -= dt;
      if (this.wait <= 0) this.afterResult();
    }
    // The keeper: on the line, sliding to the dive, arms out when diving.
    if (this.state !== 'title' && this.state !== 'aim') stepKeeper(this.keep, this.state === 'flight' ? 0 : dt);
    const kp = this.sp(this.keep.x, 0.3);
    this.keeper.box.setPosition(kp.x, kp.y);
    // Diving, the keeper stretches out along the line towards the ball, both arms reaching.
    const diving = this.keep.diving;
    const want = diving ? (this.keep.target >= 0 ? 0 : 180) : 90 + Math.sin(this.time.now / 300) * 6;
    let d = want - this.keeper.box.angle;
    d = ((d + 540) % 360) - 180;
    this.keeper.box.setAngle(this.keeper.box.angle + d * Math.min(1, dt * 14));
    const reachOut = diving ? 1 : 0;
    this.keeper.armL.setPosition(2 + reachOut * 12, -13 + reachOut * 6);
    this.keeper.armR.setPosition(2 + reachOut * 12, 13 - reachOut * 6);
    if ((this.state === 'aim' || this.state === 'title' || this.state === 'keep') && !this.chosen) {
      // Idle keeper shuffles side to side.
      this.keep.x = Math.sin(this.time.now / 500) * 0.4;
    }
    if (this.ripple > 0) {
      this.ripple = Math.max(0, this.ripple - dt * 1.5);
      this.drawNet();
    }
  }

  private drawBall(x: number, y: number, z: number) {
    const p = this.sp(x, y, z);
    const g = this.sp(x, y);
    this.ball.setPosition(p.x, p.y).setScale(((this.k * 0.6) / 18) * (1 + z * 0.12));
    this.ball.angle += 20;
    this.shadow.setPosition(g.x, g.y + this.k * 0.08).setAlpha(Math.max(0.08, 0.25 - z * 0.04));
  }
}
