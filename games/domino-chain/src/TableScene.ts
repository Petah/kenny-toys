import * as Phaser from 'phaser';
import { FONT_BODY, FONT_HEADING } from '@shared/fonts';
import { ICONS, preloadIcons } from '@shared/icons';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { fitCard, makeButton, type Button } from '@shared/ui';
import { BLANK, CHIPS, CHIP_FRAMES, DICE, SFX, dominoKey, pawnKey, preloadAssets, unpackAssets, type Voice } from './assets';
import { CHIP_R, DIE_R, L, PAWN_R, Stroke, T, Table, W, type Chip, type Piece } from './chain';
import { THEMES, setRound, type Round, type Theme } from './rounds';

/** Table sizes in world units, long side along the screen's long side. */
const LONG = 960;
const SHORT = 600;
/** Wooden rim around the baize, in world units. */
const RIM = 22;
/** A stroke that starts this close to a standing domino carries on from it. */
const SNAP = 26;
/** Screen pixels a press must move before it counts as drawing rather than a tap. */
const DRAG_PX = 8;
/** A standing domino is drawn this deep, a little more than its true thickness, so it reads as a domino. */
const STAND_DEPTH = T * 1.6;
/** Where shadows fall per unit of height: light from the top left. */
const LIGHT = { x: 0.22, y: 0.32 };
const PAWN_SIZE = 42;
const LIVES = 3;
/** Tint for a domino the wave won't reach from the one before it. */
const WEAK_TINT = 0xff6a5a;
/** Tint for the round's starting domino, so it stands out from the ones you lay. */
const START_TINT = 0xffd36a;
/** Below this zoom a round gets a smaller table instead. */
const MIN_ZOOM = 0.62;

const POINTS = { pawn: 100, chip: 50, toppled: 5, spare: 10, round: 100 };

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#1d2b33',
  align: 'center',
};

type State = 'title' | 'build' | 'run' | 'judge' | 'over';

interface Press {
  /** Screen position it started at. */
  sx: number;
  sy: number;
  /** World position it started at. */
  wx: number;
  wy: number;
  from?: Piece;
  stroke?: Stroke;
  warned: boolean;
}

export class TableScene extends Phaser.Scene {
  private state: State = 'title';
  private table = new Table();
  private round?: Round;
  private theme: Theme = THEMES[0];
  /** Table size in world units. */
  private tw = LONG;
  private th = SHORT;
  private zoom = 1;

  private world!: Phaser.GameObjects.Layer;
  private ui!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private felt!: Phaser.GameObjects.Graphics;
  private shadows!: Phaser.GameObjects.Graphics;
  private sprites = new Map<Piece, Phaser.GameObjects.Image>();
  /** A domino's sprite is its blank top edge while it stands; this is its face, fading in as it tips. */
  private faces = new Map<Piece, Phaser.GameObjects.Image>();
  private born = new Map<Piece, number>();
  private chipImgs = new Map<Chip, Phaser.GameObjects.Image>();
  private diceImgs: Phaser.GameObjects.Image[] = [];
  private arrow!: Phaser.GameObjects.Image;

  private strokes: Stroke[] = [];
  /** Dominoes the one before them in their line can't knock over, drawn tinted as a warning. */
  private weak = new Set<Piece>();
  private nextStroke = 0;
  private press?: Press;

  private scoreText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private livesImgs: Phaser.GameObjects.Image[] = [];
  private budgetIcon!: Phaser.GameObjects.Image;
  private budgetText!: Phaser.GameObjects.Text;
  private bar: Phaser.GameObjects.GameObject[] = [];
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private overlayTimers: Phaser.Time.TimerEvent[] = [];

  /** Score banked from cleared rounds, and points earned on this attempt so far. */
  private score = 0;
  private pending = 0;
  private best = 0;
  private lives = LIVES;
  private seed = 1;
  private toppled = 0;
  private settle = 0;
  private lastClack = 0;
  private canContinue = false;
  /** The cleared round's score lines, and whether they've been added to the score yet. */
  private tally: [string, number][] = [];
  private banked = true;
  /** Title-screen demo: seconds until the next push or rewind. */
  private demoIn = 0;

  constructor() {
    super('table');
  }

  preload() {
    preloadAssets(this);
    preloadIcons(this);
  }

  // ---- Setup -------------------------------------------------------------------------------

  create() {
    unpackAssets(this);
    this.world = this.add.layer();
    this.ui = this.add.layer();
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.ui);
    this.uiCam.ignore(this.world);

    this.felt = this.add.graphics().setDepth(0);
    this.shadows = this.add.graphics().setDepth(5);
    this.arrow = this.add.image(0, 0, ICONS, 'arrowUp.png').setDepth(60).setTint(0xffe08a).setVisible(false);
    this.world.add([this.felt, this.shadows, this.arrow]);

