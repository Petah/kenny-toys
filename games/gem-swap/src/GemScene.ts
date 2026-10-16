import * as Phaser from 'phaser';
import { FONT_BODY, FONT_HEADING } from '@shared/fonts';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { fitCard, makeButton } from '@shared/ui';
import { GEMS, RAINBOW, SFX, gemFrame, preloadAssets } from './assets';
import { Board, type Gem, type Phase, type Pos } from './board';

const SIZE = 8;
const ROUND = 90;
/** Idle seconds before a hint wiggles two gems. */
const HINT_AFTER = 6;

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#1d3f73',
  strokeThickness: 8,
  align: 'center',
};

type State = 'title' | 'play' | 'over';

interface GemView {
  gem: Gem;
  box: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  extra?: Phaser.GameObjects.Graphics;
}

export class GemScene extends Phaser.Scene {
  private state: State = 'title';
  private board!: Board;
  private views = new Map<number, GemView>();
  private cell = 64;
  private ox = 0;
  private oy = 0;
  private bg!: Phaser.GameObjects.Graphics;
  private panel!: Phaser.GameObjects.Graphics;
  private cursor!: Phaser.GameObjects.Graphics;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;

  private busy = false;
  private selected?: Pos;
  private drag?: { pos: Pos; x: number; y: number };
  private idle = 0;
  private hinting = false;
  /** Seconds left in the round (scene.time is Phaser's clock). */
  private left = ROUND;
  private score = 0;
  private best = 0;
  private bestCascade = 0;
  private specials = 0;
  private hurried = false;
  private lastTick = -1;
  private ending = false;

  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private bar!: Phaser.GameObjects.Graphics;
  private clockText!: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private music?: Phaser.Sound.BaseSound;
  private hue = 0;

  constructor() {
    super('gems');
  }

  preload() {
    preloadAssets(this);
  }

  create() {
    this.bg = this.add.graphics().setDepth(0);
    this.panel = this.add.graphics().setDepth(1);
    this.cursor = this.add.graphics().setDepth(3);
    this.sparks = this.add.particles(0, 0, 'particles', this.sparkConfig()).setDepth(21);
    this.scoreText = this.add.text(0, 0, '0', { ...TEXT, fontSize: '44px', strokeThickness: 10 }).setOrigin(0, 0).setDepth(30);
    this.bestText = this.add.text(0, 0, '', { ...TEXT, fontSize: '20px', strokeThickness: 6, color: '#ffe066' }).setOrigin(1, 0).setDepth(30);
    this.bar = this.add.graphics().setDepth(30);
    this.clockText = this.add.text(0, 0, '', { ...TEXT, fontSize: '22px', strokeThickness: 6 }).setOrigin(0.5).setDepth(31);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.down(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.move(p));
    this.input.on('pointerup', () => (this.drag = undefined));
    this.input.keyboard?.on('keydown-ENTER', () => this.confirm());
    this.input.keyboard?.on('keydown-SPACE', () => this.confirm());
    this.scale.on('resize', () => this.layout());

    this.best = load('gem-swap:best', 0);
    this.board = new Board(SIZE, SIZE, GEMS.length, Math.random);
    this.layout();
    this.showTitle();
  }

  // ---- Layout ------------------------------------------------------------------------------

  private get k() {
    return Math.min(this.scale.width / 560, this.scale.height / 760, 1.4);
  }

