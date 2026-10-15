import * as Phaser from 'phaser';
import { FONT_BODY, FONT_HEADING } from '@shared/fonts';
import { preloadIcons } from '@shared/icons';
import { playSfx } from '@shared/phaser';
import { load, save, submitHighScore } from '@shared/storage';
import { fitCard, makeButton } from '@shared/ui';
import { SFX, STYLE, preloadAssets, styleKey, tileFrame, unpackAssets, type Voice } from './assets';
import { COLS, Dictionary, MIN_WORD, ROWS, Well, lengthBonus, type Cell, type Tile } from './board';
import WORDS from './words.txt?raw';

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#1f2a44',
  align: 'center',
};

/** Seconds between drops at level 1, each level's speed-up, and the fastest it gets. */
const DROP_START = 3;
const DROP_SPEEDUP = 0.9;
const DROP_FASTEST = 0.7;
/** The level stones start dropping from. */
const STONE_LEVEL = 4;
/** Words a level lasts. */
const WORDS_PER_LEVEL = 5;
const START_ROWS = 4;
const MIXES = 2;
/** A word this long earns a wildcard as the next drop. */
const WILD_LENGTH = 5;
/** Fall speed in tiles per second², and the most it reaches. */
const GRAVITY = 60;
const MAX_FALL = 26;
/** A pointer within this fraction of a tile from its centre counts as on it, so diagonals don't clip neighbours. */
const HIT = 0.43;

type State = 'title' | 'playing' | 'over';

interface Sprite {
  img: Phaser.GameObjects.Image;
  /** Where it's drawn, in rows up from the bottom; it falls towards its cell. */
  y: number;
  vy: number;
  /** The last column it was in, so a shuffle can slide it across. */
  x: number;
}

export class WellScene extends Phaser.Scene {
  private state: State = 'title';
  private dict!: Dictionary;
  private well = new Well();
  private sprites = new Map<Tile, Sprite>();

  /** Tile size and the bottom-left corner of the well, in screen pixels. */
  private size = 64;
  private left = 0;
  private bottom = 0;

  private back!: Phaser.GameObjects.Graphics;
  private halo!: Phaser.GameObjects.Graphics;
  private pill!: Phaser.GameObjects.Graphics;
  private pillText!: Phaser.GameObjects.Text;
  private pillScore!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private ghost!: Phaser.GameObjects.Image;
  private mixButton: Phaser.GameObjects.GameObject[] = [];
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private overlayTimers: Phaser.Time.TimerEvent[] = [];
  private music?: Phaser.Sound.BaseSound;

  private seenKeys = new WeakSet<KeyboardEvent>();
  private path: Cell[] = [];
  private typed = '';
  private dragging = false;
  private dragMoved = false;
  /** The press began on the last picked tile, so letting go there sends the word. */
  private pressOnLast = false;

  private score = 0;
  private best = 0;
  private words = 0;
  private longest = '';
  private level = 1;
  private mixes = MIXES;
  private dropIn = 0;
  private nextCol = 0;
  private nextWild = false;
  private canRestart = false;

  constructor() {
    super('well');
  }

  preload() {
    preloadAssets(this);
    preloadIcons(this);
  }