    this.scoreText = this.add.text(0, 0, '0', { ...TEXT, fontSize: '36px', strokeThickness: 8 }).setOrigin(0.5, 0);
    this.roundText = this.add.text(0, 0, '', { ...TEXT, fontSize: '18px', color: '#ffe08a', strokeThickness: 5 }).setOrigin(0.5, 0);
    for (let i = 0; i < LIVES; i++) this.livesImgs.push(this.add.image(0, 0, dominoKey('hearts'), 7));
    this.budgetIcon = this.add.image(0, 0, dominoKey('light'), 27);
    this.budgetText = this.add.text(0, 0, '', { ...TEXT, fontSize: '36px', strokeThickness: 8 }).setOrigin(0, 0.5);
    this.ui.add([this.scoreText, this.roundText, ...this.livesImgs, this.budgetIcon, this.budgetText]);

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('gameout', () => this.press && this.onUp());
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE');
      for (const key of ['SPACE', 'ENTER']) kb.on(`keydown-${key}`, (e: KeyboardEvent) => !e.repeat && this.confirm());
      for (const key of ['Z', 'BACKSPACE']) kb.on(`keydown-${key}`, () => this.undo());
    }
    this.scale.on('resize', () => this.layout());

    this.best = load('domino-chain:best', 0);
    this.showTitle();
  }

  /** UI scale: 1 at 1280×720, smaller on phones. */
  private get k() {
    return Math.min(this.scale.height / 720, this.scale.width / 480);
  }

  /** Room above and below the table for the HUD, in screen pixels. */
  private get margins() {
    const k = this.k;
    return { top: 84 * k, bottom: (this.state === 'title' || this.state === 'over' ? 20 : 108) * k };
  }

  /** Fits the table between the HUD bars and lays out the HUD. */
  private layout() {
    const { width: w, height: h } = this.scale;
    const k = this.k;
    const { top, bottom } = this.margins;
    const availW = w - 24;
    const availH = h - top - bottom;
    this.zoom = Math.min(availW / (this.tw + RIM * 2), availH / (this.th + RIM * 2));
    const cam = this.cameras.main;
    cam.setSize(w, h).setZoom(this.zoom);
    cam.centerOn(this.tw / 2, this.th / 2 + (h / 2 - (top + availH / 2)) / this.zoom);
    this.uiCam.setSize(w, h);

    this.scoreText.setPosition(w / 2, 34 * k).setScale(k);
    this.roundText.setPosition(w / 2, 6 * k).setScale(k);
    this.livesImgs.forEach((img, i) => img.setPosition(w - (24 + i * 28) * k, 40 * k).setDisplaySize(20 * k, 40 * k));
    this.buildBar();
    this.rebuildOverlay?.();
  }

  private drawFelt() {
    const g = this.felt.clear();
    const { felt, rim } = this.theme;
    g.fillStyle(0x000000, 0.25).fillRoundedRect(-RIM + 6, -RIM + 10, this.tw + RIM * 2, this.th + RIM * 2, 30);
    g.fillStyle(rim).fillRoundedRect(-RIM, -RIM, this.tw + RIM * 2, this.th + RIM * 2, 30);
    g.lineStyle(3, 0xffffff, 0.12).strokeRoundedRect(-RIM + 4, -RIM + 4, this.tw + RIM * 2 - 8, this.th + RIM * 2 - 8, 26);
    g.fillStyle(felt).fillRoundedRect(0, 0, this.tw, this.th, 14);
    // A soft lip of shade along the top and left edges of the baize, under the rim.
    g.fillStyle(0x000000, 0.12).fillRoundedRect(0, 0, this.tw, 10, { tl: 14, tr: 14, bl: 0, br: 0 });
    g.fillStyle(0x000000, 0.08).fillRect(0, 10, 8, this.th - 24);
    g.lineStyle(2, 0xffffff, 0.08).strokeRoundedRect(14, 14, this.tw - 28, this.th - 28, 8);
  }

  // ---- Bottom bar --------------------------------------------------------------------------

  private buildBar() {
    this.bar.forEach((o) => o.destroy());
    this.bar = [];
    const building = this.state === 'build';
    const show = building || this.state === 'run' || this.state === 'judge';
    this.budgetIcon.setVisible(show);
    this.budgetText.setVisible(show);
    if (!show) return;
    const { width: w, height: h } = this.scale;
    const k = this.k;
    const y = h - 54 * k;
    this.budgetIcon.setPosition(26 * k, y).setDisplaySize(26 * k, 52 * k);
    this.budgetText.setPosition(46 * k, y).setScale(k);
    this.updateBudget();

    const opts = (icon: string | undefined, color: number, bw: number) => ({
      textStyle: TEXT, icon, color, w: bw * k, h: 66 * k, size: 30 * k, disabled: !building,
      onPress: () => playSfx(this, SFX, 'click'),
    });
    const parts = (b: Button) => b.parts;
    const go = makeButton(this, w - 84 * k, y, 'GO!', () => this.go(), opts(undefined, 0x3aa55c, 140));
    const clear = makeButton(this, w - 204 * k, y, '', () => this.clearAll(), opts('trashcan.png', 0xd0584a, 76));
    const undo = makeButton(this, w - 292 * k, y, '', () => this.undo(), opts('return.png', 0x4a8fd0, 76));
    this.bar = [...parts(go), ...parts(clear), ...parts(undo)];
    this.ui.add(this.bar);
  }

  private get laid() {
    return this.table.dominoes.filter((d) => d.stroke >= 0).length;
  }

  private get left() {
    return this.round ? this.round.budget - this.laid : 0;
  }

  private updateBudget() {
    this.budgetText.setText(`${Math.max(0, this.left)}`);
    this.budgetText.setColor(this.left <= 5 ? '#ff8a7a' : '#ffffff');
  }

  // ---- Input -------------------------------------------------------------------------------

  private worldAt(p: Phaser.Input.Pointer) {
    return this.cameras.main.getWorldPoint(p.x, p.y);
  }

  private onDown(p: Phaser.Input.Pointer) {
    if (this.state !== 'build') return;
    const at = this.worldAt(p);
    if (at.x < -RIM || at.y < -RIM || at.x > this.tw + RIM || at.y > this.th + RIM) return;
    let from: Piece | undefined;
    let nearest = SNAP;
    for (const d of this.table.dominoes) {
      const dist = Math.hypot(d.x - at.x, d.y - at.y);
      if (dist < nearest) {
        nearest = dist;
        from = d;
      }
    }
    this.press = { sx: p.x, sy: p.y, wx: at.x, wy: at.y, from, warned: false };
  }

  private onMove(p: Phaser.Input.Pointer) {
    const press = this.press;
    if (!press || this.state !== 'build' || !p.isDown) return;
    if (!press.stroke) {
      if (Math.hypot(p.x - press.sx, p.y - press.sy) < DRAG_PX) return;
      press.stroke = new Stroke({
        table: this.table,
        id: this.nextStroke++,
        x: press.wx,
        y: press.wy,
        from: press.from,
        turnFrom: this.turnFor(press.from),
        width: this.tw,
        height: this.th,
        face: () => Phaser.Math.Between(0, 27),
        budget: () => this.left,
      });
      this.strokes.push(press.stroke);
    }
    const at = this.worldAt(p);
    const placed = press.stroke.to(at.x, at.y);
    placed.forEach((d, i) => {
      this.addSprite(d);
      if (i === 0) playSfx(this, SFX, 'place', { volume: 0.35 });
    });
    if (placed.length) {
      this.updateBudget();
      this.findWeakLinks();
    }
    if (this.left <= 0 && !press.warned && !placed.length && Math.hypot(at.x - (press.stroke.laid.at(-1)?.x ?? at.x), at.y - (press.stroke.laid.at(-1)?.y ?? at.y)) > L) {
      press.warned = true;
      playSfx(this, SFX, 'empty', { volume: 0.5 });
      this.tweens.add({ targets: this.budgetText, x: { from: this.budgetText.x - 6 * this.k, to: this.budgetText.x }, duration: 260, ease: 'Elastic.easeOut' });
    }
  }

  /** How a stroke's starting domino turns to meet it (see StrokeOptions.turnFrom). */
  private turnFor(from?: Piece): 'face' | 'bend' | undefined {
    if (!from) return undefined;
    const followed = this.table.dominoes.some((d) => d !== from && Math.hypot(d.x - from.x, d.y - from.y) < L * 0.75);
    if (from.stroke < 0) return followed ? undefined : 'face';
    return this.strokes.some((s) => s.laid.at(-1) === from) ? 'bend' : undefined;
  }

  /** Re-checks every link in every stroke (see Table.carries); placing a domino can turn the one before it. */
  private findWeakLinks() {
    this.weak.clear();
    for (const s of this.strokes) {
      let prev = s.from;
      for (const d of s.laid) {
        if (prev && !this.table.carries(prev, d)) this.weak.add(d);
        prev = d;
      }
    }
  }

  private onUp() {
    const press = this.press;
    this.press = undefined;
    if (!press || this.state !== 'build') return;
    if (press.stroke) {
      if (!press.stroke.laid.length) this.strokes = this.strokes.filter((s) => s !== press.stroke);
      return;
    }
    // A tap on the starting domino tips it.
    if (press.from && press.from.stroke < 0) this.go();
  }

  private confirm() {
    if (this.state === 'build') this.go();
    else if (this.state === 'title' || (this.state === 'over' && this.canContinue)) this.startGame();
    else if (this.state === 'judge' && this.canContinue) this.nextRound();
  }

  private undo() {
    if (this.state !== 'build' || this.press) return;
    const last = this.strokes.pop();
    if (!last) return;
    playSfx(this, SFX, 'undo', { volume: 0.5 });
    this.removeDominoes(last.laid);
    this.findWeakLinks();
  }

  private clearAll() {
    if (this.state !== 'build' || !this.strokes.length) return;
    playSfx(this, SFX, 'rewind', { volume: 0.5 });
    this.removeDominoes(this.strokes.flatMap((s) => s.laid));
    this.strokes = [];
    this.weak.clear();
  }

  private removeDominoes(pieces: Piece[]) {
    this.table.remove(pieces);
    pieces.forEach((d, i) => {
      const img = this.sprites.get(d);
      const face = this.faces.get(d);
      this.sprites.delete(d);
      this.faces.delete(d);
      this.born.delete(d);
      face?.destroy();
      if (!img) return;
      this.tweens.add({ targets: img, alpha: 0, duration: 160, delay: Math.min(i * 6, 300), onComplete: () => img.destroy() });
    });
    this.updateBudget();
  }

  // ---- Game flow ---------------------------------------------------------------------------

  private startGame() {
    playSfx(this, SFX, 'click');
    this.score = 0;
    this.pending = 0;
    this.lives = LIVES;
    this.seed = Phaser.Math.Between(1, 1e6);
    this.setOverlay();
    this.setRound(1);
  }

  private setRound(n: number) {
    this.clearTable();
    const { width: w, height: h } = this.scale;
    this.fitTable(h - 180 * this.k > w);
    const round = setRound(this.table, n, this.tw, this.th, this.seed);
    this.round = round;
    this.theme = round.theme;
    this.state = 'build';
    this.strokes = [];
    this.pending = 0;
    this.toppled = 0;
    this.budgetIcon.setTexture(dominoKey(this.theme.set), 27);
    this.populate();
    this.layout();
    this.updateHud();
    this.updateLives();
    this.scoreText.setVisible(true);
    this.livesImgs.forEach((i) => i.setVisible(true));

    this.roundText.setText(`ROUND ${n}`);
    this.banner(`ROUND ${n}`, n === 1 ? 'Drag from the gold domino through every pawn' : `${this.table.pawns.length} pawns · ${round.budget} dominoes`);
    this.voice('round');
    if (n <= 10) this.time.delayedCall(550, () => this.voice(`${n}` as Voice));
  }

  /**
   * Picks the table's size for a new round: the long side along the screen's, and on small screens
   * a smaller table, so pieces stay big enough to see and draw between.
   */
  private fitTable(portrait: boolean) {
    const { width: w, height: h } = this.scale;
    const { top } = this.margins;
    const bottom = 108 * this.k;
    const long = portrait ? h - top - bottom : w - 24;
    const short = portrait ? w - 24 : h - top - bottom;
    const zoom = Math.min(long / (LONG + RIM * 2), short / (SHORT + RIM * 2));
    const shrink = Phaser.Math.Clamp(zoom / MIN_ZOOM, 0.7, 1);
    this.tw = Math.round((portrait ? SHORT : LONG) * shrink);
    this.th = Math.round((portrait ? LONG : SHORT) * shrink);
  }

  /** Makes sprites for everything the round put on the table, popping in one after another. */
  private populate() {
    this.drawFelt();
    for (const d of this.table.dice) {
      const img = this.add.image(d.x, d.y, DICE, `dieWhite_border${d.face}.png`).setAngle(d.angle).setDepth(8);
      img.setDisplaySize(DIE_R * 2, DIE_R * 2);
      this.diceImgs.push(img);
      this.world.add(img);
    }
    this.table.chips.forEach((c, i) => {
      const img = this.add.image(c.x, c.y, CHIPS, CHIP_FRAMES[i % CHIP_FRAMES.length]).setDepth(6);
      img.setDisplaySize(CHIP_R * 2, CHIP_R * 2);
      this.chipImgs.set(c, img);
      this.world.add(img);
    });
    this.table.pieces.forEach((p) => this.addSprite(p));
    const all = [...this.diceImgs, ...this.chipImgs.values(), ...this.table.pawns.map((p) => this.sprites.get(p)!)];
    all.forEach((img, i) => {
      const sx = img.scaleX;
      const sy = img.scaleY;
      this.tweens.add({ targets: img, scaleX: { from: 0, to: sx }, scaleY: { from: 0, to: sy }, duration: 300, delay: 200 + i * 45, ease: 'Back.easeOut' });
    });
  }

  private clearTable() {
    for (const img of this.sprites.values()) img.destroy();
    for (const img of this.faces.values()) img.destroy();
    this.faces.clear();
    for (const img of this.chipImgs.values()) img.destroy();
    this.diceImgs.forEach((i) => i.destroy());
    this.sprites.clear();
    this.born.clear();
    this.chipImgs.clear();
    this.diceImgs = [];
    this.table.pieces = [];
    this.table.chips = [];
    this.table.dice = [];
  }

  private addSprite(p: Piece) {
    const img = p.kind === 'pawn' ? this.add.image(p.x, p.y, pawnKey(p.face)).setOrigin(0.5, 0.92) : this.add.image(p.x, p.y, dominoKey(this.theme.set), BLANK).setOrigin(0.5, 0);
    if (p.kind === 'pawn') img.setDisplaySize(PAWN_SIZE, PAWN_SIZE);
    else {
      const face = this.add.image(p.x, p.y, dominoKey(this.theme.set), p.face).setOrigin(0.5, 0).setAlpha(0);
      this.faces.set(p, face);
      this.world.add(face);
    }
    this.sprites.set(p, img);
    this.born.set(p, this.time.now);
    this.world.add(img);
  }

  private go() {
    if (this.state !== 'build') return;
    const start = this.table.pieces.find((p) => p.kind === 'domino' && p.stroke < 0);
    if (!start) return;
    this.press = undefined;
    this.state = 'run';
    this.settle = 0;
    this.buildBar();
    this.table.push(start);
    playSfx(this, SFX, 'clack', { volume: 0.6 });
  }

  /** Called once the table stops moving: did every pawn go over? */
  private judge() {
    this.state = 'judge';
    this.canContinue = false;
    const standing = this.table.pawns.filter((p) => p.state === 'standing');
    if (!standing.length) {
      this.roundClear();
      return;
    }
    this.lives--;
    this.pending = 0;
    this.updateHud();
    playSfx(this, SFX, 'miss', { volume: 0.6, detune: 0 });
    this.cameras.main.shake(200, 0.004);
    for (const p of standing) this.ring(p.x, p.y);
    const lost = this.livesImgs[this.lives];
    if (lost) this.tweens.add({ targets: lost, angle: 110, alpha: 0.2, duration: 400, ease: 'Back.easeIn' });
    if (this.lives > 0) {
      this.banner(standing.length === 1 ? 'MISSED ONE' : `MISSED ${standing.length}`, this.lives === 1 ? 'last try!' : `${this.lives} tries left`);
      this.time.delayedCall(1500, () => this.rewind());
    } else {
      this.time.delayedCall(1200, () => this.gameOver());
    }
  }

  /** Stands everything back up, last to fall first, ready for another go with the same lines. */
  private rewind(then: () => void = () => this.backToBuild()) {
    playSfx(this, SFX, 'rewind', { volume: 0.45 });
    const fallen = this.table.pieces.filter((p) => p.state !== 'standing').sort((a, b) => b.order - a.order);
    const gap = Math.min(14, 700 / Math.max(1, fallen.length));
    fallen.forEach((p, i) => {
      this.tweens.add({ targets: p, phi: 0, duration: 170, delay: i * gap, ease: 'Quad.easeOut' });
    });
    for (const [c, img] of this.chipImgs) {
      if (!c.taken) continue;
      img.setVisible(true).setAlpha(0);
      this.tweens.add({ targets: img, alpha: 1, duration: 300, delay: fallen.length * gap });
    }
    this.time.delayedCall(fallen.length * gap + 220, () => {
      this.table.reset();
      then();
    });
  }

  private backToBuild() {
    this.state = 'build';
    this.toppled = 0;
    this.buildBar();
  }

  private roundClear() {
    const round = this.round!;
    playSfx(this, SFX, 'clear', { volume: 0.6, detune: 0 });
    const spare = Math.max(0, this.left);
    this.tally = [
      [`Pawns & chips`, this.pending],
      [`Toppled ${this.toppled} × ${POINTS.toppled}`, this.toppled * POINTS.toppled],
      [`Spare ${spare} × ${POINTS.spare}`, spare * POINTS.spare],
      [`Round ${round.number} bonus`, POINTS.round * round.number],
    ];
    this.banked = false;
    this.time.delayedCall(700, () => this.showClear(true));
  }

  /** Adds the round's tally to the score, once. */
  private bank() {
    if (this.banked) return;
    this.banked = true;
    this.score += this.tally.reduce((sum, r) => sum + r[1], 0);
    this.pending = 0;
    this.updateHud();
    this.tweens.add({ targets: this.scoreText, scale: { from: 1.3 * this.k, to: this.k }, duration: 300, ease: 'Back.easeOut' });
  }

  private nextRound() {
    playSfx(this, SFX, 'click');
    this.bank();
    this.setOverlay();
    this.setRound((this.round?.number ?? 0) + 1);
  }

  private gameOver() {
    this.state = 'over';
    this.canContinue = false;
    this.voice('game_over');
    const previous = this.best;
    const { best, isNew } = submitHighScore('domino-chain', this.score);
    this.best = best;
    this.layout();
    this.time.delayedCall(900, () => this.showGameOver(isNew && previous > 0, true));
  }

  private updateHud() {
    this.scoreText.setText(group(this.score + this.pending));
    this.updateBudget();
  }

  private updateLives() {
    this.livesImgs.forEach((img, i) => img.setAlpha(i < this.lives ? 1 : 0.2).setAngle(i < this.lives ? 0 : 110));
  }

  // ---- Frame loop --------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 20);
    if (this.state === 'run' || this.state === 'title') {
      const ev = this.table.step(dt);
      for (const p of ev.started) if (p.kind === 'pawn') this.knockPawn(p);
      for (const p of ev.landed) {
        if (p.kind !== 'domino') continue;
        this.toppled++;
        if (time - this.lastClack > 28) {
          this.lastClack = time;
          const detune = Math.min(this.toppled * 6, 900) - 250 + Phaser.Math.Between(-60, 60);
          playSfx(this, SFX, 'clack', { volume: this.state === 'title' ? 0.12 : 0.4, detune });
        }
      }
      for (const c of ev.chips) this.takeChip(c);
      if (this.state === 'run') {
        this.settle = this.table.moving ? 0 : this.settle + dt;
        if (this.settle > 0.5) this.judge();
      }
    }
    if (this.state === 'title') this.runDemo(dt);
    this.draw(time);
  }

  private knockPawn(p: Piece) {
    playSfx(this, SFX, 'pawn', { volume: this.state === 'title' ? 0.15 : 0.5 });
    if (this.state !== 'run') return;
    this.pending += POINTS.pawn;
    this.updateHud();
    this.popup(p.x, p.y - 30, `+${POINTS.pawn}`);
    this.cameras.main.shake(90, 0.003);
    const left = this.table.pawns.filter((q) => q.state === 'standing').length;
    if (left === 0) this.time.delayedCall(250, () => this.state === 'run' && this.banner('ALL DOWN!'));
  }

  private takeChip(c: Chip) {
    const img = this.chipImgs.get(c);
    playSfx(this, SFX, 'chip', { volume: this.state === 'title' ? 0.15 : 0.5 });
    if (img) {
      const s = img.scaleX;
      this.tweens.add({ targets: img, scale: s * 1.6, alpha: 0, y: img.y - 30, duration: 380, ease: 'Cubic.easeOut', onComplete: () => img.setVisible(false).setScale(s).setY(c.y) });
    }
    if (this.state !== 'run') return;
    this.pending += POINTS.chip;
    this.updateHud();
    this.popup(c.x, c.y - 24, `+${POINTS.chip}`, '#8cf08c');
  }

  /** Puts every piece's sprite and shadow where the table says it is. */
  private draw(time: number) {
    const g = this.shadows.clear();
    g.fillStyle(0x000000, 0.2);
    for (const d of this.table.dice) {
      g.fillCircle(d.x + 5, d.y + 7, DIE_R * 0.95);
    }
    for (const p of this.table.pieces) {
      const img = this.sprites.get(p);
      if (!img) continue;
      const age = time - (this.born.get(p) ?? 0);
      const pop = age < 220 ? 1 + 0.4 * (1 - Phaser.Math.Easing.Cubic.Out(age / 220)) : 1;
      if (p.kind === 'pawn') this.drawPawn(p, img, g);
      else this.drawDomino(p, img, g, pop);
    }
    // The arrow beside the start domino shows which way it tips, bobbing while it's waiting.
    const start = this.table.pieces.find((p) => p.kind === 'domino' && p.stroke < 0);
    const showArrow = !!start && start.state === 'standing' && this.state === 'build';
    this.arrow.setVisible(showArrow);
    if (start && showArrow) {
      const bob = Math.sin(time / 220) * 4;
      const back = 26 + bob;
      this.arrow.setPosition(start.x - start.dx * back, start.y - start.dy * back).setRotation(Math.atan2(start.dx, -start.dy)).setDisplaySize(26, 26);
    }
  }

  private drawDomino(p: Piece, img: Phaser.GameObjects.Image, g: Phaser.GameObjects.Graphics, pop: number) {
    const f = this.table.fallDir(p);
    const reach = Math.max(this.table.reach(p), STAND_DEPTH * Math.cos(p.phi) + this.table.reach(p) * Math.sin(p.phi));
    const bx = p.x - (f.x * T) / 2;
    const by = p.y - (f.y * T) / 2;
    img.setPosition(bx, by).setRotation(Math.atan2(-f.x, f.y)).setDisplaySize(W * pop, reach * pop);
    // Lying pieces stack: whatever fell first lies on top of the one it knocked.
    const depth = p.state === 'standing' && p.phi === 0 ? 30 : 20 - p.order * 0.0005;
    img.setDepth(depth);
    img.setTint(this.weak.has(p) && this.state === 'build' ? WEAK_TINT : p.stroke < 0 && this.state !== 'title' ? START_TINT : 0xffffff);
    const face = this.faces.get(p);
    if (face) {
      face.setPosition(bx, by).setRotation(img.rotation).setDisplaySize(W * pop, reach * pop).setDepth(depth + 0.0001);
      face.setAlpha(Phaser.Math.Clamp((p.phi - 0.08) / 0.35, 0, 1));
    }

    // Shadow: the footprint, with its far edge thrown away from the light by the top's height.
    const h = L * Math.cos(p.phi) + 2;
    const px = -f.y * (W / 2);
    const py = f.x * (W / 2);
    const fx = bx + f.x * reach;
    const fy = by + f.y * reach;
    const ox = LIGHT.x * h;
    const oy = LIGHT.y * h;
    quad(g, bx + px, by + py, bx - px, by - py, fx - px + ox, fy - py + oy, fx + px + ox, fy + py + oy);
    if (p.state === 'standing') quad(g, bx + px, by + py, bx - px, by - py, bx - px + ox, by - py + oy, bx + px + ox, by + py + oy);
  }

  private drawPawn(p: Piece, img: Phaser.GameObjects.Image, g: Phaser.GameObjects.Graphics) {
    const t = p.phi / (Math.PI / 2);
    const f = this.table.fallDir(p);
    // Topple the head towards the fall, the short way round.
    const target = Math.atan2(f.x, -f.y);
    img.setPosition(p.x, p.y + PAWN_R * 0.7).setRotation(target * Phaser.Math.Easing.Quadratic.In(t));
    img.setDepth(p.state === 'standing' ? 31 + p.y * 0.0001 : 25);
    const h = PAWN_SIZE * (1 - t) * 0.6;
    g.fillEllipse(p.x + LIGHT.x * h + 2, p.y + PAWN_R * 0.6 + LIGHT.y * h, 26, 12);
  }

  // ---- Title demo --------------------------------------------------------------------------

  /** Lays a spiral of dominoes with a few pawns round it for the title screen to topple on a loop. */
  private setDemo() {
    this.clearTable();
    this.fitTable(this.scale.height > this.scale.width);
    this.theme = THEMES[Phaser.Math.Between(0, THEMES.length - 1)];
    this.round = undefined;
    // A wavy line along the bottom of the table, below the title card, through two pawns.
    const y0 = this.th * 0.84;
    const amp = Math.min(46, this.th * 0.06);
    const wave = (x: number) => y0 + Math.sin((x / this.tw) * Math.PI * 3) * amp;
    for (const t of [0.36, 0.7]) this.table.addPawn(this.tw * t, wave(this.tw * t), Phaser.Math.Between(0, 6));
    const s = new Stroke({ table: this.table, id: 0, x: 40, y: wave(40), width: this.tw, height: this.th, face: () => Phaser.Math.Between(0, 27), budget: () => 999 });
    for (let x = 40; x < this.tw - 40; x += 2) s.to(x, wave(x));
    s.laid[0].stroke = -1;
    this.populate();
    this.demoIn = 1.2;
  }

  private runDemo(dt: number) {
    if (this.table.moving) return;
    this.demoIn -= dt;
    if (this.demoIn > 0) return;
    const start = this.table.pieces.find((p) => p.kind === 'domino' && p.stroke < 0);
    if (start?.state === 'standing') {
      this.table.push(start);
      this.toppled = 0;
      this.demoIn = 2;
    } else {
      this.demoIn = 99;
      this.rewind(() => (this.demoIn = 1));
    }
  }

  // ---- Effects -----------------------------------------------------------------------------

  private popup(x: number, y: number, text: string, color = '#ffe08a') {
    const s = this.k / this.zoom;
    const t = this.add.text(x, y, text, { ...TEXT, fontSize: '22px', color, strokeThickness: 6 }).setOrigin(0.5).setDepth(80);
    this.world.add(t);
    this.tweens.add({ targets: t, scale: { from: 0.3 * s, to: s }, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 40 / this.zoom, alpha: 0, duration: 600, delay: 450, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
  }

  /** A red ring pulsing round a pawn that was left standing. */
  private ring(x: number, y: number) {
    const g = this.add.graphics().setDepth(70);
    g.lineStyle(5, 0xff5a4a, 1).strokeCircle(0, 0, 30);
    g.setPosition(x, y);
    this.world.add(g);
    this.tweens.add({ targets: g, scale: { from: 1.6, to: 1 }, duration: 300, ease: 'Back.easeOut', yoyo: false });
    this.tweens.add({ targets: g, alpha: 0, duration: 400, delay: 1100, onComplete: () => g.destroy() });
  }

  private banner(title: string, sub?: string) {
    const { width: w, height: h } = this.scale;
    const k = this.k;
    const parts: Phaser.GameObjects.Text[] = [this.add.text(0, 0, title, { ...TEXT, fontSize: '60px', strokeThickness: 12 }).setOrigin(0.5)];
    if (sub) parts.push(this.add.text(0, 54, sub, { ...TEXT, fontFamily: FONT_BODY, fontSize: '26px', color: '#ffe08a', strokeThickness: 8 }).setOrigin(0.5));
    const c = this.add.container(w / 2, h * 0.42, parts).setScale(0);
    const widest = Math.max(...parts.map((p) => p.width)) + 20;
    const fit = Math.min(k, (w - 32) / widest);
    this.ui.add(c);
    this.tweens.add({ targets: c, scale: fit, duration: 380, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, alpha: 0, y: c.y - 30 * k, duration: 400, delay: 1500, onComplete: () => c.destroy() });
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
    this.overlay = this.add.container(0, 0, build());
    this.ui.add(this.overlay);
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
    g.fillStyle(0x1d2b33, 0.92).fillRoundedRect(-w / 2, y, w, h, 26);
    g.lineStyle(4, 0xe8d9b0, 1).strokeRoundedRect(-w / 2, y, w, h, 26);
    return g;
  }

  private showTitle() {
    this.state = 'title';
    this.roundText.setText('');
    this.scoreText.setVisible(false);
    this.livesImgs.forEach((i) => i.setVisible(false));
    this.setDemo();
    this.layout();
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.42);
      const shade = this.panel(660, this.best ? 390 : 350, -200);
      const title = this.add.text(0, -130, 'DOMINO CHAIN', { ...TEXT, fontSize: '60px', strokeThickness: 12 }).setOrigin(0.5);
      this.tweens.add({ targets: title, y: -136, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const body = { ...TEXT, fontFamily: FONT_BODY, fontSize: '22px', strokeThickness: 6 };
      const tag = this.add.text(0, -50, 'Draw dominoes through every pawn,\nthen tip the first one over.', { ...body, lineSpacing: 6 }).setOrigin(0.5);
      const tip = this.add.text(0, 6, 'Tight bends break the chain!', { ...body, fontSize: '20px', color: '#ffe08a' }).setOrigin(0.5);
      const play = this.button(0, 82, 'PLAY', () => this.startGame());
      const parts: Phaser.GameObjects.GameObject[] = [shade, title, tag, tip, ...play];
      if (this.best) parts.push(this.add.text(0, 158, `best ${group(this.best)}`, { ...TEXT, fontSize: '24px', color: '#ffe08a', strokeThickness: 7 }).setOrigin(0.5));
      card.add(parts);
      fitCard(card, this.k, w, 680, title);
      return [card];
    });
  }

  private showClear(animate: boolean) {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const rows = this.tally;
      const total = rows.reduce((sum, r) => sum + r[1], 0);
      const card = this.add.container(w / 2, h * 0.47);
      const title = this.add.text(0, -190, 'CLEARED!', { ...TEXT, fontSize: '56px', strokeThickness: 11 }).setOrigin(0.5);
      const top = -130;
      const panel = this.panel(440, 28 + rows.length * 40, top);
      const label = { ...TEXT, fontFamily: FONT_BODY, fontSize: '22px', color: '#d8e4ea', strokeThickness: 0, align: 'left' };
      const num = { ...TEXT, fontSize: '26px', color: '#ffe08a', strokeThickness: 0 };
      const lines: Phaser.GameObjects.Text[] = [];
      rows.forEach(([name, pts], i) => {
        const y = top + 34 + i * 40;
        lines.push(this.add.text(-190, y, name, label).setOrigin(0, 0.5));
        lines.push(this.add.text(190, y, `+${group(pts)}`, num).setOrigin(1, 0.5));
      });
      const totalY = top + 28 + rows.length * 40;
      const totalText = this.add.text(0, totalY + 44, `+${group(total)}`, { ...TEXT, fontSize: '44px', color: '#8cf08c', strokeThickness: 9 }).setOrigin(0.5);
      const next = this.button(0, totalY + 124, 'NEXT', () => this.nextRound());
      card.add([title, panel, ...lines, totalText, ...next]);
      fitCard(card, this.k, w, 480, title);
      if (!animate) {
        this.canContinue = true;
        return [card];
      }

      [...lines, totalText].forEach((t) => t.setAlpha(0));
      next.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
      this.tweens.add({ targets: title, scale: { from: 0, to: 1 }, duration: 400, ease: 'Back.easeOut' });
      for (let i = 0; i < rows.length; i++) {
        this.later(350 + i * 260, () => {
          lines[i * 2].setAlpha(1);
          lines[i * 2 + 1].setAlpha(1);
          this.tweens.add({ targets: lines[i * 2 + 1], scale: { from: 1.5, to: 1 }, duration: 220, ease: 'Back.easeOut' });
          playSfx(this, SFX, 'tick', { volume: 0.4 });
        });
      }
      const done = 350 + rows.length * 260 + 150;
      this.later(done, () => {
        totalText.setAlpha(1);
        this.tweens.add({ targets: totalText, scale: { from: 1.6, to: 1 }, duration: 300, ease: 'Back.easeOut' });
        playSfx(this, SFX, 'chip', { volume: 0.6 });
        this.bank();
      });
      this.later(done + 350, () => {
        next.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(true));
        this.canContinue = true;
        this.rebuildOverlay = () => this.showClear(false);
      });
      return [card];
    });
  }

  private showGameOver(record: boolean, animate: boolean) {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.46);
      const title = this.add.text(0, -170, 'GAME OVER', { ...TEXT, fontSize: '64px', strokeThickness: 12 }).setOrigin(0.5);
      const panel = this.panel(400, 210, -110);
      const label = { ...TEXT, fontSize: '22px', color: '#b8d4e0', strokeThickness: 0 };
      const big = { ...TEXT, fontSize: '52px', color: '#ffe08a', strokeThickness: 8 };
      const scoreLabel = this.add.text(0, -88, 'SCORE', label).setOrigin(0.5);
      const scoreNum = this.add.text(0, -40, animate ? '0' : group(this.score), big).setOrigin(0.5);
      const small = { ...big, fontSize: '32px', color: '#ffffff' };
      const bestLabel = this.add.text(-95, 22, 'BEST', label).setOrigin(0.5);
      const bestNum = this.add.text(-95, 60, group(this.best), small).setOrigin(0.5);
      const roundLabel = this.add.text(95, 22, 'ROUND', label).setOrigin(0.5);
      const roundNum = this.add.text(95, 60, `${this.round?.number ?? 1}`, small).setOrigin(0.5);
      const newTag = record ? this.add.text(150, -62, 'NEW!', { ...TEXT, fontSize: '26px', color: '#ff6b5e', stroke: '#ffffff', strokeThickness: 6 }).setOrigin(0.5).setAngle(14) : undefined;
      const again = this.button(0, 170, 'AGAIN', () => this.startGame());
      const parts = [title, panel, scoreLabel, scoreNum, bestLabel, bestNum, roundLabel, roundNum, newTag, ...again];
      card.add(parts.filter((p): p is NonNullable<typeof p> => !!p));
      fitCard(card, this.k, w, 460, title);
      if (!animate) {
        this.canContinue = true;
        return [card];
      }
      again.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
      newTag?.setVisible(false);
      this.tweens.add({ targets: title, y: { from: -360, to: -170 }, duration: 450, ease: 'Back.easeOut' });
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
        this.canContinue = true;
        this.rebuildOverlay = () => this.showGameOver(record, false);
      });
      return [card];
    });
  }
}

/** Fills the four-cornered shape through the given points, in order. */
function quad(g: Phaser.GameObjects.Graphics, ...xy: [number, number, number, number, number, number, number, number]) {
  g.beginPath().moveTo(xy[0], xy[1]).lineTo(xy[2], xy[3]).lineTo(xy[4], xy[5]).lineTo(xy[6], xy[7]).closePath().fillPath();
}

/** 12345 → "12,345". */
function group(n: number) {
  return n.toLocaleString('en-US');
}