  private layout() {
    const { width: w, height: h } = this.scale;
    const top = w < 900 ? 118 : 92;
    const size = Math.min(w - 20, h - top - 16, 760);
    this.cell = size / SIZE;
    this.ox = (w - size) / 2;
    this.oy = top + (h - top - 16 - size) / 2;
    const g = this.bg.clear();
    g.fillGradientStyle(0x3a86d6, 0x3a86d6, 0x1f4f99, 0x1f4f99, 1).fillRect(0, 0, w, h);
    const p = this.panel.clear();
    const pad = this.cell * 0.12;
    p.fillStyle(0x0f2d5c, 0.45).fillRoundedRect(this.ox - pad, this.oy - pad + 6, size + pad * 2, size + pad * 2, 18);
    p.fillStyle(0xeaf3ff, 0.95).fillRoundedRect(this.ox - pad, this.oy - pad, size + pad * 2, size + pad * 2, 18);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if ((x + y) % 2) p.fillStyle(0xcfe0f7, 1).fillRect(this.ox + x * this.cell, this.oy + y * this.cell, this.cell, this.cell);
      }
    }
    // Put every gem back in its place at the new size.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const gem = this.board.at(x, y);
        if (!gem) continue;
        const v = this.views.get(gem.id) ?? this.makeView(gem, x, y);
        const c = this.centre(x, y);
        v.box.setPosition(c.x, c.y);
        this.sizeView(v);
      }
    }
    // Wide screens have room for the score beside the back button; others put it under.
    const k = Math.min(1, w / 460);
    const wide = w >= 900;
    this.scoreText.setPosition(wide ? 170 : 16, wide ? 14 : 52).setScale(k);
    this.bestText.setPosition(w - 16, wide ? 22 : 60).setScale(k);
    this.sparks?.setConfig(this.sparkConfig());
    this.drawClock();
    this.drawCursor();
    this.rebuildOverlay?.();
  }

  /** Sparks sized to the cells. */
  private sparkConfig(): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
    const k = this.cell / 64;
    return {
      frame: ['particleWhite_1.png', 'particleWhite_2.png', 'particleWhite_3.png', 'particleWhite_4.png'],
      speed: { min: 60 * k, max: 240 * k },
      scale: { start: 0.22 * k, end: 0 },
      rotate: { min: 0, max: 360 },
      lifespan: 520,
      gravityY: 300 * k,
      emitting: false,
    };
  }

  private centre(x: number, y: number) {
    return { x: this.ox + (x + 0.5) * this.cell, y: this.oy + (y + 0.5) * this.cell };
  }

  private cellAt(px: number, py: number): Pos | undefined {
    const x = Math.floor((px - this.ox) / this.cell);
    const y = Math.floor((py - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return undefined;
    return { x, y };
  }

  // ---- Gem views ---------------------------------------------------------------------------

  private makeView(gem: Gem, x: number, y: number): GemView {
    const special = gem.special !== 'none';
    const f = gem.special === 'rainbow' ? { key: `tiles${RAINBOW.sheet}`, frame: `${RAINBOW.frame}_${RAINBOW.shape}.png` } : gemFrame(gem.kind, special);
    const img = this.add.image(0, 0, f.key, f.frame);
    const box = this.add.container(0, 0, [img]).setDepth(5);
    const v: GemView = { gem, box, img };
    if (gem.special === 'row' || gem.special === 'col' || gem.special === 'bomb') {
      v.extra = this.add.graphics();
      box.add(v.extra);
    }
    const c = this.centre(x, y);
    box.setPosition(c.x, c.y);
    this.sizeView(v);
    this.views.set(gem.id, v);
    return v;
  }

  private sizeView(v: GemView) {
    const s = (this.cell * 0.86) / 128;
    v.img.setScale(s);
    const g = v.extra;
    if (!g) return;
    g.clear();
    const r = this.cell * 0.36;
    // Navy arrows for line gems, a ring of dots for bombs, both outlined in white so they read on any colour.
    g.fillStyle(0x1d3f73, 1).lineStyle(Math.max(2, this.cell * 0.035), 0xffffff, 1);
    const arrow = (ax: number, ay: number, dx: number, dy: number) => {
      const a = this.cell * 0.15;
      const px = -dy;
      const py = dx;
      const pts = [ax + dx * a, ay + dy * a, ax + px * a * 0.85, ay + py * a * 0.85, ax - px * a * 0.85, ay - py * a * 0.85] as const;
      g.fillTriangle(...pts);
      g.strokeTriangle(...pts);
    };
    if (v.gem.special === 'row') {
      arrow(-r, 0, -1, 0);
      arrow(r, 0, 1, 0);
    } else if (v.gem.special === 'col') {
      arrow(0, -r, 0, -1);
      arrow(0, r, 0, 1);
    } else if (v.gem.special === 'bomb') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillCircle(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, this.cell * 0.065);
        g.strokeCircle(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, this.cell * 0.065);
      }
    }
  }

  // ---- Input -------------------------------------------------------------------------------

  private down(p: Phaser.Input.Pointer) {
    if (this.state !== 'play' || this.busy || this.left <= 0) return;
    const pos = this.cellAt(p.x, p.y);
    if (!pos) return;
    this.idle = 0;
    const sel = this.selected;
    if (sel && Math.abs(sel.x - pos.x) + Math.abs(sel.y - pos.y) === 1) {
      this.selected = undefined;
      this.drawCursor();
      void this.trySwap(sel, pos);
      return;
    }
    this.selected = sel && sel.x === pos.x && sel.y === pos.y ? undefined : pos;
    this.drag = { pos, x: p.x, y: p.y };
    if (this.selected) playSfx(this, SFX, 'pick', { volume: 0.3 });
    this.drawCursor();
  }

  /** Dragging a gem towards a neighbour swaps them. */
  private move(p: Phaser.Input.Pointer) {
    const d = this.drag;
    if (!d || !p.isDown || this.busy) return;
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < this.cell * 0.35) return;
    const to = Math.abs(dx) > Math.abs(dy) ? { x: d.pos.x + Math.sign(dx), y: d.pos.y } : { x: d.pos.x, y: d.pos.y + Math.sign(dy) };
    this.drag = undefined;
    this.selected = undefined;
    this.drawCursor();
    if (to.x < 0 || to.y < 0 || to.x >= SIZE || to.y >= SIZE) return;
    void this.trySwap(d.pos, to);
  }

  private drawCursor() {
    const g = this.cursor.clear();
    if (!this.selected) return;
    const c = this.centre(this.selected.x, this.selected.y);
    const s = this.cell * 0.96;
    g.lineStyle(5, 0xffd23f, 1).strokeRoundedRect(c.x - s / 2, c.y - s / 2, s, s, 12);
    g.fillStyle(0xffd23f, 0.25).fillRoundedRect(c.x - s / 2, c.y - s / 2, s, s, 12);
  }

  private confirm() {
    if (this.state === 'title' || (this.state === 'over' && !this.ending)) this.start();
  }

  // ---- Play --------------------------------------------------------------------------------

  private tween(targets: object | object[], props: Omit<Phaser.Types.Tweens.TweenBuilderConfig, 'targets'>) {
    return new Promise<void>((resolve) => this.tweens.add({ targets, ...props, onComplete: () => resolve() } as Phaser.Types.Tweens.TweenBuilderConfig));
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => this.later(ms, resolve));
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(this.time.delayedCall(ms, fn));
  }

  private timers: Phaser.Time.TimerEvent[] = [];

  
  private async trySwap(a: Pos, b: Pos) {
    const ga = this.board.at(a.x, a.y)!;
    const gb = this.board.at(b.x, b.y)!;
    const va = this.views.get(ga.id)!;
    const vb = this.views.get(gb.id)!;
    this.busy = true;
    const ca = this.centre(a.x, a.y);
    const cb = this.centre(b.x, b.y);
    const res = this.board.swap(a, b);
    playSfx(this, SFX, 'swap', { volume: 0.35 });
    va.box.setDepth(6);
    await Promise.all([
      this.tween(va.box, { x: cb.x, y: cb.y, duration: 150, ease: 'Quad.easeInOut' }),
      this.tween(vb.box, { x: ca.x, y: ca.y, duration: 150, ease: 'Quad.easeInOut' }),
    ]);
    va.box.setDepth(5);
    if (!res.ok) {
      playSfx(this, SFX, 'nope', { volume: 0.4 });
      await Promise.all([
        this.tween(va.box, { x: ca.x, y: ca.y, duration: 170, ease: 'Back.easeOut' }),
        this.tween(vb.box, { x: cb.x, y: cb.y, duration: 170, ease: 'Back.easeOut' }),
      ]);
      this.busy = false;
      return;
    }
    for (const phase of res.phases) await this.playPhase(phase);
    // The board may have been shuffled when no moves were left.
    await this.syncAfterShuffle();
    this.busy = false;
    this.idle = 0;
  }

  /** If the board reshuffled itself, slide every gem to its new place. */
  private async syncAfterShuffle() {
    const moves: Promise<void>[] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const gem = this.board.at(x, y)!;
        const v = this.views.get(gem.id) ?? this.makeView(gem, x, y);
        const c = this.centre(x, y);
        if (Math.abs(v.box.x - c.x) > 1 || Math.abs(v.box.y - c.y) > 1) moves.push(this.tween(v.box, { x: c.x, y: c.y, duration: 400, ease: 'Cubic.easeInOut' }));
      }
    }
    if (moves.length) {
      playSfx(this, SFX, 'shuffle', { volume: 0.5 });
      this.floatText('No moves, shuffle!', this.scale.width / 2, this.oy + this.cell * 4, '#ffe066', 30);
      await Promise.all(moves);
    }
  }

  private async playPhase(phase: Phase) {
    const pts = phase.points * phase.cascade;
    this.score += pts;
    this.bestCascade = Math.max(this.bestCascade, phase.cascade);
    this.specials += phase.made.length;
    // Blasts first, so their beams show what they took.
    for (const b of phase.blasts) this.blastFx(b, phase);
    if (phase.blasts.some((b) => b.special === 'bomb')) {
      this.cameras.main.shake(180, 0.008);
      playSfx(this, SFX, 'boom', { volume: 0.6 });
    }
    if (phase.blasts.some((b) => b.special === 'row' || b.special === 'col')) playSfx(this, SFX, 'blast', { volume: 0.45 });
    if (phase.blasts.some((b) => b.special === 'rainbow')) playSfx(this, SFX, 'rainbow', { volume: 0.5 });
    playSfx(this, SFX, 'pop', { volume: 0.5, rate: 1 + (phase.cascade - 1) * 0.12 });
    if (phase.cascade >= 2) {
      playSfx(this, SFX, 'cascade', { volume: 0.35, rate: 0.9 + phase.cascade * 0.08 });
      this.floatText(phase.cascade >= 4 ? `Amazing ×${phase.cascade}!` : `Cascade ×${phase.cascade}`, this.scale.width / 2, this.oy + this.cell * 3.5, '#ffe066', 34 + phase.cascade * 2);
    }
    // Pop the cleared gems, with a puff of their colour.
    let sx = 0;
    let sy = 0;
    const pops: Promise<void>[] = [];
    for (const c of phase.cleared) {
      const v = this.views.get(c.gem.id);
      const at = this.centre(c.x, c.y);
      sx += at.x;
      sy += at.y;
      if (!v) continue;
      this.views.delete(c.gem.id);
      const colour = c.gem.kind >= 0 ? GEMS[c.gem.kind].colour : 0xffffff;
      this.sparks.setParticleTint(colour);
      this.sparks.explode(7, at.x, at.y);
      const delay = c.by === 'match' ? 0 : 60 + Math.random() * 80;
      pops.push(
        this.tween(v.box, { scale: 1.25, duration: 70, delay, yoyo: false }).then(() =>
          this.tween(v.box, { scale: 0, alpha: 0, duration: 130 }).then(() => v.box.destroy()),
        ),
      );
    }
    if (phase.cleared.length) this.floatText(`+${pts}`, sx / phase.cleared.length, sy / phase.cleared.length, '#ffffff', 26 + Math.min(16, pts / 40));
    for (const m of phase.made) {
      const v = this.makeView(m.gem, m.x, m.y);
      v.box.setScale(0);
      pops.push(this.tween(v.box, { scale: 1, duration: 260, delay: 120, ease: 'Back.easeOut' }));
      playSfx(this, SFX, 'made', { volume: 0.45 });
    }
    await Promise.all(pops);
    // Drop everything into place, new gems fading in as they enter the board.
    let longest = 0;
    const falls: Promise<void>[] = [];
    for (const f of phase.falls) {
      const v = this.views.get(f.gem.id) ?? this.makeView(f.gem, f.x, f.fromY);
      const to = this.centre(f.x, f.toY);
      const from = this.centre(f.x, f.fromY);
      v.box.setPosition(from.x, from.y);
      const duration = 120 + (f.toY - f.fromY) * 45;
      longest = Math.max(longest, duration);
      const top = this.oy;
      falls.push(
        this.tween(v.box, {
          y: to.y,
          duration,
          ease: 'Quad.easeIn',
          onUpdate: () => v.box.setAlpha(Phaser.Math.Clamp((v.box.y - top) / (this.cell * 0.5), 0, 1)),
        }).then(() => {
          v.box.setAlpha(1);
          // A little squash on landing.
          this.tweens.add({ targets: v.box, scaleY: 0.86, scaleX: 1.08, duration: 60, yoyo: true });
        }),
      );
    }
    if (falls.length) this.later(longest - 20, () => playSfx(this, SFX, 'land', { volume: 0.25 }));
    await Promise.all(falls);
    await this.wait(40);
  }

  private blastFx(b: Phase['blasts'][number], phase: Phase) {
    const g = this.add.graphics().setDepth(19);
    const c = this.centre(b.x, b.y);
    const size = this.cell * SIZE;
    if (b.special === 'row') g.fillStyle(0xffffff, 0.85).fillRect(this.ox, c.y - this.cell * 0.35, size, this.cell * 0.7);
    else if (b.special === 'col') g.fillStyle(0xffffff, 0.85).fillRect(c.x - this.cell * 0.35, this.oy, this.cell * 0.7, size);
    else if (b.special === 'bomb') g.lineStyle(10, 0xffffff, 0.9).strokeCircle(c.x, c.y, this.cell * 1.5);
    else if (b.special === 'rainbow') {
      g.lineStyle(4, 0xffffff, 0.9);
      for (const t of phase.cleared) {
        if (t.by !== 'rainbow') continue;
        const e = this.centre(t.x, t.y);
        g.lineBetween(c.x, c.y, e.x, e.y);
      }
    }
    this.tweens.add({ targets: g, alpha: 0, duration: 380, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
  }

  private floatText(text: string, x: number, y: number, colour: string, size: number) {
    const t = this.add.text(x, y, text, { ...TEXT, fontSize: `${Math.round(size * Math.min(1.2, this.k + 0.2))}px`, color: colour, strokeThickness: 7 }).setOrigin(0.5).setDepth(40);
    this.tweens.add({ targets: t, y: y - this.cell * 1.2, alpha: { from: 1, to: 0 }, duration: 900, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
    this.tweens.add({ targets: t, scale: { from: 0.4, to: 1 }, duration: 220, ease: 'Back.easeOut' });
  }

  /** Wiggles two gems that would make a match. */
  private hint() {
    const mv = this.board.findMove();
    if (!mv) return;
    this.hinting = true;
    const views = mv.map((p) => this.views.get(this.board.at(p.x, p.y)!.id)!);
    this.tweens.add({ targets: views.map((v) => v.box), angle: { from: -12, to: 12 }, duration: 110, yoyo: true, repeat: 3, onComplete: () => {
      for (const v of views) v.box.setAngle(0);
      this.hinting = false;
      this.idle = HINT_AFTER - 3;
    } });
  }

  // ---- HUD ---------------------------------------------------------------------------------

  private drawClock() {
    const { width: w } = this.scale;
    const bw = Math.min(w * 0.42, 300);
    const x = w < 560 ? (w - bw) / 2 + 30 : (w - bw) / 2;
    const y = 30;
    const left = Math.max(0, this.left / ROUND);
    const g = this.bar.clear();
    g.fillStyle(0x0f2d5c, 0.55).fillRoundedRect(x, y - 13, bw, 26, 13);
    const colour = this.left <= 10 ? 0xff5a4e : this.left <= 30 ? 0xffb03a : 0x7ee05a;
    if (left > 0) g.fillStyle(colour, 1).fillRoundedRect(x + 3, y - 10, Math.max(20, (bw - 6) * left), 20, 10);
    this.clockText.setPosition(x + bw / 2, y).setText(`${Math.ceil(this.left)}`);
    this.scoreText.setText(String(this.score));
    this.bestText.setText(this.best ? `best ${this.best}` : '');
  }

  private setHud(on: boolean) {
    for (const o of [this.scoreText, this.bestText, this.bar, this.clockText]) o.setVisible(on);
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
    return makeButton(this, x, y, label, onClick, { textStyle: TEXT, color: 0xf28a24, onPress: () => playSfx(this, SFX, 'pick', { volume: 0.3 }) }).parts;
  }

  private showTitle() {
    this.state = 'title';
    this.setHud(false);
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const shade = this.add.rectangle(0, 0, w, h, 0x0f2d5c, 0.45).setOrigin(0);
      const card = this.add.container(w / 2, h * 0.45);
      const title = this.add.text(0, -130, 'GEM SWAP', { ...TEXT, fontSize: '80px', strokeThickness: 14 }).setOrigin(0.5);
      this.tweens.add({ targets: title, angle: { from: -2, to: 2 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const row: Phaser.GameObjects.GameObject[] = GEMS.map((_, i) => {
        const f = gemFrame(i);
        const img = this.add.image((i - 2.5) * 66, -36, f.key, f.frame).setScale(0.45);
        this.tweens.add({ targets: img, y: -46, duration: 500 + i * 70, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        return img;
      });
      const how = this.add.text(0, 40, 'Swap neighbours to line up three or more.\nFour, five, L and T shapes make special gems.', { ...TEXT, fontFamily: FONT_BODY, fontSize: '20px', strokeThickness: 6, lineSpacing: 6 }).setOrigin(0.5);
      const play = this.button(0, 140, 'PLAY', () => this.start());
      const parts: Phaser.GameObjects.GameObject[] = [title, ...row, how, ...play];
      if (this.best) parts.push(this.add.text(0, 214, `best ${this.best}`, { ...TEXT, fontSize: '24px', color: '#ffe066', strokeThickness: 7 }).setOrigin(0.5));
      card.add(parts);
      fitCard(card, this.k, w, 620, title);
      return [shade, card];
    });
  }

  private start() {
    playSfx(this, SFX, 'pick', { volume: 0.4 });
    this.music ??= this.sound.add('music', { loop: true, volume: 0.3 });
    if (!this.music.isPlaying) this.music.play();
    for (const v of this.views.values()) v.box.destroy();
    this.views.clear();
    this.board = new Board(SIZE, SIZE, GEMS.length, Math.random);
    this.left = ROUND;
    this.score = 0;
    this.bestCascade = 0;
    this.specials = 0;
    this.hurried = false;
    this.ending = false;
    this.busy = false;
    this.selected = undefined;
    this.idle = 0;
    this.state = 'play';
    this.setOverlay();
    this.setHud(true);
    this.layout();
    // Gems drop in from above to start.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = this.views.get(this.board.at(x, y)!.id)!;
        const to = v.box.y;
        v.box.y = to - this.cell * (SIZE + 1);
        this.tweens.add({ targets: v.box, y: to, duration: 420 + (SIZE - y) * 40, delay: x * 30, ease: 'Bounce.easeOut' });
      }
    }
    playSfx(this, SFX, 'go', { volume: 0.6, detune: 0 });
  }

  private async finish() {
    this.ending = true;
    while (this.busy) await this.wait(50);
    this.state = 'over';
    this.selected = undefined;
    this.drawCursor();
    playSfx(this, SFX, 'buzzer', { volume: 0.5, detune: 0 });
    const { best, isNew } = submitHighScore('gem-swap', this.score);
    this.best = best;
    const record = isNew && this.score > 0;
    this.later(500, () => playSfx(this, SFX, record ? 'best' : 'timeOver', { volume: 0.6, detune: 0 }));
    this.later(1200, () => playSfx(this, SFX, record ? 'done' : 'meh', { volume: 0.5, detune: 0 }));
    this.ending = false;
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const shade = this.add.rectangle(0, 0, w, h, 0x0f2d5c, 0.5).setOrigin(0);
      const card = this.add.container(w / 2, h * 0.45);
      const title = this.add.text(0, -170, record ? 'NEW BEST!' : "TIME'S UP", { ...TEXT, fontSize: '62px', strokeThickness: 12 }).setOrigin(0.5);
      const panel = this.add.graphics();
      panel.fillStyle(0x0f2d5c, 0.4).fillRoundedRect(-200, -102, 400, 200, 26);
      panel.fillStyle(0xeaf3ff, 1).fillRoundedRect(-200, -110, 400, 200, 26);
      panel.lineStyle(5, 0xf28a24, 1).strokeRoundedRect(-200, -110, 400, 200, 26);
      const label = { ...TEXT, fontSize: '20px', color: '#c46a12', strokeThickness: 0 };
      const big = { ...TEXT, color: '#1d3f73', strokeThickness: 0 };
      const parts: Phaser.GameObjects.GameObject[] = [
        title, panel,
        this.add.text(0, -88, 'SCORE', label).setOrigin(0.5),
        this.add.text(0, -40, String(this.score), { ...big, fontSize: '58px' }).setOrigin(0.5),
        this.add.text(-120, 18, 'BEST', label).setOrigin(0.5),
        this.add.text(-120, 52, String(this.best), { ...big, fontSize: '28px' }).setOrigin(0.5),
        this.add.text(0, 18, 'CASCADE', label).setOrigin(0.5),
        this.add.text(0, 52, `×${this.bestCascade}`, { ...big, fontSize: '28px' }).setOrigin(0.5),
        this.add.text(120, 18, 'SPECIALS', label).setOrigin(0.5),
        this.add.text(120, 52, String(this.specials), { ...big, fontSize: '28px' }).setOrigin(0.5),
        ...this.button(0, 160, 'AGAIN', () => this.start()),
      ];
      card.add(parts);
      fitCard(card, this.k, w, 440, title);
      return [shade, card];
    });
    this.setHud(false);
  }

  update(_t: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.1);
    // Rainbow gems shimmer through the colours.
    this.hue = (this.hue + dt * 0.4) % 1;
    for (const v of this.views.values()) {
      if (v.gem.special === 'rainbow') v.img.setTint(Phaser.Display.Color.HSVToRGB(this.hue, 0.55, 1).color as number);
      else if (v.extra) v.extra.setAlpha(0.85 + Math.sin(this.time.now / 160) * 0.15);
    }
    if (this.state !== 'play') return;
    if (this.left > 0) {
      this.left = Math.max(0, this.left - dt);
      if (this.left <= 10 && !this.hurried) {
        this.hurried = true;
        playSfx(this, SFX, 'hurry', { volume: 0.6, detune: 0 });
      }
      const secs = Math.ceil(this.left);
      if (this.left <= 5 && secs !== this.lastTick) playSfx(this, SFX, 'tick', { volume: 0.4, detune: 0 });
      this.lastTick = secs;
      if (this.left <= 0 && !this.ending) void this.finish();
    }
    if (!this.busy && !this.hinting) {
      this.idle += dt;
      if (this.idle > HINT_AFTER) this.hint();
    }
    this.drawClock();
  }

}