  create() {
    unpackAssets(this);
    this.dict = new Dictionary(WORDS);
    this.back = this.add.graphics().setDepth(0);
    this.halo = this.add.graphics().setDepth(12);
    this.ghost = this.add.image(0, 0, styleKey(STYLE.letter), 'tile.png').setAlpha(0.35).setDepth(4).setVisible(false);
    this.pill = this.add.graphics().setDepth(20);
    this.pillText = this.add.text(0, 0, '', { ...TEXT, fontSize: '34px', strokeThickness: 0, color: '#1f2a44' }).setOrigin(0.5).setDepth(21);
    this.pillScore = this.add.text(0, 0, '', { ...TEXT, fontSize: '20px', strokeThickness: 0, color: '#1f2a44' }).setOrigin(1, 0.5).setDepth(21);
    this.scoreText = this.add.text(0, 0, '0', { ...TEXT, fontSize: '36px', strokeThickness: 8 }).setOrigin(0.5, 0).setDepth(30);
    this.levelText = this.add.text(0, 0, '', { ...TEXT, fontSize: '18px', color: '#ffe08a', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(30);

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE,BACKSPACE');
      kb.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    }
    this.scale.on('resize', () => this.layout());

    this.best = load('word-drop:best', 0);
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
    const top = 150 * k;
    const below = 24 * k;
    this.size = Math.floor(Math.min((w - 24) / COLS, (h - top - below) / (ROWS + 1.1), 96));
    this.left = Math.round((w - this.size * COLS) / 2);
    this.bottom = Math.round(h - below);

    const s = this.size;
    const g = this.back.clear();
    const bw = s * COLS;
    const bh = s * (ROWS + 1);
    // The well: a dark pit with faint column lanes and a lip above the top row where drops wait.
    g.fillStyle(0x000000, 0.25).fillRoundedRect(this.left - 10, this.bottom - bh - 4, bw + 20, bh + 18, 18);
    g.fillStyle(0x1f2a44, 0.92).fillRoundedRect(this.left - 10, this.bottom - bh - 10, bw + 20, bh + 20, 18);
    for (let c = 0; c < COLS; c++) {
      g.fillStyle(0xffffff, c % 2 ? 0.035 : 0.06).fillRect(this.left + c * s, this.bottom - s * ROWS, s, s * ROWS);
    }
    g.lineStyle(3, 0xff6b5e, 0.5).lineBetween(this.left - 4, this.bottom - s * ROWS, this.left + bw + 4, this.bottom - s * ROWS);

    this.scoreText.setPosition(w / 2, 32 * k).setScale(k);
    this.levelText.setPosition(w / 2, 6 * k).setScale(k);
    this.buildMixButton();
    this.drawPill();
    this.rebuildOverlay?.();
  }

  /** Screen centre of a cell (rows can be fractional while falling). */
  private cellX(col: number) {
    return this.left + (col + 0.5) * this.size;
  }

  private cellY(row: number) {
    return this.bottom - (row + 0.5) * this.size;
  }

  private cellAt(x: number, y: number, strict: boolean): Cell | undefined {
    const col = Math.floor((x - this.left) / this.size);
    const row = Math.floor((this.bottom - y) / this.size);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return undefined;
    if (strict && Math.hypot(x - this.cellX(col), y - this.cellY(row)) > this.size * HIT) return undefined;
    return this.well.at({ col, row }) ? { col, row } : undefined;
  }

  private buildMixButton() {
    this.mixButton.forEach((o) => o.destroy());
    this.mixButton = [];
    if (this.state !== 'playing') return;
    const k = this.k;
    const { width: w } = this.scale;
    const label = `MIX ${this.mixes}`;
    const b = makeButton(this, w - 70 * k, 40 * k, label, () => this.mix(), {
      textStyle: TEXT, w: 112 * k, h: 50 * k, size: 22 * k, color: 0x7a5cd6, disabled: this.mixes <= 0,
      onPress: () => playSfx(this, SFX, 'click'),
    });
    b.parts.forEach((p) => (p as unknown as Phaser.GameObjects.Components.Depth).setDepth(30));
    this.mixButton = b.parts;
  }

  // ---- Game flow ---------------------------------------------------------------------------

  private startGame() {
    playSfx(this, SFX, 'click');
    this.setOverlay();
    this.clearSprites();
    this.well = new Well();
    this.well.fill(START_ROWS);
    for (const [i, t] of this.well.tiles.entries()) this.addSprite(t, ROWS + 1 + Math.floor(i / COLS) * 0.6);
    this.state = 'playing';
    this.score = 0;
    this.words = 0;
    this.longest = '';
    this.level = 1;
    this.mixes = MIXES;
    this.nextWild = false;
    this.canRestart = false;
    this.path = [];
    this.typed = '';
    this.dropIn = DROP_START + 1.5;
    this.pickColumn();
    this.scoreText.setText('0').setVisible(true);
    this.levelText.setText('LEVEL 1').setVisible(true);
    this.layout();
    this.voice('go');
    this.music ??= this.sound.add('music', { loop: true, volume: 0.25 });
    if (!this.music.isPlaying) this.music.play();
  }

  private get interval() {
    return Math.max(DROP_FASTEST, DROP_START * DROP_SPEEDUP ** (this.level - 1));
  }

  /** Chooses where the next tile drops, shown by a ghost tile over that column. */
  private pickColumn() {
    this.nextCol = Phaser.Math.Between(0, COLS - 1);
  }

  /** What the next drop will be: a wildcard if one was earned, now and then a stone or a red tile. */
  private nextTile(): Tile {
    if (this.nextWild) {
      this.nextWild = false;
      return this.well.make('wild');
    }
    const stoneChance = Math.min(0.2, Math.max(0, (this.level - STONE_LEVEL + 1) * 0.04));
    const roll = Math.random();
    if (roll < stoneChance) return this.well.make('stone');
    if (roll < stoneChance + 0.06) return this.well.make('double');
    return this.well.make();
  }

  private dropTile() {
    const col = this.nextCol;
    if (!this.well.hasRoom(col)) {
      this.overflow(col);
      return;
    }
    const tile = this.nextTile();
    // Picked cells above the landing spot stay valid: a drop only ever adds to the top.
    this.well.drop(col, tile);
    this.addSprite(tile, ROWS + 0.6);
    this.pickColumn();
    if (this.well.columns[this.nextCol].length >= ROWS - 1) playSfx(this, SFX, 'warn', { volume: 0.4 });
  }

  private overflow(col: number) {
    this.state = 'over';
    this.ghost.setVisible(false);
    this.clearPick();
    this.buildMixButton();
    this.music?.stop();
    this.voice('game_over');
    this.cameras.main.shake(300, 0.01);
    // The full column flashes red.
    for (const t of this.well.columns[col]) this.sprites.get(t)?.img.setTint(0xff8a80);
    const previous = this.best;
    const { best, isNew } = submitHighScore('word-drop', this.score);
    this.best = best;
    if (this.longest.length > load('word-drop:longest', '').length) save('word-drop:longest', this.longest);
    this.time.delayedCall(1100, () => this.showGameOver(isNew && previous > 0, true));
  }

  // ---- Picking -----------------------------------------------------------------------------

  private onDown(p: Phaser.Input.Pointer) {
    if (this.state !== 'playing') return;
    // The pill sends the word, so tap-by-tap players have something to press.
    if (this.path.length && this.pillHit(p.x, p.y)) {
      this.submit();
      return;
    }
    const cell = this.cellAt(p.x, p.y, false);
    this.dragging = true;
    this.dragMoved = false;
    this.pressOnLast = false;
    this.typed = '';
    if (!cell) {
      this.clearPick();
      return;
    }
    const last = this.path.at(-1);
    const index = this.path.findIndex((c) => same(c, cell));
    if (last && same(last, cell)) this.pressOnLast = true;
    else if (index >= 0) this.setPath(this.path.slice(0, index + 1));
    else if (this.well.canExtend(this.path, cell)) this.setPath([...this.path, cell]);
    else if (this.well.canExtend([], cell)) this.setPath([cell]);
  }

  private onMove(p: Phaser.Input.Pointer) {
    if (!this.dragging || !p.isDown || this.state !== 'playing') return;
    const cell = this.cellAt(p.x, p.y, true);
    if (!cell) return;
    const last = this.path.at(-1);
    if (last && same(last, cell)) return;
    const prev = this.path.at(-2);
    if (prev && same(prev, cell)) {
      this.dragMoved = true;
      this.setPath(this.path.slice(0, -1));
    } else if (this.well.canExtend(this.path, cell)) {
      this.dragMoved = true;
      this.setPath([...this.path, cell]);
    }
  }

  private onUp() {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.state !== 'playing') return;
    // A swipe across tiles sends the word on release; taps build it a tile at a time.
    if (this.dragMoved) {
      if (this.path.length >= MIN_WORD) this.submit();
      else this.clearPick();
    } else if (this.pressOnLast) {
      if (this.path.length >= MIN_WORD) this.submit();
      else this.setPath(this.path.slice(0, -1));
    }
  }

