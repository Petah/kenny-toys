import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { FRAMES, SFX, type Voice } from './assets';
import { LEVELS, type Level } from './levels';
import { coinsFor, loadProgress, recordClear } from './progress';
import { Sokoban, STEP, parseLevel, type Dir, type MoveResult } from './sokoban';
import { TEXT, button, coinRow } from './ui';

const TILE = 64;
const STEP_MS = 120;

const KEYS: Record<string, Dir> = {
  LEFT: 'left', RIGHT: 'right', UP: 'up', DOWN: 'down',
  A: 'left', D: 'right', W: 'up', S: 'down',
};

/** First-time tips, shown under the board on the level that introduces each idea. */
const TIPS: Record<number, string> = {
  0: 'Arrow keys, WASD, swipe or tap to move',
  1: 'Stuck? UNDO takes back a move',
  5: 'Crates only count on a spot of their own colour',
};

export class LevelScene extends Phaser.Scene {
  private levelIndex = 0;
  private level!: Level;
  private puzzle!: Sokoban;
  private board!: Phaser.GameObjects.Container;
  private player!: Phaser.GameObjects.Sprite;
  private crates: Phaser.GameObjects.Image[] = [];
  private facing: Dir = 'down';
  private busy = false;
  private won = false;
  private queue: Dir[] = [];
  private keys: { key: Phaser.Input.Keyboard.Key; dir: Dir }[] = [];
  private press?: { x: number; y: number };
  private lastBump = 0;

