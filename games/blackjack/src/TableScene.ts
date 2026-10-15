import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { load, save, submitHighScore } from '@shared/storage';
import { BACK, CARD_H, CARD_SHEET, CARD_W, CHIP, CHIP_FLAT, CHIPS, FONT, INK, PALE, RED, SFX, cardFrame, createAssets, preloadAssets, type Voice } from './assets';
import {
  Shoe,
  bestMove,
  canDouble,
  canSplit,
  dealerHits,
  dealerPeeks,
  handBlackjack,
  isBlackjack,
  isBust,
  newHand,
  outcome,
  payout,
  total,
  totalLabel,
  type Card,
  type Hand,
  type Move,
  type Outcome,
} from './rules';

type State = 'title' | 'betting' | 'busy' | 'playing' | 'over';

/** A run is this many hands, starting with this much. */
const HANDS = 15;
const START_BANK = 500;
const MIN_BET = 5;
const FIRST_BET = 25;
/** Room between the overlapping cards of a hand, at most. */
const FAN = 18;
const FELT = 0x2f7d4f;
const FELT_PRINT = 0x9fd4ad;
const GOLD = 0xffd23f;
const SHADE = 0x2b313b;
/** Stacked chips sit this far apart, and a column holds at most this many. */
const CHIP_STEP = 3;
const COLUMN_MAX = 10;

interface Seat {
  hand: Hand;
  sprites: Phaser.GameObjects.Image[];
  /** Chips on the bet circle, rebuilt when the bet changes. */
  stack: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Container;
  result?: Outcome;
}

interface PixelButton {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  root: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Container;
  enabled: boolean;
  hint: boolean;
  visible: boolean;
  colour: number;
  label: string;
  onClick: () => void;
}

const MOVES: { key: Move; label: string; colour: number; hotkey: string }[] = [
  { key: 'hit', label: 'HIT', colour: 0x3aa55c, hotkey: 'H' },
  { key: 'stand', label: 'STAND', colour: 0xd9423d, hotkey: 'S' },
  { key: 'double', label: 'DOUBLE', colour: 0x3b8bd9, hotkey: 'D' },
  { key: 'split', label: 'SPLIT', colour: 0x8a5cc9, hotkey: 'P' },
];

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

/** Splits an amount into chips, biggest first. */
function chipsFor(amount: number) {
  const out: number[] = [];
  let left = amount;
  for (let i = CHIPS.length - 1; i >= 0; i--) {
    while (left >= CHIPS[i].value) {
      out.push(i);
      left -= CHIPS[i].value;
    }
  }
  return out;
}

export class TableScene extends Phaser.Scene {
  state: State = 'title';
  shoe = new Shoe();
  bank = START_BANK;
  /** Hands dealt so far this run, the one on the table included. */
  handNo = 0;
  bet = 0;
  private lastBet = FIRST_BET;
  private peak = START_BANK;
  private best = 0;
  private tips = true;
  seats: Seat[] = [];
  active = 0;
  dealer: Card[] = [];
  private dealerSprites: Phaser.GameObjects.Image[] = [];
  private dealerLabel!: Phaser.GameObjects.Container;

  /** Whole-number zoom, and the table's size in its own pixels. */
  private zoom = 2;
  private W = 200;
  private H = 300;
  /** Laid out by layout(). */
  private dealerTop = 24;
  private playerTop = 140;
  private betY = 230;
  private chipRowY = 280;
  private buttonY = 320;
  private hudX = 190;

  private felt!: Phaser.GameObjects.TileSprite;
  private print!: Phaser.GameObjects.BitmapText;
  private print2!: Phaser.GameObjects.BitmapText;
  private shoeSprite!: Phaser.GameObjects.Container;
  private bankText!: Phaser.GameObjects.BitmapText;
  private handText!: Phaser.GameObjects.BitmapText;
  private arrow!: Phaser.GameObjects.Container;
  private buttons: PixelButton[] = [];
  private chipButtons: PixelButton[] = [];
  private chipLabels: Phaser.GameObjects.BitmapText[] = [];
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private overlayButtons: PixelButton[] = [];
  private pressed?: PixelButton;
  private music?: Phaser.Sound.BaseSound;
  private shownBank = START_BANK;
  private bankTween?: Phaser.Tweens.Tween;

  constructor() {
    super('table');
  }

  preload() {
    preloadAssets(this);
  }

  // ---- Setup -------------------------------------------------------------------------------