  /** Typing finds the letters on the board; Enter sends, Backspace takes one back, Escape clears. */
  private onKey(e: KeyboardEvent) {
    // Phaser 4 replays every key event queued this frame each time a new one arrives, so fast
    // typing (several events inside one frame) delivers the same event again. Take each once.
    if (this.seenKeys.has(e)) return;
    this.seenKeys.add(e);
    if (this.state !== 'playing') {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && (this.state === 'title' || this.canRestart)) this.startGame();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (this.path.length) this.submit();
      return;
    }
    if (e.key === 'Escape') {
      this.clearPick();
      return;
    }
    if (e.key === 'Backspace') {
      this.typed = this.well.spell(this.path).slice(0, -1);
      this.setPath(this.path.slice(0, -1));
      return;
    }
    if (!/^[a-zA-Z]$/.test(e.key)) return;
    const typed = (this.typed || this.well.spell(this.path)) + e.key.toUpperCase();
    const path = this.well.pathFor(typed, this.path);
    if (!path) {
      playSfx(this, SFX, 'wrong', { volume: 0.3 });
      this.shakePill();
      return;
    }
    this.typed = typed;
    this.setPath(path);
  }

  private setPath(path: Cell[]) {
    const grew = path.length > this.path.length;
    const shrank = path.length < this.path.length;
    this.path = path;
    if (grew) playSfx(this, SFX, 'pick', { volume: 0.4, detune: (path.length - 1) * 100 - 200 });
    if (shrank) playSfx(this, SFX, 'unpick', { volume: 0.3 });
    if (!path.length) this.typed = '';
    this.drawPill();
  }

  private clearPick() {
    this.setPath([]);
    this.typed = '';
  }

  private get word() {
    return this.path.length >= MIN_WORD ? this.dict.match(this.well.spell(this.path)) : undefined;
  }

  private submit() {
    const word = this.word;
    if (!word) {
      playSfx(this, SFX, 'wrong', { volume: 0.5 });
      this.shakePill();
      this.path.forEach((c) => {
        const s = this.sprites.get(this.well.at(c)!);
        if (s) this.tweens.add({ targets: s.img, angle: { from: -10, to: 0 }, duration: 300, ease: 'Elastic.easeOut' });
      });
      this.time.delayedCall(120, () => this.clearPick());
      return;
    }
    const path = this.path;
    const tiles = path.map((c) => this.well.at(c)!);
    const midX = path.reduce((s, c) => s + this.cellX(c.col), 0) / path.length;
    const midY = path.reduce((s, c) => s + this.cellY(c.row), 0) / path.length;
    const result = this.well.clear(path, word);
    this.path = [];
    this.typed = '';
    this.score += result.score;
    this.words++;
    if (word.length > this.longest.length) this.longest = word;
    this.scoreText.setText(group(this.score));
    this.tweens.add({ targets: this.scoreText, scale: { from: 1.25 * this.k, to: this.k }, duration: 250, ease: 'Back.easeOut' });

    tiles.forEach((t, i) => this.time.delayedCall(i * 45, () => this.burst(t, i)));
    for (const s of result.stones) this.time.delayedCall(tiles.length * 45, () => this.smash(s));
    playSfx(this, SFX, 'word', { volume: 0.5, detune: 0 });
    this.popup(midX, midY, `+${group(result.score)}`, word.toUpperCase());
    if (word.length >= WILD_LENGTH) {
      this.nextWild = true;
      this.time.delayedCall(400, () => {
        playSfx(this, SFX, 'wild', { volume: 0.5, detune: 0 });
        this.voice('power_up');
      });
    }
    if (word.length >= 7 && this.mixes < 3) {
      this.mixes++;
      this.buildMixButton();
    }
    const level = 1 + Math.floor(this.words / WORDS_PER_LEVEL);
    if (level > this.level) {
      this.level = level;
      this.levelText.setText(`LEVEL ${level}`);
      this.time.delayedCall(500, () => {
        this.banner(`LEVEL ${level}`, level === STONE_LEVEL ? 'stones! make words next to them' : 'faster!');
        playSfx(this, SFX, 'level', { volume: 0.5, detune: 0 });
        this.voice('level_up');
      });
    }
    this.drawPill();
  }

  private mix() {
    if (this.state !== 'playing' || this.mixes <= 0) return;
    this.mixes--;
    this.clearPick();
    this.well.shuffle();
    playSfx(this, SFX, 'mix', { volume: 0.5 });
    // Every tile slides from where it was to its new cell.
    for (let col = 0; col < COLS; col++) {
      this.well.columns[col].forEach((t, row) => {
        const s = this.sprites.get(t);
        if (!s) return;
        s.y = row;
        this.tweens.add({ targets: s, x: col, duration: 320, ease: 'Cubic.easeInOut' });
      });
    }
    this.buildMixButton();
  }

  // ---- Sprites -----------------------------------------------------------------------------

  private addSprite(t: Tile, startRow: number) {
    const [key, frame] = tileFrame(t, false, false);
    const img = this.add.image(0, 0, key, frame).setDepth(10);
    const cell = this.well.find(t)!;
    this.sprites.set(t, { img, y: startRow, vy: 0, x: cell.col });
  }

  private clearSprites() {
    for (const s of this.sprites.values()) s.img.destroy();
    this.sprites.clear();
  }

  /** A cleared tile pops out: it swells, spins a little and fades, with a little sound up the scale. */
  private burst(t: Tile, i: number) {
    const s = this.sprites.get(t);
    this.sprites.delete(t);
    if (!s) return;
    playSfx(this, SFX, 'pop', { volume: 0.35, detune: i * 120 - 200 });
    s.img.setDepth(15);
    this.tweens.add({
      targets: s.img, scale: s.img.scale * 1.5, alpha: 0, angle: Phaser.Math.Between(-30, 30), duration: 260, ease: 'Cubic.easeOut',
      onComplete: () => s.img.destroy(),
    });
  }

  private smash(t: Tile) {
    const s = this.sprites.get(t);
    this.sprites.delete(t);
    if (!s) return;
    playSfx(this, SFX, 'stone', { volume: 0.5 });
    this.cameras.main.shake(120, 0.004);
    const x = s.img.x;
    const y = s.img.y;
    // Four quarters of the block tumble away.
    for (let i = 0; i < 4; i++) {
      const sx = i % 2;
      const sy = Math.floor(i / 2);
      const piece = this.add.image(x, y, s.img.texture.key, s.img.frame.name).setDepth(16).setScale(s.img.scale);
      const fw = s.img.frame.width / 2;
      piece.setCrop(sx * fw, sy * fw, fw, fw);
      this.tweens.add({
        targets: piece, x: x + (sx ? 1 : -1) * this.size * 0.8, y: y + this.size * 1.2, angle: (sx ? 1 : -1) * 120, alpha: 0,
        duration: 500, ease: 'Quad.easeIn', onComplete: () => piece.destroy(),
      });
    }
    s.img.destroy();
  }

  // ---- Frame loop --------------------------------------------------------------------------

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 20);
    if (this.state === 'playing') {
      this.dropIn -= dt;
      if (this.dropIn <= 0) {
        this.dropIn += this.interval;
        this.dropTile();
      }
    }
    this.fall(dt);
    this.draw();
  }

  /** Each tile falls under gravity to its cell, with a small bounce and a knock when it lands hard. */
  private fall(dt: number) {
    for (let col = 0; col < COLS; col++) {
      this.well.columns[col].forEach((t, row) => {
        const s = this.sprites.get(t);
        if (!s || s.y <= row) {
          if (s) s.y = row;
          return;
        }
        s.vy = Math.min(MAX_FALL, s.vy + GRAVITY * dt);
        s.y -= s.vy * dt;
        if (s.y <= row) {
          s.y = row;
          if (s.vy > 6) {
            playSfx(this, SFX, 'land', { volume: Math.min(0.5, s.vy / 40) });
            this.tweens.add({ targets: s.img, scaleY: { from: s.img.scaleY * 0.85, to: s.img.scaleY }, duration: 140, ease: 'Back.easeOut' });
          }
          s.vy = 0;
        }
      });
    }
  }

  private draw() {
    const valid = !!this.word;
    const scale = (this.size / 128) * 0.96;
    const picked = new Set(this.path.map((c) => this.well.at(c)));
    for (const [t, s] of this.sprites) {
      const [key, frame] = tileFrame(t, picked.has(t), valid);
      if (s.img.texture.key !== key || s.img.frame.name !== frame) s.img.setTexture(key, frame);
      const lift = picked.has(t) ? 1.08 : 1;
      if (!this.tweens.isTweening(s.img)) s.img.setScale(scale * lift);
      s.img.setPosition(this.cellX(s.x), this.cellY(s.y));
    }

    // A line threading the picked tiles in order.
    const g = this.halo.clear();
    if (this.path.length > 1) {
      g.lineStyle(this.size * 0.09, valid ? 0x1e8e4e : 0x8a6a4a, 0.5);
      g.beginPath();
      this.path.forEach((c, i) => (i ? g.lineTo(this.cellX(c.col), this.cellY(c.row)) : g.moveTo(this.cellX(c.col), this.cellY(c.row))));
      g.strokePath();
    }

    // The ghost over the next column, pulsing faster as the drop comes.
    const showGhost = this.state === 'playing';
    this.ghost.setVisible(showGhost);
    if (showGhost) {
      const near = 1 - Math.min(1, this.dropIn / this.interval);
      const full = this.well.columns[this.nextCol].length >= ROWS;
      this.ghost.setTexture(styleKey(full ? STYLE.stone : STYLE.letter), full ? 'tile_warning.png' : 'tile.png');
      this.ghost.setPosition(this.cellX(this.nextCol), this.cellY(ROWS) + Math.sin(this.time.now / 160) * 3).setScale(scale * (0.8 + near * 0.15)).setAlpha(0.25 + near * 0.5);
    }
  }

  // ---- Word pill ---------------------------------------------------------------------------

  private pillBounds() {
    const w = Math.min(this.size * COLS, 520 * this.k);
    const h = 54 * this.k;
    return { x: this.scale.width / 2 - w / 2, y: this.bottom - this.size * (ROWS + 1) - 20 - h, w, h };
  }

  private pillHit(x: number, y: number) {
    const b = this.pillBounds();
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }

  private drawPill() {
    const g = this.pill.clear();
    const show = this.state === 'playing' && this.path.length > 0;
    this.pillText.setVisible(show);
    this.pillScore.setVisible(show);
    if (!show) return;
    const b = this.pillBounds();
    const word = this.word;
    const fill = word ? 0x2ecc71 : 0xfff3d6;
    g.fillStyle(0x000000, 0.25).fillRoundedRect(b.x, b.y + 5, b.w, b.h, b.h / 2);
    g.fillStyle(fill).fillRoundedRect(b.x, b.y, b.w, b.h, b.h / 2);
    const letters = this.well.spell(this.path).replace(/\?/g, '★');
    this.pillText.setText(word ? word.toUpperCase() : letters).setColor(word ? '#ffffff' : '#1f2a44').setPosition(b.x + b.w / 2, b.y + b.h / 2);
    this.pillText.setScale(Math.min(this.k, (b.w - 110 * this.k) / Math.max(1, this.pillText.width / this.pillText.scaleX)));
    this.pillScore.setText(word ? `+${group(this.well.score(this.path))}` : this.path.length < MIN_WORD ? '' : `×${lengthBonus(this.path.length)}`);
    this.pillScore.setColor(word ? '#ffffff' : '#7a8a94').setPosition(b.x + b.w - 18 * this.k, b.y + b.h / 2).setScale(this.k);
  }

  private shakePill() {
    const x = this.pillText.x;
    this.tweens.add({ targets: this.pillText, x: { from: x - 10, to: x }, duration: 300, ease: 'Elastic.easeOut' });
  }

  // ---- Effects -----------------------------------------------------------------------------

  private popup(x: number, y: number, text: string, word: string) {
    const k = this.k;
    const c = this.add.container(x, y, [
      this.add.text(0, -18, word, { ...TEXT, fontSize: '30px', strokeThickness: 8 }).setOrigin(0.5),
      this.add.text(0, 16, text, { ...TEXT, fontSize: '26px', color: '#ffe08a', strokeThickness: 7 }).setOrigin(0.5),
    ]).setDepth(40);
    this.tweens.add({ targets: c, scale: { from: 0.3 * k, to: k }, duration: 240, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, y: y - 50 * k, alpha: 0, duration: 600, delay: 600, ease: 'Cubic.easeIn', onComplete: () => c.destroy() });
  }

  private banner(title: string, sub?: string) {
    const { width: w, height: h } = this.scale;
    const k = this.k;
    const parts: Phaser.GameObjects.Text[] = [this.add.text(0, 0, title, { ...TEXT, fontSize: '56px', strokeThickness: 12 }).setOrigin(0.5)];
    if (sub) parts.push(this.add.text(0, 50, sub, { ...TEXT, fontFamily: FONT_BODY, fontSize: '24px', color: '#ffe08a', strokeThickness: 7 }).setOrigin(0.5));
    const c = this.add.container(w / 2, h * 0.4, parts).setScale(0).setDepth(50);
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
    g.fillStyle(0x1f2a44, 0.95).fillRoundedRect(-w / 2, y, w, h, 26);
    g.lineStyle(4, 0xc8955a, 1).strokeRoundedRect(-w / 2, y, w, h, 26);
    return g;
  }

  /** The title spells WORD DROP in tiles dropping into the well, then shows the card over it. */
  private showTitle() {
    this.state = 'title';
    this.scoreText.setVisible(false);
    this.levelText.setVisible(false);
    this.clearSprites();
    this.well = new Well();
    const spell = (word: string, row: number) => [...word].forEach((l, i) => {
      const col = i + Math.floor((COLS - word.length) / 2);
      while (this.well.columns[col].length < row) this.well.drop(col, this.well.make());
      const t: Tile = { ...this.well.make(), letter: l };
      this.well.drop(col, t);
      this.addSprite(t, ROWS + 2 + i * 0.8 + row * 2);
    });
    spell('DROP', 0);
    spell('WORD', 1);
    for (const t of this.well.tiles) if (!this.sprites.has(t)) this.addSprite(t, ROWS + 1 + Math.random() * 3);
    this.layout();
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.36);
      const shade = this.panel(600, this.best ? 330 : 300, -150);
      const title = this.add.text(0, -96, 'WORD DROP', { ...TEXT, fontSize: '64px', strokeThickness: 12 }).setOrigin(0.5);
      const body = { ...TEXT, fontFamily: FONT_BODY, fontSize: '21px', strokeThickness: 6 };
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const how = touch ? 'Swipe through touching letters' : 'Drag through touching letters, or type,';
      const tag = this.add.text(0, -22, `${how}\nto spell words. Don't let it overflow!`, { ...body, lineSpacing: 6 }).setOrigin(0.5);
      const play = this.button(0, 70, 'PLAY', () => this.startGame());
      const parts: Phaser.GameObjects.GameObject[] = [shade, title, tag, ...play];
      if (this.best) parts.push(this.add.text(0, 140, `best ${group(this.best)}`, { ...TEXT, fontSize: '24px', color: '#ffe08a', strokeThickness: 7 }).setOrigin(0.5));
      card.add(parts);
      fitCard(card, this.k, w, 640, title);
      return [card];
    });
  }

  private showGameOver(record: boolean, animate: boolean) {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const card = this.add.container(w / 2, h * 0.44);
      const title = this.add.text(0, -190, 'OVERFLOW!', { ...TEXT, fontSize: '60px', strokeThickness: 12 }).setOrigin(0.5);
      const panel = this.panel(420, 280, -130);
      const label = { ...TEXT, fontSize: '20px', color: '#c8b8e8', strokeThickness: 0 };
      const big = { ...TEXT, fontSize: '52px', color: '#ffe08a', strokeThickness: 8 };
      const small = { ...big, fontSize: '30px', color: '#ffffff' };
      const scoreLabel = this.add.text(0, -108, 'SCORE', label).setOrigin(0.5);
      const scoreNum = this.add.text(0, -62, animate ? '0' : group(this.score), big).setOrigin(0.5);
      const bestLabel = this.add.text(-100, -4, 'BEST', label).setOrigin(0.5);
      const bestNum = this.add.text(-100, 32, group(this.best), small).setOrigin(0.5);
      const wordsLabel = this.add.text(100, -4, 'WORDS', label).setOrigin(0.5);
      const wordsNum = this.add.text(100, 32, `${this.words}`, small).setOrigin(0.5);
      const longLabel = this.add.text(0, 68, 'LONGEST', label).setOrigin(0.5);
      const longWord = this.add.text(0, 100, this.longest ? this.longest.toUpperCase() : '-', { ...small, fontSize: '26px' }).setOrigin(0.5);
      const newTag = record ? this.add.text(160, -84, 'NEW!', { ...TEXT, fontSize: '26px', color: '#ff6b5e', stroke: '#ffffff', strokeThickness: 6 }).setOrigin(0.5).setAngle(14) : undefined;
      const again = this.button(0, 214, 'AGAIN', () => this.startGame());
      const parts = [title, panel, scoreLabel, scoreNum, bestLabel, bestNum, wordsLabel, wordsNum, longLabel, longWord, newTag, ...again];
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

function same(a: Cell, b: Cell) {
  return a.col === b.col && a.row === b.row;
}

/** 12345 → "12,345". */
function group(n: number) {
  return n.toLocaleString('en-US');
}