  private title!: Phaser.GameObjects.Text;
  private movesText!: Phaser.GameObjects.Text;
  private tip?: Phaser.GameObjects.Text;
  private buttons!: Phaser.GameObjects.Container;
  private undoButton!: Phaser.GameObjects.Container;
  private panel?: Phaser.GameObjects.Container;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('level');
  }

  init(data: { level?: number }) {
    this.levelIndex = Phaser.Math.Clamp(data.level ?? 0, 0, LEVELS.length - 1);
    this.level = LEVELS[this.levelIndex];
    this.puzzle = new Sokoban(parseLevel(this.level.rows));
    this.crates = [];
    this.facing = 'down';
    this.busy = false;
    this.won = false;
    this.queue = [];
    this.panel = undefined;
    this.tip = undefined;
  }

  create() {
    this.cameras.main.fadeIn(180, 78, 91, 102);
    this.buildBoard();
    this.buildHud();
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));

    const keyboard = this.input.keyboard!;
    this.keys = Object.entries(KEYS).map(([name, dir]) => ({ key: keyboard.addKey(name), dir }));
    for (const { key, dir } of this.keys) key.on('down', () => this.request(dir));
    keyboard.on('keydown-Z', () => this.undo());
    keyboard.on('keydown-U', () => this.undo());
    keyboard.on('keydown-BACKSPACE', () => this.undo());
    keyboard.on('keydown-R', () => this.restart());
    keyboard.on('keydown-ESC', () => this.toMenu());
    keyboard.on('keydown-ENTER', () => this.won && this.next());
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => (this.press = { x: p.x, y: p.y }));
    this.input.on('pointerup', this.onPointerUp, this);

    const music = this.sound.get('music') ?? this.sound.add('music', { loop: true, volume: 0.18 });
    if (!music.isPlaying) music.play();
    this.intro();
  }

  // ---- Board -------------------------------------------------------------------------------------

  private cell(pos: number) {
    const { width } = this.puzzle.board;
    return { x: (pos % width) * TILE + TILE / 2, y: Math.floor(pos / width) * TILE + TILE / 2 };
  }

  private buildBoard() {
    const { board } = this.puzzle;
    const { theme } = this.level;
    this.board = this.add.container(0, 0);
    const shadow = this.add.graphics().fillStyle(0x000000, 0.22);
    const below: Phaser.GameObjects.GameObject[] = [shadow];
    const walls: Phaser.GameObjects.GameObject[] = [];

    for (let pos = 0; pos < board.width * board.height; pos++) {
      const { x, y } = this.cell(pos);
      if (board.floor.has(pos)) {
        below.push(this.add.image(x, y, 'soko', FRAMES.ground[theme]));
        const target = board.targets.get(pos);
        if (target) {
          const mark = this.add.image(x, y, 'soko', FRAMES.target[target]).setScale(1.5);
          this.tweens.add({ targets: mark, scale: 1.8, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut', delay: (pos * 97) % 700 });
          below.push(mark);
        }
      } else if (board.walls.has(pos) && this.touchesFloor(pos)) {
        shadow.fillRect(x - TILE / 2 + 5, y - TILE / 2 + 7, TILE, TILE);
        walls.push(this.add.image(x, y, 'soko', FRAMES.wall[theme]));
      }
    }

    this.crates = board.crates.map(({ pos, color }) => {
      const { x, y } = this.cell(pos);
      return this.add.image(x, y, 'soko', FRAMES.crate[color]);
    });
    const start = this.cell(this.puzzle.player);
    this.player = this.add.sprite(start.x, start.y - 4, 'soko', FRAMES.player.down[0]);

    this.dust = this.add.particles(0, 0, 'puff', {
      lifespan: { min: 300, max: 550 },
      speed: { min: 15, max: 60 },
      scale: { start: 0.05, end: 0.14 },
      alpha: { start: 0.55, end: 0 },
      rotate: { min: 0, max: 360 },
      emitting: false,
    });
    this.sparkles = this.add.particles(0, 0, 'sparkle', {
      lifespan: { min: 400, max: 700 },
      speed: { min: 80, max: 200 },
      scale: { start: 0.09, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: [0xffe27a, 0xffffff, 0xfff3b0],
      emitting: false,
    });

    this.board.add([...below, ...walls, this.dust, ...this.crates, this.player, this.sparkles]);
    this.puzzle.crates.forEach((_, i) => this.puzzle.isHome(i) && this.crates[i].setFrame(FRAMES.crateHome[board.crates[i].color]));
  }

  private touchesFloor(pos: number) {
    const { width, floor } = this.puzzle.board;
    const x = pos % width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || x + dx >= width) continue;
        if (floor.has(pos + dy * width + dx)) return true;
      }
    }
    return false;
  }

  // ---- HUD and layout -------------------------------------------------------------------------------

  private buildHud() {
    this.title = this.add.text(0, 0, `${this.levelIndex + 1}. ${this.level.name}`, { ...TEXT, fontSize: '34px', strokeThickness: 8 }).setOrigin(0.5);
    this.movesText = this.add.text(0, 0, '', { ...TEXT, fontSize: '24px', strokeThickness: 6, color: '#ffe27a' }).setOrigin(0.5);
    this.updateMoves();

    this.undoButton = button(this, 'UNDO', () => this.undo(), { w: 150, h: 64, size: 26, color: 0x3d7fb8 });
    const reset = button(this, 'RESET', () => this.restart(), { w: 150, h: 64, size: 26, color: 0x3d7fb8 });
    const menu = button(this, '☰', () => this.toMenu(), { w: 72, h: 64, size: 30, color: 0x3d7fb8 });
    this.undoButton.setPosition(-120, 0);
    reset.setPosition(50, 0);
    menu.setPosition(180, 0);
    this.buttons = this.add.container(0, 0, [this.undoButton, reset, menu]);

    const tip = TIPS[this.levelIndex];
    if (tip) this.tip = this.add.text(0, 0, tip, { ...TEXT, fontSize: '22px', strokeThickness: 5, color: '#ffe27a' }).setOrigin(0.5);
  }

  /** Fits the HUD and board to the page; runs again whenever it resizes. */
  private layout() {
    const { width, height } = this.scale;
    const ui = Phaser.Math.Clamp(Math.min(width, height) / 640, 0.6, 1);
    // Narrow screens put the title under the "All toys" link instead of beside it.
    const top = width < 700 ? 56 : 8;
    this.title.setScale(ui).setPosition(width / 2, top + 24 * ui);
    this.movesText.setScale(ui).setPosition(width / 2, top + 68 * ui);
    this.buttons.setScale(ui).setPosition(width / 2, height - 46 * ui);
    const tipH = this.tip ? 40 * ui : 0;
    this.tip?.setScale(ui).setPosition(width / 2, height - 104 * ui);

    const areaTop = top + 98 * ui;
    const areaBottom = height - 90 * ui - tipH;
    const { width: cols, height: rows } = this.puzzle.board;
    const scale = Math.min((width - 24) / (cols * TILE), (areaBottom - areaTop) / (rows * TILE), 1.5);
    this.board.setScale(scale).setPosition(width / 2 - (cols * TILE * scale) / 2, (areaTop + areaBottom) / 2 - (rows * TILE * scale) / 2);

    if (this.panel) this.placePanel(this.panel);
  }

  private updateMoves() {
    const best = loadProgress().best[this.levelIndex];
    this.movesText.setText(`moves ${this.puzzle.moves}   par ${this.level.par}${best ? `   best ${best}` : ''}`);
  }

  // ---- Input ------------------------------------------------------------------------------------------

  /** A move asked for by a key or swipe: done now if idle, otherwise queued (but only one ahead). */
  private request(dir: Dir) {
    if (this.won) return;
    if (this.busy) {
      if (this.queue.length < 1) this.queue.push(dir);
      return;
    }
    this.queue = [];
    this.go(dir);
  }

  private onPointerUp(p: Phaser.Input.Pointer) {
    if (!this.press || this.won) return;
    const dx = p.x - this.press.x;
    const dy = p.y - this.press.y;
    this.press = undefined;
    if (Math.hypot(dx, dy) > 28) {
      this.request(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
      return;
    }

    // A tap: push the crate next to you, or walk to the tapped square.
    const scale = this.board.scaleX;
    const tx = Math.floor((p.x - this.board.x) / scale / TILE);
    const ty = Math.floor((p.y - this.board.y) / scale / TILE);
    const { width, height } = this.puzzle.board;
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return;
    const pos = ty * width + tx;
    const next = (Object.keys(STEP) as Dir[]).find((d) => this.puzzle.neighbour(this.puzzle.player, d) === pos);
    if (next && this.puzzle.crateAt(pos) >= 0) {
      this.request(next);
      return;
    }
    const path = this.puzzle.pathTo(pos);
    if (!path?.length) return;
    this.queue = path;
    if (!this.busy) this.go(this.queue.shift()!);
  }

  update() {
    if (this.busy || this.won || this.queue.length) return;
    // Holding a key keeps walking once the first step is done.
    const held = this.keys.find(({ key }) => key.isDown && key.getDuration() > 170);
    if (held) this.go(held.dir);
  }

  // ---- Moving ---------------------------------------------------------------------------------------

  private go(dir: Dir) {
    const wasHome = this.puzzle.crates.map((_, i) => this.puzzle.isHome(i));
    const result = this.puzzle.move(dir);
    this.face(dir);
    if (result.kind === 'blocked') {
      this.bump(result);
      return;
    }

    this.busy = true;
    this.player.play(`walk-${dir}`, true);
    const to = this.cell(result.to);
    this.tweens.add({ targets: this.player, x: to.x, y: to.y - 4, duration: STEP_MS, onComplete: () => this.stepDone() });
    playSfx(this, SFX, 'step', { volume: 0.25 });

    if (result.kind === 'push') {
      const crate = this.crates[result.crate];
      const dest = this.cell(result.crateTo);
      this.tweens.add({ targets: crate, x: dest.x, y: dest.y, duration: STEP_MS });
      playSfx(this, SFX, 'push', { volume: 0.4 });
      // Dust kicks up from the crate's back edge.
      const [sx, sy] = STEP[dir];
      this.dust.emitParticleAt(crate.x - sx * 26, crate.y - sy * 26 + 10, 3);
      this.time.delayedCall(STEP_MS, () => this.settle(result.crate, wasHome[result.crate]));
    }
    this.updateMoves();
  }

  private stepDone() {
    this.busy = false;
    if (this.puzzle.solved) {
      this.win();
      return;
    }
    const next = this.queue.shift();
    if (next) {
      this.go(next);
      return;
    }
    const held = this.keys.find(({ key }) => key.isDown && key.getDuration() > 170);
    if (held) {
      this.go(held.dir);
      return;
    }
    this.player.stop();
    this.face(this.facing);
  }

  /** After a push: light the crate up if it just landed home, dim it if it just left. */
  private settle(i: number, wasHome: boolean) {
    const home = this.puzzle.isHome(i);
    const { color } = this.puzzle.board.crates[i];
    const crate = this.crates[i];
    crate.setFrame(home ? FRAMES.crateHome[color] : FRAMES.crate[color]);
    if (home && !wasHome) {
      playSfx(this, SFX, 'home', { volume: 0.5 });
      this.sparkles.emitParticleAt(crate.x, crate.y, 10);
      this.tweens.add({ targets: crate, scale: { from: 1.18, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    } else if (!home && wasHome) {
      playSfx(this, SFX, 'unhome', { volume: 0.35 });
    }
  }

  private bump(result: Extract<MoveResult, { kind: 'blocked' }>) {
    this.queue = [];
    if (this.time.now - this.lastBump < 220) return;
    this.lastBump = this.time.now;
    playSfx(this, SFX, 'bump', { volume: 0.3 });
    const [sx, sy] = STEP[result.dir];
    const home = this.cell(this.puzzle.player);
    this.tweens.add({ targets: this.player, x: home.x + sx * 6, y: home.y - 4 + sy * 6, duration: 60, yoyo: true });
    if (result.crate !== undefined) {
      const crate = this.crates[result.crate];
      this.tweens.add({ targets: crate, angle: { from: -4, to: 4 }, duration: 50, yoyo: true, repeat: 1, onComplete: () => crate.setAngle(0) });
    }
  }

  private face(dir: Dir) {
    this.facing = dir;
    if (!this.player.anims.isPlaying) this.player.setFrame(FRAMES.player[dir][0]);
  }

  private undo() {
    if (this.won || this.busy || !this.puzzle.undo()) return;
    this.queue = [];
    playSfx(this, SFX, 'undo', { volume: 0.4 });
    this.snapToState();
    this.updateMoves();
  }

  /** Slides every sprite to where the puzzle says it is (after an undo). */
  private snapToState() {
    const p = this.cell(this.puzzle.player);
    this.tweens.add({ targets: this.player, x: p.x, y: p.y - 4, duration: 90 });
    this.puzzle.crates.forEach((pos, i) => {
      const c = this.cell(pos);
      const { color } = this.puzzle.board.crates[i];
      this.crates[i].setFrame(this.puzzle.isHome(i) ? FRAMES.crateHome[color] : FRAMES.crate[color]);
      this.tweens.add({ targets: this.crates[i], x: c.x, y: c.y, duration: 90 });
    });
  }

  // ---- Flow --------------------------------------------------------------------------------------------

  private intro() {
    const { width, height } = this.scale;
    const ui = Phaser.Math.Clamp(Math.min(width, height) / 640, 0.6, 1);
    const banner = this.add
      .text(width / 2, height / 2, `LEVEL ${this.levelIndex + 1}`, { ...TEXT, fontSize: '84px', strokeThickness: 14 })
      .setOrigin(0.5)
      .setScale(0)
      .setDepth(70);
    this.tweens.chain({
      targets: banner,
      tweens: [
        { scale: ui, duration: 350, ease: 'Back.easeOut' },
        { alpha: 0, scale: ui * 1.2, duration: 300, delay: 550, onComplete: () => banner.destroy() },
      ],
    });
    if (this.levelIndex < 10) {
      this.voice('level');
      this.time.delayedCall(500, () => this.voice(String(this.levelIndex + 1) as Voice));
    }
  }

  private win() {
    this.won = true;
    this.queue = [];
    this.player.stop();
    this.player.setFrame(FRAMES.player.down[0]);
    this.tweens.add({ targets: this.player, y: this.player.y - 18, duration: 180, yoyo: true, repeat: 2, ease: 'Quad.easeOut' });
    this.crates.forEach((crate, i) => {
      this.tweens.add({ targets: crate, y: crate.y - 10, duration: 140, yoyo: true, delay: 120 + i * 90, ease: 'Quad.easeOut' });
      this.time.delayedCall(120 + i * 90, () => this.sparkles.emitParticleAt(crate.x, crate.y, 6));
    });

    const last = this.levelIndex === LEVELS.length - 1;
    this.sound.play(last ? 'jingle:finale' : 'jingle:win', { volume: 0.5 });
    const coins = coinsFor(this.level, this.puzzle.moves);
    const record = recordClear(this.levelIndex, this.puzzle.moves, coins);
    this.time.delayedCall(450, () => this.voice(last ? 'congratulations' : record.isNew ? 'new_highscore' : 'objective_achieved'));
    this.time.delayedCall(900, () => this.showPanel(coins, record.best, record.isNew, last));
  }

  private showPanel(coins: number, best: number, isNew: boolean, last: boolean) {
    const w = 600;
    const h = 430;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.28).fillRoundedRect(-w / 2, -h / 2 + 10, w, h, 30);
    g.fillStyle(0x3d7fb8).fillRoundedRect(-w / 2, -h / 2, w, h, 30);
    g.lineStyle(6, 0xffffff, 0.4).strokeRoundedRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16, 24);
    const heading = this.add.text(0, -h / 2 + 62, last ? 'ALL PUT AWAY!' : 'LEVEL CLEAR!', { ...TEXT, fontSize: '50px', strokeThickness: 10 }).setOrigin(0.5);
    parts.push(g, heading);

    const row = coinRow(this, coins, 2.4, 92);
    row.forEach((coin, i) => {
      const scale = coin.scale;
      coin.setScale(0);
      this.tweens.add({
        targets: coin,
        scale,
        duration: 320,
        delay: 350 + i * 300,
        ease: 'Back.easeOut',
        onStart: () => i < coins && playSfx(this, SFX, 'coin', { volume: 0.5, detune: i * 200 }),
      });
    });
    parts.push(this.add.container(0, -h / 2 + 150, row));

    const verdict = coins === 3 ? 'Perfect - matched par!' : `${this.puzzle.moves} moves, par is ${this.level.par}`;
    parts.push(this.add.text(0, -h / 2 + 232, verdict, { ...TEXT, fontSize: '28px', strokeThickness: 7 }).setOrigin(0.5));
    const bestLine = isNew ? 'New best!' : `best ${best} moves`;
    parts.push(this.add.text(0, -h / 2 + 276, bestLine, { ...TEXT, fontSize: '22px', strokeThickness: 5, color: '#ffe27a' }).setOrigin(0.5));

    const retry = button(this, 'RETRY', () => this.restart(), { w: 200, h: 72, size: 30, color: 0x7a8a94 });
    const next = button(this, last ? 'MENU' : 'NEXT', () => this.next(), { w: 200, h: 72, size: 30, color: 0x3aa55c });
    retry.setPosition(-115, h / 2 - 66);
    next.setPosition(115, h / 2 - 66);
    parts.push(retry, next);

    const { width, height } = this.scale;
    const shade = this.add.rectangle(0, 0, width * 4, height * 4, 0x1d252c, 0.5);
    this.panel = this.add.container(0, 0, [shade, ...parts]).setDepth(80).setAlpha(0);
    this.placePanel(this.panel);
    this.tweens.add({ targets: this.panel, alpha: 1, duration: 220 });
    heading.setScale(0.4);
    this.tweens.add({ targets: heading, scale: 1, duration: 380, ease: 'Back.easeOut' });
    this.buttons.setVisible(false);
  }

  private placePanel(panel: Phaser.GameObjects.Container) {
    const { width, height } = this.scale;
    panel.setScale(Math.min(1, (width - 24) / 600, (height - 24) / 470)).setPosition(width / 2, height / 2);
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