  create() {
    createAssets(this);
    this.makeTextures();
    // One camera, zoomed from its top-left corner by a whole number, so every pixel of the
    // pack's art lands on whole screen pixels whatever the window size.
    this.cameras.main.setOrigin(0, 0).setBackgroundColor(FELT);
    this.felt = this.add.tileSprite(0, 0, 8, 8, 'felt').setOrigin(0);
    this.print = this.text(0, 0, 'BLACKJACK PAYS 3 TO 2', FELT_PRINT).setOrigin(0.5).setAlpha(0.7);
    this.print2 = this.text(0, 0, 'DEALER STANDS ON 17', FELT_PRINT).setOrigin(0.5).setAlpha(0.7);
    this.shoeSprite = this.add.container(0, 0, [0, 1, 2].map((i) => this.add.image(-i, -i, CARD_SHEET, BACK).setAngle(90)));
    this.bankText = this.text(0, 0, '', 0xffffff).setOrigin(1, 0).setScale(2);
    this.handText = this.text(0, 0, '', PALE).setOrigin(1, 0);
    this.dealerLabel = this.add.container(0, 0).setDepth(5);
    // The arrow bobs inside a box that's moved to the hand being played.
    const bob = this.add.image(0, 0, 'arrow').setOrigin(0.5, 1);
    this.tweens.add({ targets: bob, y: -2, duration: 300, yoyo: true, repeat: -1, ease: 'Stepped' });
    this.arrow = this.add.container(0, 0, [bob]).setDepth(6).setVisible(false);

    MOVES.forEach((m) => this.buttons.push(this.makeButton(m.key, m.label, m.colour, () => this.act(m.key))));
    this.buttons.push(this.makeButton('clear', 'CLEAR', 0x7a8a94, () => this.clearBet()));
    this.buttons.push(this.makeButton('deal', 'DEAL', 0x3aa55c, () => this.deal()));
    this.buttons.push(this.makeButton('tips', 'TIPS', 0x7a8a94, () => this.toggleTips()));
    CHIPS.forEach((c, i) => {
      const b = this.makeButton(`chip${i}`, '', 0, () => this.addChip(i), `${CHIP_FLAT}:${i}`);
      this.chipButtons.push(b);
      this.buttons.push(b);
      this.chipLabels.push(this.text(0, 0, `${c.value}`, 0xffffff).setOrigin(0.5, 0));
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.keyDown(e));
    this.scale.on('resize', () => this.layout());

    this.best = load('blackjack:best', 0);
    this.tips = load('blackjack:tips', true);
    this.layout();
    this.showTitle();
  }

  /** The felt's weave, the bet ring, and the arrow over the hand being played. */
  private makeTextures() {
    if (!this.textures.exists('felt')) {
      const n = 16;
      const t = this.textures.createCanvas('felt', n, n)!;
      const ctx = t.context;
      ctx.fillStyle = '#2f7d4f';
      ctx.fillRect(0, 0, n, n);
      ctx.fillStyle = '#2a7347';
      // A sparse, even scatter of darker threads, so the table isn't a flat fill.
      for (const [x, y] of [[1, 2], [6, 0], [11, 3], [14, 9], [3, 8], [8, 6], [12, 13], [5, 13], [9, 10], [0, 12]]) ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = '#358a58';
      for (const [x, y] of [[4, 4], [10, 1], [15, 6], [2, 15], [7, 11], [13, 15]]) ctx.fillRect(x, y, 1, 1);
      t.refresh();
    }
    if (!this.textures.exists('ring')) {
      const size = 33;
      const t = this.textures.createCanvas('ring', size, size)!;
      const ctx = t.context;
      const c = (size - 1) / 2;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const d = Math.hypot(x - c, y - c);
          if (d > 14.5 && d <= 15.6) {
            ctx.fillStyle = '#9fd4ad';
            ctx.fillRect(x, y, 1, 1);
          } else if (d <= 14.5) {
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
      t.refresh();
    }
    if (!this.textures.exists('arrow')) {
      const t = this.textures.createCanvas('arrow', 9, 6)!;
      const ctx = t.context;
      const rows = ['#########', '#ooooooo#', ' #ooooo# ', '  #ooo#  ', '   #o#   ', '    #    '];
      rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === ' ') return;
          ctx.fillStyle = ch === '#' ? '#2b313b' : '#ffd23f';
          ctx.fillRect(x, y, 1, 1);
        }),
      );
      t.refresh();
    }
  }

  private text(x: number, y: number, str: string, tint = 0xffffff) {
    return this.add.bitmapText(Math.round(x), Math.round(y), FONT, str).setTint(tint);
  }

  // ---- Layout --------------------------------------------------------------------------------

  private layout() {
    const { width: w, height: h } = this.scale;
    // Two on phones, three on laptops: room for two split hands across, and the table down.
    this.zoom = Math.max(1, Math.floor(Math.min(w / 190, h / 262)));
    this.W = Math.floor(w / this.zoom);
    this.H = Math.floor(h / this.zoom);
    this.cameras.main.setSize(w, h).setZoom(this.zoom).setScroll(0, 0);
    const { W, H } = this;
    this.felt.setSize(W + 16, H + 16);

    this.buttonY = H - 6 - 11;
    this.chipRowY = this.buttonY - 42;
    this.betY = this.chipRowY - 32;
    this.playerTop = this.betY - 20 - 14 - CARD_H;
    // The dealer sits under the HUD, nudged down on tall screens to share out the spare room.
    const spare = this.playerTop - 22 - CARD_H - 14 - 30;
    this.dealerTop = 22 + Math.max(0, Math.floor(spare / 3));
    const mid = Math.round((this.dealerTop + CARD_H + 14 + this.playerTop) / 2);
    this.print.setPosition(Math.round(W / 2), mid - 5);
    this.print2.setPosition(Math.round(W / 2), mid + 5);
    // The table's printed rules only where there's felt free for them.
    const room = this.playerTop - (this.dealerTop + CARD_H + 16);
    this.print.setVisible(room >= 26);
    this.print2.setVisible(room >= 26);
    // The shoe pokes in from the left, under the way back to the toys.
    this.shoeSprite.setPosition(4, this.dealerTop + 18);
    this.hudX = W - 6;
    this.bankText.setPosition(this.hudX, 4);
    this.handText.setPosition(this.hudX, 4 + 24);

    // Bottom row: the four moves while playing, or CLEAR and DEAL while betting.
    const gap = 3;
    const rowW = Math.min(W - 8, 260);
    const bw = Math.floor((rowW - gap * 3) / 4);
    const x0 = Math.round(W / 2 - (bw * 4 + gap * 3) / 2);
    MOVES.forEach((m, i) => this.placeButton(this.button(m.key), x0 + i * (bw + gap), this.buttonY - 11, bw, 22));
    const half = Math.floor((bw * 4 + gap * 3 - gap) / 2);
    this.placeButton(this.button('clear'), x0, this.buttonY - 11, Math.min(half, bw + 10), 22);
    const dealX = x0 + Math.min(half, bw + 10) + gap;
    this.placeButton(this.button('deal'), dealX, this.buttonY - 11, x0 + bw * 4 + gap * 3 - dealX, 22);
    // Chips in a row above, each with its value under it.
    const chipGap = Math.min(40, Math.floor((W - 12) / 4));
    CHIPS.forEach((_, i) => {
      const cx = Math.round(W / 2 + (i - 1.5) * chipGap);
      this.placeButton(this.chipButtons[i], cx - 15, this.chipRowY - 15, 30, 30);
      this.chipLabels[i].setPosition(cx, this.chipRowY + 15);
    });
    // The tips switch sits small in the corner, level with the bet.
    this.placeButton(this.button('tips'), 6, this.betY - 7, 36, 14);

    this.snapAll();
    this.updateHud();
    this.rebuildOverlay?.();
  }

  private button(key: string) {
    return this.buttons.find((b) => b.key === key)!;
  }

  /** Where card `i` of `n` in a hand sits: centre x and top. */
  private cardSlot(cx: number, top: number, i: number, n: number, room: number) {
    const fan = n > 1 ? Math.min(FAN, Math.floor((room - CARD_W) / (n - 1))) : 0;
    const width = CARD_W + fan * (n - 1);
    const left = Math.round(cx - width / 2);
    return { x: left + i * fan + CARD_W / 2, y: top + CARD_H / 2 };
  }

  /** Middle of seat `i`'s hand, and how wide it may spread. */
  private seatCentre(i: number) {
    const n = this.seats.length;
    if (n <= 1) return { cx: Math.round(this.W / 2), room: this.W - 70 };
    const room = Math.floor((this.W - 18) / 2);
    return { cx: Math.round(this.W / 2 + (i - 0.5) * (room + 6)), room };
  }

  private seatCardSlot(s: number, i: number, n = this.seats[s].hand.cards.length) {
    const { cx, room } = this.seatCentre(s);
    return this.cardSlot(cx, this.playerTop, i, Math.max(n, i + 1), room);
  }

  private dealerSlot(i: number, n = this.dealer.length) {
    return this.cardSlot(Math.round(this.W / 2), this.dealerTop, i, Math.max(n, i + 1), this.W - 70);
  }

  /** Puts every card, stack and label where it belongs, without moving anything that's mid-flight. */
  private snapAll() {
    this.seats.forEach((seat, s) => {
      seat.sprites.forEach((sp, i) => {
        if (this.tweens.isTweening(sp)) return;
        const at = this.seatCardSlot(s, i);
        sp.setPosition(at.x, at.y).setDepth(10 + i);
      });
      const { cx } = this.seatCentre(s);
      seat.ring.setPosition(cx, this.betY);
      if (!this.tweens.isTweening(seat.stack)) seat.stack.setPosition(cx, this.betY);
      this.placeLabel(seat.label, cx, this.playerTop + CARD_H + 3);
    });
    this.dealerSprites.forEach((sp, i) => {
      if (this.tweens.isTweening(sp)) return;
      const at = this.dealerSlot(i);
      sp.setPosition(at.x, at.y).setDepth(10 + i);
    });
    this.placeLabel(this.dealerLabel, Math.round(this.W / 2), this.dealerTop + CARD_H + 3);
    this.placeArrow();
  }

  private placeLabel(label: Phaser.GameObjects.Container, cx: number, top: number) {
    label.setPosition(cx, top);
  }

  private placeArrow() {
    const show = this.state === 'playing' && this.seats.length > 1;
    this.arrow.setVisible(show);
    if (!show) return;
    const { cx } = this.seatCentre(this.active);
    this.arrow.setPosition(cx, this.playerTop - 3);
  }

  // ---- HUD and labels -------------------------------------------------------------------

  private updateHud() {
    this.bankText.setText(money(this.shownBank));
    const inRun = this.state !== 'title';
    this.bankText.setVisible(inRun);
    this.handText.setVisible(inRun);
    this.handText.setText(this.handNo >= HANDS ? 'LAST HAND' : `HAND ${Math.max(1, this.handNo)} OF ${HANDS}`);
    this.showControls();
  }

  /** Counts the bank display up or down to the real bank. */
  private rollBank() {
    this.bankTween?.stop();
    const from = this.shownBank;
    const to = this.bank;
    if (from === to) return this.updateHud();
    const counter = { v: from };
    this.bankTween = this.tweens.add({
      targets: counter,
      v: to,
      duration: Math.min(700, 150 + Math.abs(to - from) * 2),
      onUpdate: () => {
        this.shownBank = Math.round(counter.v);
        this.bankText.setText(money(this.shownBank));
      },
      onComplete: () => {
        this.shownBank = to;
        this.bankText.setText(money(to));
      },
    });
  }

  /** A little ink pill with a total in it, centred under a hand. */
  private setLabel(label: Phaser.GameObjects.Container, str: string, tint = 0xffffff) {
    label.removeAll(true);
    if (!str) return;
    const t = this.text(0, 0, str, tint).setOrigin(0.5, 0);
    const w = Math.max(16, Math.ceil(t.width) + 6);
    const g = this.add.graphics();
    const x = -Math.floor(w / 2);
    g.fillStyle(SHADE, 0.85).fillRect(x + 1, 0, w - 2, 13).fillRect(x, 1, w, 11);
    t.setPosition(0, 1);
    label.add([g, t]);
  }

  private refreshLabels() {
    this.seats.forEach((seat) => {
      const cards = seat.hand.cards;
      const t = total(cards).total;
      let str = totalLabel(cards);
      let tint = 0xffffff;
      if (handBlackjack(seat.hand)) {
        str = 'BLACKJACK';
        tint = GOLD;
      } else if (t > 21) {
        str = `BUST ${t}`;
        tint = 0xff8a8a;
      } else if (t === 21) tint = GOLD;
      this.setLabel(seat.label, str, tint);
    });
    const shown = this.dealerSprites.filter((sp) => sp.getData('up')).map((sp) => sp.getData('card') as Card);
    const dt = total(shown).total;
    this.setLabel(this.dealerLabel, shown.length && this.state !== 'betting' ? (dt > 21 ? `BUST ${dt}` : totalLabel(shown)) : '', dt > 21 ? 0xff8a8a : 0xffffff);
  }

  // ---- Buttons ---------------------------------------------------------------------------

  private makeButton(key: string, label: string, colour: number, onClick: () => void, icon?: string): PixelButton {
    const face = this.add.container(0, 0);
    const root = this.add.container(0, 0, [face]).setDepth(40);
    const b: PixelButton = { key, x: 0, y: 0, w: 10, h: 10, root, face, enabled: true, hint: false, visible: false, colour, label, onClick };
    if (icon) b.root.setData('icon', icon);
    root.setVisible(false);
    return b;
  }

  private placeButton(b: PixelButton, x: number, y: number, w: number, h: number) {
    Object.assign(b, { x, y, w, h });
    b.root.setPosition(x, y);
    this.redrawButton(b);
  }

  private redrawButton(b: PixelButton, down = false) {
    b.face.removeAll(true);
    const icon = b.root.getData('icon') as string | undefined;
    b.root.list.filter((o) => o !== b.face).forEach((o) => o.destroy());
    if (icon) {
      // A chip to tap: lifts a pixel when it's the next one you'd add, greys out when it won't fit.
      const img = this.add.image(Math.floor(b.w / 2), Math.floor(b.h / 2) + (down ? 1 : 0), icon).setScale(2);
      img.setAlpha(b.enabled ? 1 : 0.35);
      const shadow = this.add.image(Math.floor(b.w / 2), Math.floor(b.h / 2) + 2, icon).setScale(2).setTint(0x000000).setTintMode(Phaser.TintModes.FILL).setAlpha(0.3);
      b.face.add([shadow, img]);
      return;
    }
    const g = this.add.graphics();
    const { w, h } = b;
    const box = (x: number, y: number, bw: number, bh: number, c: number, a = 1) => g.fillStyle(c, a).fillRect(x + 1, y, bw - 2, bh).fillRect(x, y + 1, bw, bh - 2);
    const dy = down ? 1 : 0;
    const colour = b.enabled ? b.colour : 0x6d7883;
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3).fillRect(1, 2, w - 2, h).fillRect(0, 3, w, h - 2);
    b.root.addAt(shadow, 0);
    box(0, dy, w, h, b.hint ? GOLD : SHADE);
    box(1, dy + 1, w - 2, h - 2, colour);
    g.fillStyle(0xffffff, b.enabled ? 0.3 : 0.12).fillRect(2, dy + 1, w - 4, 1);
    const isTips = b.key === 'tips';
    const str = isTips ? (this.tips ? 'TIPS ON' : 'TIPS OFF') : b.label;
    const t = this.text(Math.floor(w / 2), Math.floor(h / 2) + dy, str, b.enabled ? 0xffffff : 0xb8c0c8).setOrigin(0.5);
    // Bitmap text centres on half pixels with odd widths; keep its letters on whole ones.
    t.setPosition(Math.round(t.x - (t.width % 2) / 2) + (t.width % 2 ? 0.5 : 0), Math.round(t.y - (t.height % 2) / 2) + (t.height % 2 ? 0.5 : 0));
    b.face.add([g, t]);
    if (isTips && b.w < 50) {
      const tw = Math.ceil(t.width) + 8;
      if (tw !== b.w) this.placeButton(b, b.x, b.y, tw, b.h);
    }
  }

  private setButton(key: string, visible: boolean, enabled = true, hint = false) {
    const b = this.button(key);
    const changed = b.visible !== visible || b.enabled !== enabled || b.hint !== hint;
    b.visible = visible;
    b.enabled = enabled;
    b.hint = hint;
    b.root.setVisible(visible);
    if (changed) this.redrawButton(b);
  }

  /** Shows the buttons that fit what's happening at the table. */
  private showControls() {
    const betting = this.state === 'betting';
    const playing = this.state === 'playing';
    const busy = this.state === 'busy';
    const seat = this.seats[this.active];
    const hint = playing && this.tips && seat ? bestMove(this.seats.map((s) => s.hand), seat.hand, this.dealer[0]) : undefined;
    for (const m of MOVES) {
      let ok = playing && !!seat;
      if (ok && m.key === 'double') ok = canDouble(seat.hand) && this.bank >= seat.hand.bet;
      if (ok && m.key === 'split') ok = canSplit(this.seats.map((s) => s.hand), seat.hand) && this.bank >= seat.hand.bet;
      this.setButton(m.key, playing || busy, ok, ok && hint === m.key);
    }
    this.setButton('clear', betting, this.bet > 0);
    this.setButton('deal', betting, this.bet >= MIN_BET);
    this.setButton('tips', betting || playing || busy);
    CHIPS.forEach((c, i) => {
      this.setButton(`chip${i}`, betting, this.bank >= c.value);
      this.chipLabels[i].setVisible(betting).setAlpha(this.bank >= c.value ? 1 : 0.4);
    });
  }

  private buttonAt(p: Phaser.Input.Pointer) {
    const x = p.x / this.zoom;
    const y = p.y / this.zoom;
    const live = this.overlay ? this.overlayButtons : this.buttons;
    // Generous hit areas: a few pixels round each button count too.
    return live.find((b) => b.visible && b.enabled && x >= b.x - 2 && x < b.x + b.w + 2 && y >= b.y - 3 && y < b.y + b.h + 3);
  }

  private pointerDown(p: Phaser.Input.Pointer) {
    const b = this.buttonAt(p);
    if (!b) return;
    this.pressed = b;
    this.redrawButton(b, true);
  }

  private pointerMove(p: Phaser.Input.Pointer) {
    const b = this.buttonAt(p);
    this.input.setDefaultCursor(b ? 'pointer' : 'default');
    if (this.pressed && b !== this.pressed && p.isDown) {
      this.redrawButton(this.pressed);
      this.pressed = undefined;
    }
  }

  private pointerUp(p: Phaser.Input.Pointer) {
    const b = this.pressed;
    this.pressed = undefined;
    if (!b) return;
    this.redrawButton(b);
    if (this.buttonAt(p) === b) b.onClick();
  }

  private keyDown(e: KeyboardEvent) {
    if (e.repeat) return;
    const k = e.key.toUpperCase();
    if (this.overlay) {
      if (k === ' ' || k === 'ENTER') this.overlayButtons.find((b) => b.visible && b.enabled)?.onClick();
      return;
    }
    if (this.state === 'betting') {
      if (k === ' ' || k === 'ENTER') this.deal();
      else if (k === 'BACKSPACE' || k === 'C') this.clearBet();
      else if (k >= '1' && k <= '4') this.addChip(Number(k) - 1);
    } else if (this.state === 'playing') {
      const m = MOVES.find((mv) => mv.hotkey === k);
      if (m) this.act(m.key);
    }
    if (k === 'T') this.toggleTips();
  }

  private toggleTips() {
    this.tips = !this.tips;
    save('blackjack:tips', this.tips);
    playSfx(this, SFX, 'click', { volume: 0.4 });
    this.redrawButton(this.button('tips'));
    this.showControls();
  }

  // ---- Betting ---------------------------------------------------------------------------

  private startRun() {
    this.bank = START_BANK;
    this.shownBank = START_BANK;
    this.peak = START_BANK;
    this.handNo = 0;
    this.lastBet = FIRST_BET;
    this.shoe.shuffle();
    this.setOverlay();
    this.music ??= this.sound.add('music', { loop: true, volume: 0.25 });
    if (!this.music.isPlaying) this.music.play();
    this.startBetting();
  }

  private startBetting() {
    this.handNo++;
    this.clearTable();
    this.seats = [this.makeSeat(newHand(0))];
    this.active = 0;
    this.state = 'betting';
    this.bet = 0;
    // Last hand's bet goes straight back down, so a hand can be one tap.
    const again = Math.min(this.lastBet, this.bank);
    if (again >= MIN_BET) this.placeBet(again - (again % MIN_BET));
    this.snapAll();
    this.refreshLabels();
    this.updateHud();
    if (this.handNo === HANDS) {
      this.banner('LAST HAND', GOLD);
      this.voice('final_round');
    }
    if (this.shoe.needsShuffle) {
      this.shoe.shuffle();
      playSfx(this, SFX, 'shuffle', { volume: 0.6 });
      this.banner('NEW SHOE', 0xffffff);
    }
  }

  private makeSeat(hand: Hand): Seat {
    const ring = this.add.image(0, 0, 'ring').setDepth(1);
    const stack = this.add.container(0, 0).setDepth(3);
    const label = this.add.container(0, 0).setDepth(30);
    return { hand, sprites: [], stack, ring, label };
  }

  private placeBet(amount: number) {
    this.bet = amount;
    this.bank -= amount;
    this.seats[0].hand.bet = amount;
    this.drawStack(this.seats[0].stack, amount);
    this.shownBank = this.bank;
    this.updateHud();
  }

  private addChip(i: number) {
    if (this.state !== 'betting') return;
    const value = CHIPS[i].value;
    if (this.bank < value) {
      playSfx(this, SFX, 'nope', { volume: 0.4 });
      return;
    }
    playSfx(this, SFX, 'chip', { volume: 0.7 });
    this.bank -= value;
    this.bet += value;
    this.seats[0].hand.bet = this.bet;
    this.shownBank = this.bank;
    // The chip slides from its button onto the stack, which takes it when it lands.
    const b = this.chipButtons[i];
    const fly = this.add.image(b.x + b.w / 2, b.y + b.h / 2, `${CHIP}:${i}`).setDepth(50);
    const seat = this.seats[0];
    const top = seat.stack.y - 4 - CHIP_STEP * Math.min(COLUMN_MAX, chipsFor(this.bet).length);
    this.tweens.add({
      targets: fly,
      x: seat.stack.x,
      y: top,
      duration: 140,
      ease: 'Quad.easeOut',
      onComplete: () => {
        fly.destroy();
        this.drawStack(seat.stack, seat.hand.bet);
      },
    });
    this.updateHud();
  }

  private clearBet() {
    if (this.state !== 'betting' || !this.bet) return;
    playSfx(this, SFX, 'handle', { volume: 0.6 });
    this.bank += this.bet;
    this.shownBank = this.bank;
    this.bet = 0;
    this.seats[0].hand.bet = 0;
    this.drawStack(this.seats[0].stack, 0);
    this.updateHud();
  }

  /**
   * Chips for an amount, in columns by colour from the left, each stacked three pixels a chip.
   * The container's origin is the middle of the bet circle.
   */
  private drawStack(stack: Phaser.GameObjects.Container, amount: number) {
    stack.removeAll(true);
    const chips = chipsFor(amount);
    const kinds = [...new Set(chips)];
    // Very tall piles spill into a second column of the same colour.
    const columns: number[][] = [];
    for (const k of kinds) {
      const n = chips.filter((c) => c === k).length;
      for (let i = 0; i < n; i += COLUMN_MAX) columns.push(Array(Math.min(COLUMN_MAX, n - i)).fill(k));
    }
    const step = 13;
    columns.forEach((col, ci) => {
      const x = Math.round((ci - (columns.length - 1) / 2) * step);
      col.forEach((k, i) => stack.add(this.add.image(x, 2 - i * CHIP_STEP, `${CHIP}:${k}`)));
    });
    // The amount, to the right of the chips.
    if (amount > 0) stack.add(this.text(Math.round(((columns.length - 1) / 2) * step) + 12, -4, money(amount), 0xffffff));
  }

  // ---- Dealing ------------------------------------------------------------------------------

  private wait(ms: number) {
    return new Promise<void>((resolve) => this.time.delayedCall(ms, resolve));
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig) {
    return new Promise<void>((resolve) => {
      this.tweens.add({ ...config, onComplete: () => resolve(), onStop: () => resolve() });
    });
  }

  /** Sends a card from the shoe to a spot, landing face up unless it's the dealer's hole card. */
  private async dealCard(to: { x: number; y: number }, card: Card, faceUp: boolean, depth: number) {
    const sp = this.add.image(this.shoeSprite.x, this.shoeSprite.y, CARD_SHEET, BACK).setDepth(60 + depth);
    sp.setData('card', card).setData('up', false);
    playSfx(this, SFX, 'deal', { volume: 0.5 });
    await this.tween({ targets: sp, x: to.x, y: to.y, duration: 220, ease: 'Cubic.easeOut' });
    sp.setDepth(10 + depth);
    if (faceUp) await this.flip(sp);
    else playSfx(this, SFX, 'place', { volume: 0.4 });
    return sp;
  }

  /** Turns a card over: squeezes it edge-on, swaps the face, and opens it out again. */
  private async flip(sp: Phaser.GameObjects.Image) {
    playSfx(this, SFX, 'flip', { volume: 0.35 });
    await this.tween({ targets: sp, scaleX: 0, duration: 70, ease: 'Quad.easeIn' });
    sp.setFrame(cardFrame(sp.getData('card') as Card)).setData('up', true);
    await this.tween({ targets: sp, scaleX: 1, duration: 70, ease: 'Quad.easeOut' });
    sp.setScale(1);
  }

  private async deal() {
    if (this.state !== 'betting' || this.bet < MIN_BET) return;
    this.state = 'busy';
    this.lastBet = this.bet;
    this.updateHud();
    playSfx(this, SFX, 'click', { volume: 0.4 });
    const seat = this.seats[0];
    this.dealer = [];
    // Player, dealer, player, dealer's hole card, as at a real table.
    for (let round = 0; round < 2; round++) {
      const pc = this.shoe.draw();
      seat.hand.cards.push(pc);
      this.relayoutSeat(0);
      seat.sprites.push(await this.dealCard(this.seatCardSlot(0, round), pc, true, round));
      this.refreshLabels();
      const dc = this.shoe.draw();
      this.dealer.push(dc);
      this.relayoutDealer();
      this.dealerSprites.push(await this.dealCard(this.dealerSlot(round), dc, round === 0, round));
      this.refreshLabels();
    }
    // Under an ace or a ten the dealer checks for blackjack first.
    if (dealerPeeks(this.dealer[0])) {
      const hole = this.dealerSprites[1];
      await this.wait(200);
      await this.tween({ targets: hole, y: hole.y - 3, duration: 120, yoyo: true, ease: 'Quad.easeOut' });
      if (isBlackjack(this.dealer)) {
        await this.flip(hole);
        this.refreshLabels();
        this.popup(this.dealerSlotCentre(), 'BLACKJACK', RED);
        await this.wait(500);
        return this.settle();
      }
    }
    if (handBlackjack(seat.hand)) {
      await this.wait(250);
      return this.dealerTurn();
    }
    this.startTurn(0);
  }

  private dealerSlotCentre() {
    return { x: Math.round(this.W / 2), y: this.dealerTop + CARD_H / 2 };
  }

  /** Slides a hand's cards into their new places as it grows. */
  private relayoutSeat(s: number) {
    const seat = this.seats[s];
    seat.sprites.forEach((sp, i) => {
      const at = this.seatCardSlot(s, i);
      if (sp.x !== at.x) this.tweens.add({ targets: sp, x: at.x, duration: 120 });
    });
  }

  private relayoutDealer() {
    this.dealerSprites.forEach((sp, i) => {
      const at = this.dealerSlot(i);
      if (sp.x !== at.x) this.tweens.add({ targets: sp, x: at.x, duration: 120 });
    });
  }

  // ---- Playing ------------------------------------------------------------------------------

  private startTurn(s: number): void {
    this.active = s;
    const seat = this.seats[s];
    // A split ace gets one card, and 21 plays itself.
    if (seat.hand.done || total(seat.hand.cards).total >= 21) {
      seat.hand.done = true;
      return this.nextSeat();
    }
    this.state = 'playing';
    this.placeArrow();
    this.updateHud();
  }

  private async act(move: Move) {
    if (this.state !== 'playing') return;
    const s = this.active;
    const seat = this.seats[s];
    const hand = seat.hand;
    const hands = this.seats.map((x) => x.hand);
    if (move === 'double' && !(canDouble(hand) && this.bank >= hand.bet)) return this.refuse();
    if (move === 'split' && !(canSplit(hands, hand) && this.bank >= hand.bet)) return this.refuse();
    this.state = 'busy';
    this.updateHud();
    playSfx(this, SFX, 'click', { volume: 0.35 });

    if (move === 'stand') {
      hand.done = true;
      this.tweens.add({ targets: seat.sprites, y: '-=2', duration: 80, yoyo: true });
      await this.wait(160);
      return this.nextSeat();
    }
    if (move === 'double') {
      this.bank -= hand.bet;
      this.shownBank = this.bank;
      hand.bet *= 2;
      hand.doubled = true;
      playSfx(this, SFX, 'chips', { volume: 0.6 });
      this.drawStack(seat.stack, hand.bet);
      this.updateHud();
      await this.hit(s);
      hand.done = true;
      await this.wait(250);
      return this.nextSeat();
    }
    if (move === 'split') return this.split();
    await this.hit(s);
    if (total(hand.cards).total >= 21) {
      hand.done = true;
      await this.wait(isBust(hand) ? 450 : 250);
      return this.nextSeat();
    }
    this.state = 'playing';
    this.updateHud();
  }

  private refuse() {
    playSfx(this, SFX, 'nope', { volume: 0.4 });
  }

  private async hit(s: number) {
    const seat = this.seats[s];
    const card = this.shoe.draw();
    seat.hand.cards.push(card);
    this.relayoutSeat(s);
    const i = seat.hand.cards.length - 1;
    seat.sprites.push(await this.dealCard(this.seatCardSlot(s, i), card, true, i));
    this.refreshLabels();
    if (isBust(seat.hand)) {
      playSfx(this, SFX, 'bust', { volume: 0.5 });
      this.shake(seat.sprites);
      this.popup({ x: this.seatCentre(s).cx, y: this.playerTop + CARD_H / 2 }, 'BUST', 0xff6a6a);
    } else if (total(seat.hand.cards).total === 21) {
      this.popup({ x: this.seatCentre(s).cx, y: this.playerTop + CARD_H / 2 }, '21', GOLD);
    }
  }

  private async split() {
    const first = this.seats[0];
    this.bank -= first.hand.bet;
    this.shownBank = this.bank;
    const second = this.makeSeat(newHand(first.hand.bet, true));
    first.hand.split = true;
    second.hand.cards.push(first.hand.cards.pop()!);
    second.sprites.push(first.sprites.pop()!);
    this.seats.push(second);
    playSfx(this, SFX, 'chips', { volume: 0.6 });
    this.drawStack(second.stack, second.hand.bet);
    this.updateHud();
    // Both hands slide apart, and the second bet joins its circle.
    const moves: Promise<void>[] = [];
    this.seats.forEach((seat, s) => {
      seat.sprites.forEach((sp, i) => {
        const at = this.seatCardSlot(s, i);
        moves.push(this.tween({ targets: sp, x: at.x, y: at.y, duration: 220, ease: 'Cubic.easeOut' }));
      });
      const { cx } = this.seatCentre(s);
      seat.ring.setPosition(cx, this.betY);
      moves.push(this.tween({ targets: seat.stack, x: cx, y: this.betY, duration: 220, ease: 'Cubic.easeOut' }));
    });
    second.stack.setPosition(first.stack.x, this.betY);
    await Promise.all(moves);
    this.snapAll();
    this.refreshLabels();
    // Each hand gets its second card; split aces stop there.
    for (let s = 0; s < 2; s++) {
      await this.hit(s);
      if (this.seats[s].hand.cards[0].rank === 1) this.seats[s].hand.done = true;
    }
    this.startTurn(0);
  }

  private nextSeat(): void {
    const next = this.active + 1;
    if (next < this.seats.length) return this.startTurn(next);
    this.state = 'busy';
    this.arrow.setVisible(false);
    this.updateHud();
    void this.dealerTurn();
  }

  private async dealerTurn() {
    this.state = 'busy';
    this.updateHud();
    const hole = this.dealerSprites[1];
    await this.wait(200);
    if (!hole.getData('up')) await this.flip(hole);
    this.refreshLabels();
    // The dealer only draws if a hand is still standing against it, and not a blackjack.
    const live = this.seats.some((s) => !isBust(s.hand) && !handBlackjack(s.hand));
    if (live) {
      while (dealerHits(this.dealer)) {
        await this.wait(380);
        const card = this.shoe.draw();
        this.dealer.push(card);
        this.relayoutDealer();
        this.dealerSprites.push(await this.dealCard(this.dealerSlot(this.dealer.length - 1), card, true, this.dealer.length - 1));
        this.refreshLabels();
      }
      if (total(this.dealer).total > 21) {
        playSfx(this, SFX, 'bust', { volume: 0.4 });
        this.shake(this.dealerSprites);
        this.popup(this.dealerSlotCentre(), 'DEALER BUSTS', GOLD);
      }
    }
    await this.wait(450);
    return this.settle();
  }

  // ---- Settling -------------------------------------------------------------------------------

  private async settle() {
    this.state = 'busy';
    this.arrow.setVisible(false);
    let best: Outcome | undefined;
    const rank: Outcome[] = ['bust', 'lose', 'push', 'win', 'blackjack'];
    for (let s = 0; s < this.seats.length; s++) {
      const seat = this.seats[s];
      const result = outcome(seat.hand, this.dealer);
      seat.result = result;
      if (!best || rank.indexOf(result) > rank.indexOf(best)) best = result;
    }
    const sound: Record<Outcome, keyof typeof SFX> = { blackjack: 'blackjack', win: 'win', push: 'chips', lose: 'lose', bust: 'lose' };
    if (best) playSfx(this, SFX, sound[best], { volume: best === 'push' ? 0.5 : 0.45, detune: 0 });
    if (best === 'blackjack') this.voice('you_win');
    await Promise.all(this.seats.map((seat, s) => this.payOut(seat, s)));
    this.rollBank();
    this.peak = Math.max(this.peak, this.bank);
    await this.wait(900);
    await this.collect();
    if (this.bank < MIN_BET || this.handNo >= HANDS) return this.endRun();
    this.startBetting();
  }

  /** Moves a hand's chips: the dealer pays out next to the bet and it all comes to you, or the dealer takes it. */
  private async payOut(seat: Seat, s: number) {
    const result = seat.result!;
    const { cx } = this.seatCentre(s);
    const back = payout(seat.hand, result);
    const words: Record<Outcome, [string, number]> = {
      blackjack: [`BLACKJACK +${money(back - seat.hand.bet)}`, GOLD],
      win: [`WIN +${money(back - seat.hand.bet)}`, GOLD],
      push: ['PUSH', 0xffffff],
      lose: ['LOSE', 0xff8a8a],
      bust: ['BUST', 0xff8a8a],
    };
    const [word, tint] = words[result];
    this.popup({ x: cx, y: this.playerTop + CARD_H / 2 }, word, tint, result === 'blackjack' ? 2 : 1);
    if (result === 'win' || result === 'blackjack') this.sparkle(cx, this.playerTop + CARD_H / 2);
    this.bank += back;
    if (back === 0) {
      // Raked up to the dealer.
      await this.wait(250);
      playSfx(this, SFX, 'rake', { volume: 0.5 });
      await this.tween({ targets: seat.stack, y: this.dealerTop + 10, alpha: 0, duration: 380, ease: 'Quad.easeIn' });
      return;
    }
    if (back > seat.hand.bet) {
      // Winnings slide down from the dealer and stack beside the bet.
      const pay = this.add.container(Math.round(this.W / 2), this.dealerTop + 10).setDepth(4).setAlpha(0);
      this.drawStack(pay, back - seat.hand.bet);
      await this.wait(200);
      playSfx(this, SFX, 'chips', { volume: 0.6 });
      await this.tween({ targets: pay, x: cx + 22, y: this.betY, alpha: 1, duration: 320, ease: 'Cubic.easeOut' });
      await this.wait(350);
      playSfx(this, SFX, 'handle', { volume: 0.5 });
      void this.tween({ targets: pay, x: this.hudX - 20, y: 10, alpha: 0, duration: 380, ease: 'Quad.easeIn' }).then(() => pay.destroy());
    } else await this.wait(550);
    await this.tween({ targets: seat.stack, x: this.hudX - 20, y: 10, alpha: 0, duration: 380, ease: 'Quad.easeIn' });
  }

  /** Sweeps the cards off to the right and clears the felt. */
  private async collect() {
    const all = [...this.dealerSprites, ...this.seats.flatMap((s) => s.sprites)];
    if (all.length) {
      playSfx(this, SFX, 'collect', { volume: 0.4 });
      await this.tween({ targets: all, x: this.W + 50, y: this.dealerTop, duration: 280, ease: 'Quad.easeIn' });
    }
    this.clearTable();
  }

  private clearTable() {
    this.dealerSprites.forEach((sp) => sp.destroy());
    this.dealerSprites = [];
    this.dealer = [];
    for (const seat of this.seats) {
      seat.sprites.forEach((sp) => sp.destroy());
      seat.stack.destroy();
      seat.ring.destroy();
      seat.label.destroy();
    }
    this.seats = [];
    this.setLabel(this.dealerLabel, '');
  }

  private endRun() {
    this.state = 'over';
    this.updateHud();
    this.music?.stop();
    const previous = this.best;
    const { best, isNew } = submitHighScore('blackjack', this.bank);
    this.best = best;
    const broke = this.bank < MIN_BET;
    this.voice(broke ? 'game_over' : isNew && previous > 0 ? 'new_highscore' : 'game_over');
    this.showGameOver(broke, isNew && previous > 0);
  }

  // ---- Effects -------------------------------------------------------------------------------

  private popup(at: { x: number; y: number }, str: string, tint: number, scale = 1) {
    const t = this.text(at.x, at.y, str, tint).setOrigin(0.5).setDepth(70).setScale(0);
    this.tweens.add({ targets: t, scale: scale * 2, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: at.y - 10, alpha: 0, delay: 900, duration: 400, onComplete: () => t.destroy() });
  }

  private banner(str: string, tint: number) {
    const t = this.text(Math.round(this.W / 2), Math.round((this.dealerTop + CARD_H + this.playerTop) / 2), str, tint).setOrigin(0.5).setDepth(70).setScale(0);
    this.tweens.add({ targets: t, scale: 2, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 1100, duration: 300, onComplete: () => t.destroy() });
  }

  private shake(sprites: Phaser.GameObjects.Image[]) {
    for (const sp of sprites) this.tweens.add({ targets: sp, x: sp.x + 2, duration: 40, yoyo: true, repeat: 3, ease: 'Stepped' });
  }

  /** Gold pixels bursting out of a winning hand. */
  private sparkle(x: number, y: number) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const r = 26 + Math.random() * 16;
      const dot = this.add.rectangle(x, y, 2, 2, i % 3 ? GOLD : 0xffffff).setDepth(65);
      this.tweens.add({ targets: dot, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.8, alpha: 0, duration: 600 + Math.random() * 200, ease: 'Cubic.easeOut', onComplete: () => dot.destroy() });
    }
  }

  private voice(name: Voice) {
    this.sound.play(`voice:${name}`, { volume: 0.8 });
  }

  // ---- Overlays ------------------------------------------------------------------------------

  private setOverlay(build?: () => Phaser.GameObjects.GameObject[]) {
    this.rebuildOverlay = build && (() => this.setOverlay(build));
    this.overlay?.destroy();
    this.overlay = undefined;
    this.overlayButtons.forEach((b) => b.root.destroy());
    this.overlayButtons = [];
    if (!build) return;
    this.overlay = this.add.container(0, 0, build()).setDepth(100);
  }

  /** A notched ink panel with a pale edge. */
  private panel(x: number, y: number, w: number, h: number) {
    const g = this.add.graphics();
    const box = (dx: number, dy: number, bw: number, bh: number, c: number, a = 1) => g.fillStyle(c, a).fillRect(x + dx + 1, y + dy, bw - 2, bh).fillRect(x + dx, y + dy + 1, bw, bh - 2);
    box(0, 2, w, h, 0x000000, 0.3);
    box(-1, -1, w + 2, h + 2, PALE);
    box(0, 0, w, h, INK);
    return g;
  }

  private overlayButton(cx: number, y: number, label: string, colour: number, onClick: () => void) {
    const probe = this.text(0, 0, label);
    const w = Math.max(70, Math.ceil(probe.width) + 24);
    probe.destroy();
    const b = this.makeButton(`overlay:${label}`, label, colour, onClick);
    b.visible = true;
    b.root.setVisible(true).setDepth(110);
    this.placeButton(b, Math.round(cx - w / 2), y, w, 24);
    this.overlayButtons.push(b);
    return b;
  }

  private showTitle() {
    this.state = 'title';
    this.updateHud();
    this.setOverlay(() => {
      const { W, H } = this;
      const cx = Math.round(W / 2);
      // Bare felt behind the title: no shoe or printed rules yet.
      const cover = this.add.tileSprite(0, 0, W + 16, H + 16, 'felt').setOrigin(0);
      const title = this.text(cx, 0, 'BLACKJACK', 0xffffff).setOrigin(0.5, 0).setScale(W >= 200 ? 3 : 2);
      // A fanned ace and jack under the title: the hand you're after.
      const ace = this.add.image(cx - 12, 0, CARD_SHEET, cardFrame({ rank: 1, suit: 'spades' }));
      const jack = this.add.image(cx + 12, 0, CARD_SHEET, cardFrame({ rank: 11, suit: 'hearts' }));
      const lines = [`${HANDS} HANDS. START WITH ${money(START_BANK)}.`, 'FINISH WITH ALL THE CHIPS', 'YOU CAN. BLACKJACK PAYS 3 TO 2.'];
      // Keys for keyboard players: H, S, D and P to play, Space to deal.
      if (!window.matchMedia('(pointer: coarse)').matches) lines.push('KEYS: H S D P, SPACE DEALS');
      const texts = lines.map((l, i) => this.text(cx, 0, l, i === 0 ? GOLD : 0xffffff).setOrigin(0.5, 0));
      const panelW = Math.min(W - 12, Math.max(...texts.map((t) => Math.ceil(t.width))) + 16);
      const panelH = 8 + texts.length * 12 + 6;
      const total = title.height + 6 + CARD_H + 8 + panelH + 10 + 24 + (this.best ? 16 : 0);
      let y = Math.max(4, Math.round((H - total) / 2));
      title.setY(y);
      y += Math.round(title.height) + 6;
      ace.setY(y + CARD_H / 2).setAngle(0);
      jack.setY(y + CARD_H / 2 + 2);
      this.tweens.add({ targets: jack, y: jack.y - 2, duration: 500, yoyo: true, repeat: -1, ease: 'Stepped' });
      y += CARD_H + 8;
      const panel = this.panel(Math.round(cx - panelW / 2), y, panelW, panelH);
      texts.forEach((t, i) => t.setY(y + 6 + i * 12));
      y += panelH + 10;
      const parts: Phaser.GameObjects.GameObject[] = [cover, title, ace, jack, panel, ...texts];
      this.overlayButton(cx, y, 'DEAL ME IN', 0x3aa55c, () => {
        playSfx(this, SFX, 'shuffle', { volume: 0.6 });
        this.startRun();
      });
      y += 30;
      if (this.best) parts.push(this.text(cx, y, `BEST ${money(this.best)}`, GOLD).setOrigin(0.5, 0));
      return parts;
    });
  }

  private showGameOver(broke: boolean, record: boolean) {
    this.setOverlay(() => {
      const { W, H } = this;
      const cx = Math.round(W / 2);
      const shade = this.add.rectangle(0, 0, W + 16, H + 16, SHADE, 0.8).setOrigin(0);
      const title = this.text(cx, 0, broke ? 'BROKE' : 'CASH OUT', broke ? 0xff8a8a : 0xffffff).setOrigin(0.5, 0).setScale(W >= 200 ? 3 : 2);
      const rows: [string, string, number][] = [
        ['FINISHED WITH', money(this.bank), GOLD],
        ['MOST AT ONCE', money(this.peak), 0xffffff],
        ['BEST FINISH', money(this.best), 0xffffff],
      ];
      const panelW = Math.min(W - 12, 170);
      const panelH = 8 + rows.length * 14 + 4;
      const total = title.height + 8 + panelH + 12 + 24;
      let y = Math.max(4, Math.round((H - total) / 2));
      title.setY(y);
      y += Math.round(title.height) + 8;
      const left = Math.round(cx - panelW / 2);
      const panel = this.panel(left, y, panelW, panelH);
      const texts = rows.flatMap(([name, value, tint], i) => [
        this.text(left + 8, y + 6 + i * 14, name, PALE),
        this.text(left + panelW - 8, y + 6 + i * 14, value, tint).setOrigin(1, 0),
      ]);
      const parts: Phaser.GameObjects.GameObject[] = [shade, title, panel, ...texts];
      if (record) {
        const tag = this.text(left + panelW - 8, y + 6 + 2 * 14 - 10, 'NEW BEST!', 0xff6a5c).setOrigin(1, 0);
        this.tweens.add({ targets: tag, alpha: 0.3, duration: 250, yoyo: true, repeat: 5 });
        playSfx(this, SFX, 'record', { volume: 0.6, detune: 0 });
        parts.push(tag);
      }
      y += panelH + 12;
      this.overlayButton(cx, y, 'PLAY AGAIN', 0x3aa55c, () => {
        playSfx(this, SFX, 'shuffle', { volume: 0.6 });
        this.startRun();
      });
      return parts;
    });
  }
}
