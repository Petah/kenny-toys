import * as Phaser from 'phaser';
import { FONT_BODY, FONT_HEADING } from '@shared/fonts';
import { ICONS, preloadIcons } from '@shared/icons';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { fitCard, makeButton } from '@shared/ui';
import {
  ANIMAL_TYPES, DAMAGE_FRAMES, FACE_PX, LASERS, PROPS, SFX, SHIPS, SHIP_COLOURS, ZOO,
  preloadAssets, unpackAtlases, type Animal, type ShipColour, type Voice,
} from './assets';

/** The world is at least 600 units tall and 420 wide; wider screens see more farm. */
const BASE_H = 600;
const MIN_W = 420;
/** Scenery overhangs the screen edges by this much so camera shake never shows past the world. */
const BLEED = 40;
/** The field's surface, up from the bottom of the screen. */
const GROUND_UP = 74;
const SHIP_Y = 118;
const SHIP_SCALE = 0.9;
/** The beam leaves the hull this far below the ship's centre. */
const BEAM_DROP = 38;
const BEAM_TOP_HALF = 14;
const BEAM_BOTTOM_HALF = 58;

const ROUND_S = 60;
const ORDER_BONUS_S = 8;
const MIN_ORDER_BONUS_S = 3;
const RAM_PENALTY_S = 5;
const COMBO_MS = 1500;
const MAX_COMBO = 5;
const SHIP_SPEED = 470;
const SHIP_SPEED_BEAMING = 230;

const TEXT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: FONT_HEADING,
  color: '#ffffff',
  stroke: '#1d2b53',
  align: 'center',
};

type State = 'title' | 'playing' | 'over';

interface Critter {
  type: Animal;
  body: MatterJS.BodyType;
  img: Phaser.GameObjects.Image;
  hopIn: number;
  /** In the beam right now. */
  lifted: boolean;
  /** A bull that has just rammed the ship ignores the beam until then. */
  calmUntil: number;
  /** How fast the beam is raising it, building up to its kind's rise speed. */
  liftSpeed: number;
  /** Squash from landing, easing back to 0. */
  squash: number;
  wasFalling: boolean;
}

export class FarmScene extends Phaser.Scene {
  private state: State = 'title';

  private world!: Phaser.GameObjects.Layer;
  private ui!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private sky!: Phaser.GameObjects.Graphics;
  private scenery: Phaser.GameObjects.GameObject[] = [];
  private clouds!: Phaser.GameObjects.TileSprite;
  private walls: MatterJS.BodyType[] = [];

  private ship!: Phaser.GameObjects.Container;
  private hull!: Phaser.GameObjects.Image;
  private dents!: Phaser.GameObjects.Image;
  private beam!: Phaser.GameObjects.Image;
  private rings: Phaser.GameObjects.Image[] = [];
  private glow!: Phaser.GameObjects.Image;
  private hum?: Phaser.Sound.BaseSound;
  private music?: Phaser.Sound.BaseSound;
  private colour: ShipColour = 'Green';

  private timeText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private board!: Phaser.GameObjects.Container;
  private overlay?: Phaser.GameObjects.Container;
  private rebuildOverlay?: () => void;
  private overlayTimers: Phaser.Time.TimerEvent[] = [];

  /** World size in units, and screen pixels per unit. */
  private vw = 0;
  private vh = 0;
  private u = 1;

  private critters: Critter[] = [];
  private spawnIn = 0;
  private sx = 0;
  private svx = 0;
  /** How far the ship has risen out of its usual hover, for flying off at the end. */
  private shipLift = 0;
  private tx = 0;
  private holding = false;
  private keys?: Record<'left' | 'right' | 'a' | 'd' | 'space', Phaser.Input.Keyboard.Key>;
  private beaming = false;
  private stunnedUntil = 0;
  private damage = 0;

  private timeLeft = ROUND_S;
  private elapsed = 0;
  private lastWhole = ROUND_S;
  private hurried = false;
  private score = 0;
  private best = 0;
  private abducted = 0;
  private combo = 0;
  private lastAbduct = -Infinity;
  private wanted: { type: Animal; got: boolean }[] = [];
  private orders = 0;
  private canRestart = false;

  constructor() {
    super('farm');
  }

  preload() {
    preloadAssets(this);
    preloadIcons(this);
  }

  // ---- Setup -------------------------------------------------------------------------------

  create() {
    unpackAtlases(this);
    this.world = this.add.layer();
    this.ui = this.add.layer();
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.ui);
    this.uiCam.ignore(this.world);

    this.sky = this.add.graphics().setDepth(0);
    this.clouds = this.add.tileSprite(0, 0, 10, 10, 'cloudLayer1').setOrigin(0, 1).setDepth(2).setTint(0x52609a).setAlpha(0.55).setTileScale(0.6);
    this.world.add([this.sky, this.clouds]);

    // The beam sits behind the ship and in front of the scenery; animals in it are drawn over it.
    this.beam = this.add.image(0, 0, LASERS, 'laserGreen2.png').setOrigin(0.5, 0).setDepth(20).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    for (let i = 0; i < 4; i++) this.rings.push(this.add.image(0, 0, LASERS, 'laserGreen3.png').setDepth(21).setBlendMode(Phaser.BlendModes.ADD).setVisible(false));
    this.glow = this.add.image(0, 0, LASERS, 'laserGreen_groundBurst.png').setOrigin(0.5, 1).setDepth(22).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.hull = this.add.image(0, 0, SHIPS, 'shipGreen_manned.png');
    this.dents = this.add.image(0, 0, SHIPS, 'shipGreen_damage1.png').setVisible(false);
    this.ship = this.add.container(0, 0, [this.hull, this.dents]).setDepth(40).setScale(SHIP_SCALE);
    this.world.add([this.beam, ...this.rings, this.glow, this.ship]);

    this.timeText = this.add.text(0, 0, '', { ...TEXT, fontSize: '44px', strokeThickness: 10 }).setOrigin(0.5, 0);
    this.scoreText = this.add.text(0, 0, '0', { ...TEXT, fontSize: '40px', strokeThickness: 10 }).setOrigin(1, 0);
    this.board = this.add.container(0, 0);
    this.ui.add([this.timeText, this.scoreText, this.board]);
    this.setHudVisible(false);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => (this.tx = p.x / this.u));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.tx = p.x / this.u;
      this.holding = true;
    });
    this.input.on('pointerup', () => (this.holding = false));
    this.input.on('gameout', () => (this.holding = false));
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE,LEFT,RIGHT');
      this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', a: 'A', d: 'D', space: 'SPACE' }) as typeof this.keys;
      for (const key of ['SPACE', 'ENTER']) kb.on(`keydown-${key}`, (e: KeyboardEvent) => !e.repeat && this.confirm());
    }
    this.matter.world.on('collisionstart', this.onCollisions, this);
    this.scale.on('resize', () => this.layout());

    this.best = load('abduction:best', 0);
    this.pickShip();
    this.layout();
    this.sx = this.tx = this.vw / 2;
    for (let i = 0; i < this.populationCap; i++) this.spawn(Phaser.Math.FloatBetween(0.1, 0.9) * this.vw);
    this.showTitle();
  }

  /** Fits the world to the screen: full height, as wide as the screen allows. */
  private layout() {
    const { width: w, height: h } = this.scale;
    this.u = Math.min(h / BASE_H, w / MIN_W);
    this.vw = w / this.u;
    this.vh = h / this.u;
    this.cameras.main.setSize(w, h).setZoom(this.u).centerOn(this.vw / 2, this.vh / 2);
    this.uiCam.setSize(w, h);

    const width = this.vw + BLEED * 2;
    this.sky.clear();
    this.sky.fillGradientStyle(0x0f1a3c, 0x0f1a3c, 0x46589a, 0x46589a, 1);
    this.sky.fillRect(-BLEED, -BLEED, width, this.vh + BLEED * 2);
    this.clouds.setPosition(-BLEED, this.groundY - 120).setSize(width, 220);
    this.buildScenery();

    // The field and the walls just past each edge of the screen.
    for (const b of this.walls) this.matter.world.remove(b);
    const opts = { isStatic: true, friction: 0.9, label: 'ground' };
    this.walls = [
      this.matter.add.rectangle(this.vw / 2, this.groundY + 100, this.vw + 600, 200, opts),
      this.matter.add.rectangle(-70, this.vh / 2, 60, this.vh * 3, { ...opts, label: 'wall' }),
      this.matter.add.rectangle(this.vw + 70, this.vh / 2, 60, this.vh * 3, { ...opts, label: 'wall' }),
    ];
    for (const c of this.critters) {
      if (c.body.position.y > this.groundY) this.matter.body.setPosition(c.body, { x: c.body.position.x, y: this.groundY - c.type.size / 2 }, false);
    }

    this.layoutHud();
    this.rebuildOverlay?.();
  }

  private get groundY() {
    return this.vh - GROUND_UP;
  }

  /**
   * Night on the farm: stars and the moon, dark hills, a farmhouse with fences and trees along
   * the horizon, and the field in front. Laid out the same way every time for a given width.
   */
  private buildScenery() {
    this.scenery.forEach((o) => o.destroy());
    this.scenery = [];
    const rnd = new Phaser.Math.RandomDataGenerator(['abduction']);
    const width = this.vw + BLEED * 2;
    const g = this.groundY;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.scenery.push(o), o);

    for (let i = 0; i < Math.round(this.vw / 12); i++) {
      const star = add(this.add.circle(rnd.between(0, this.vw), rnd.between(0, g - 200), rnd.realInRange(0.8, 2), 0xffffff).setDepth(1));
      this.tweens.add({ targets: star, alpha: { from: rnd.realInRange(0.3, 1), to: 0.15 }, duration: rnd.between(600, 1800), yoyo: true, repeat: -1, delay: rnd.between(0, 1500) });
    }
    const mx = Math.min(this.vw - 70, this.vw * 0.84);
    add(this.add.circle(mx, 86, 70, 0xfff4c8, 0.08).setDepth(1));
    add(this.add.image(mx, 86, PROPS, 'moonFull.png').setDepth(1).setScale(0.9));

    // Each layer is exactly one texture tall, so it never repeats upwards.
    add(this.add.tileSprite(-BLEED, g + 10, width, 200, 'hillsLarge').setOrigin(0, 1).setTint(0x2a3a6a).setTileScale(0.55, 0.5).setDepth(3));
    add(this.add.tileSprite(-BLEED, g + 20, width, 160, 'hills').setOrigin(0, 1).setTint(0x23465e).setTileScale(0.7, 0.4).setTilePosition(300, 0).setDepth(4));

    // Props on the horizon, dimmed to match the night.
    const dusk = 0x8a93c8;
    const houseX = this.vw * rnd.realInRange(0.18, 0.3);
    add(this.add.image(houseX, g - 8, PROPS, 'house1.png').setOrigin(0.5, 1).setScale(0.5).setTint(dusk).setDepth(6));
    // Lit windows make it feel like someone's home.
    add(this.add.rectangle(houseX - 12, g - 40, 9, 12, 0xffe08a, 0.9).setDepth(6));
    for (let x = -BLEED + rnd.between(0, 60); x < this.vw + BLEED; x += rnd.between(60, 140)) {
      if (Math.abs(x - houseX) < 80) continue;
      const frame = rnd.pick(['tree.png', 'treePine.png', 'treeLong.png', 'bush1.png', 'bush3.png']);
      const scale = frame.startsWith('bush') ? rnd.realInRange(0.35, 0.5) : rnd.realInRange(0.35, 0.55);
      add(this.add.image(x, g - 4, PROPS, frame).setOrigin(0.5, 1).setScale(scale).setTint(0x4d5a8e).setDepth(5));
    }
    for (let x = -BLEED; x < this.vw + BLEED; x += 50) {
      add(this.add.image(x, g + 4, PROPS, 'fence.png').setOrigin(0, 1).setScale(0.5).setTint(dusk).setDepth(7));
    }

    add(this.add.tileSprite(-BLEED, g - 14, width, 200, 'groundLayer1').setOrigin(0).setTint(0x3d8a4e).setTileScale(0.6, 0.5).setDepth(8));
    this.world.add(this.scenery);
  }

  /** UI scale: 1 at 1280×720, smaller on phones. */
  private get k() {
    return Math.min(this.scale.height / 720, this.scale.width / 480);
  }

  private layoutHud() {
    const { width: w } = this.scale;
    const k = this.k;
    this.timeText.setPosition(w / 2, 12 * k).setScale(k);
    this.scoreText.setPosition(w - 20 * k, 14 * k).setScale(k);
    this.drawBoard();
  }

  private setHudVisible(on: boolean) {
    [this.timeText, this.scoreText, this.board].forEach((o) => o.setVisible(on));
  }

  private pickShip() {
    this.colour = Phaser.Utils.Array.GetRandom([...SHIP_COLOURS]);
    const c = this.colour;
    this.hull.setFrame(`ship${c}_manned.png`);
    // The damage frames are the bare hull; only their lower half goes over the manned ship,
    // so the alien in the dome stays visible.
    const dents = this.textures.getFrame(SHIPS, DAMAGE_FRAMES[c][0]);
    const cut = dents.height * 0.38;
    this.dents.setPosition(0, this.hull.height / 2 - dents.height / 2).setCrop(0, cut, dents.width, dents.height - cut).setVisible(false);
    this.beam.setFrame(`laser${c}2.png`);
    this.rings.forEach((r) => r.setFrame(`laser${c}3.png`));
    this.glow.setFrame(`laser${c}_groundBurst.png`);
  }

  // ---- Input -------------------------------------------------------------------------------

  private confirm() {
    if (this.state === 'title' || (this.state === 'over' && this.canRestart)) this.startGame();
  }

  private wantsBeam() {
    return this.holding || !!this.keys?.space.isDown;
  }

  // ---- Game flow ---------------------------------------------------------------------------

  private startGame() {
    playSfx(this, SFX, 'click');
    this.holding = false;
    this.setOverlay();
    this.state = 'playing';
    this.timeLeft = ROUND_S;
    this.lastWhole = ROUND_S;
    this.elapsed = 0;
    this.hurried = false;
    this.score = 0;
    this.abducted = 0;
    this.combo = 0;
    this.orders = 0;
    this.damage = 0;
    this.canRestart = false;
    this.pickShip();
    this.newOrder();
    this.scoreText.setText('0');
    this.setHudVisible(true);
    this.updateTime();
    this.banner('GO!');
    this.voice('go');
    this.music ??= this.sound.add('music', { loop: true, volume: 0.3 });
    if (!this.music.isPlaying) this.music.play();
  }

  private endGame() {
    this.state = 'over';
    this.setBeam(false);
    this.music?.stop();
    this.voice('time_over');
    this.cameras.main.flash(200, 255, 255, 255);
    const previous = this.best;
    const { best, isNew } = submitHighScore('abduction', this.score);
    this.best = best;
    this.time.delayedCall(900, () => this.showGameOver(isNew && this.score > 0 && previous > 0, true));
  }

  private updateTime() {
    const secs = Math.max(0, Math.ceil(this.timeLeft));
    this.timeText.setText(`${secs}`);
    this.timeText.setColor(secs <= 10 ? '#ff6b5e' : '#ffffff');
  }

  /** Adds (or with a negative number, takes) time, and shows it by the clock. */
  private addTime(s: number) {
    this.timeLeft = Math.max(0, this.timeLeft + s);
    this.updateTime();
    const k = this.k;
    const t = this.add.text(this.timeText.x + 70 * k, this.timeText.y + 20 * k, `${s > 0 ? '+' : ''}${s}s`, {
      ...TEXT, fontSize: `${Math.round(30 * k)}px`, color: s > 0 ? '#8cf08c' : '#ff6b5e', strokeThickness: 8 * k,
    }).setOrigin(0, 0.5);
    this.ui.add(t);
    this.tweens.add({ targets: t, y: t.y + 30 * k, alpha: { from: 1, to: 0 }, duration: 1200, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
    this.tweens.add({ targets: this.timeText, scale: { from: 1.3 * k, to: k }, duration: 300, ease: 'Back.easeOut' });
  }

  // ---- The wanted list ---------------------------------------------------------------------

  private newOrder() {
    const size = Math.min(3 + Math.floor(this.orders / 2), 5);
    const pool = ANIMAL_TYPES.filter((a) => !a.angry);
    this.wanted = Phaser.Utils.Array.Shuffle([...pool]).slice(0, size).map((type) => ({ type, got: false }));
    this.drawBoard();
  }

  /** The WANTED board, top left under the "All toys" link. */
  private drawBoard() {
    this.board.removeAll(true);
    if (!this.wanted.length) return;
    const k = this.k;
    const icon = 40;
    const gap = 8;
    const w = this.wanted.length * (icon + gap) + gap + 8;
    const h = 84;
    const bg = this.add.graphics();
    bg.fillStyle(0x0b1230, 0.6).fillRoundedRect(0, 0, w, h, 14);
    bg.lineStyle(2, 0xffffff, 0.25).strokeRoundedRect(0, 0, w, h, 14);
    const label = this.add.text(w / 2, 8, 'WANTED', { ...TEXT, fontSize: '18px', color: '#ffe08a', strokeThickness: 0 }).setOrigin(0.5, 0);
    const parts: Phaser.GameObjects.GameObject[] = [bg, label];
    this.wanted.forEach((wnt, i) => {
      const x = gap + 4 + i * (icon + gap) + icon / 2;
      const img = this.add.image(x, 54, ZOO, `${wnt.type.name}.png`).setScale(icon / 150).setAlpha(wnt.got ? 0.35 : 1);
      parts.push(img);
      if (wnt.got) parts.push(this.add.image(x, 54, ICONS, 'checkmark.png').setScale(0.36).setTint(0x8cf08c));
    });
    this.board.add(parts);
    this.board.setPosition(12 * k, Math.max(60 * k, 58)).setScale(k);
  }

  /** Ticks an animal off the list, and finishes the order if that was the last. */
  private tickWanted(type: Animal) {
    const entry = this.wanted.find((w) => !w.got && w.type === type);
    if (!entry) return;
    entry.got = true;
    playSfx(this, SFX, 'wanted', { volume: 0.5, detune: 0 });
    this.drawBoard();
    if (this.wanted.every((w) => w.got)) {
      this.orders++;
      const bonus = 100 * this.orders;
      this.score += bonus;
      this.scoreText.setText(group(this.score));
      // Each order buys a little less time, so even a great run ends.
      this.addTime(Math.max(MIN_ORDER_BONUS_S, ORDER_BONUS_S + 1 - this.orders));
      playSfx(this, SFX, 'order', { volume: 0.5, detune: 0 });
      this.banner('ORDER FILLED!', `+${bonus}`);
      this.tweens.add({ targets: this.board, scale: { from: this.k * 1.2, to: this.k }, duration: 300, ease: 'Back.easeOut' });
      this.time.delayedCall(700, () => this.state === 'playing' && this.newOrder());
    }
  }

  // ---- Animals -----------------------------------------------------------------------------

  private get populationCap() {
    return Phaser.Math.Clamp(Math.round(this.vw / 90), 6, 14);
  }

  private pickType(): Animal {
    const bulls = this.critters.filter((c) => c.type.angry).length;
    const bullWeight = this.state === 'playing' && this.elapsed > 5 && bulls < 1 + Math.floor(this.elapsed / 30) ? 1 : 0;
    // Lean towards what's still wanted so orders can always be filled.
    const options = ANIMAL_TYPES.map((a): [Animal, number] => {
      if (a.angry) return [a, bullWeight];
      const wanted = this.wanted.some((w) => !w.got && w.type === a);
      return [a, a.weight * (wanted ? 2 : 1)];
    });
    let r = Math.random() * options.reduce((s, [, w]) => s + w, 0);
    for (const [a, w] of options) if ((r -= w) <= 0) return a;
    return options[0][0];
  }

  /** An animal hops in from one side, or appears at `atX` when filling the field at the start. */
  private spawn(atX?: number) {
    const type = this.pickType();
    const r = type.size / 2;
    const fromLeft = Math.random() < 0.5;
    const x = atX ?? (fromLeft ? -r - 4 : this.vw + r + 4);
    const y = this.groundY - r - (atX === undefined ? 30 : 0);
    const body = this.matter.add.circle(x, y, r, { restitution: 0.35, friction: 0.6, frictionAir: 0.012, label: 'animal' });
    this.matter.body.setInertia(body, Infinity);
    const frame = this.textures.getFrame(ZOO, `${type.name}.png`);
    // The face is the bottom of the frame; ears and horns stick up above it.
    const img = this.add.image(x, y, ZOO, `${type.name}.png`).setScale(type.size / FACE_PX).setOrigin(0.5, 1 - FACE_PX / 2 / frame.height).setDepth(30 + Math.random());
    this.world.add(img);
    const c: Critter = { type, body, img, hopIn: Phaser.Math.FloatBetween(0.2, 1.5), lifted: false, liftSpeed: 0, calmUntil: 0, squash: 0, wasFalling: false };
    if (atX === undefined) this.matter.body.setVelocity(body, { x: (fromLeft ? 1 : -1) * 2.5, y: -3 });
    this.critters.push(c);
  }

  private remove(c: Critter) {
    this.matter.world.remove(c.body);
    this.critters = this.critters.filter((o) => o !== c);
  }

  /** Bump sounds and a squash when something lands hard. */
  private onCollisions(event: Phaser.Physics.Matter.Events.CollisionStartEvent) {
    for (const { bodyA, bodyB } of event.pairs) {
      for (const [a, b] of [[bodyA, bodyB], [bodyB, bodyA]]) {
        if (a.label !== 'animal' || b.label !== 'ground') continue;
        const c = this.critters.find((o) => o.body === a);
        const fall = this.matter.body.getVelocity(a).y;
        if (!c || fall < 3) continue;
        c.squash = Math.min(1, fall / 10);
        playSfx(this, SFX, 'land', { volume: Math.min(0.6, fall / 14) });
      }
    }
  }

  private abduct(c: Critter) {
    this.remove(c);
    const now = this.time.now;
    this.combo = now - this.lastAbduct < COMBO_MS ? Math.min(this.combo + 1, MAX_COMBO) : 1;
    this.lastAbduct = now;
    const points = c.type.points * this.combo;
    this.score += points;
    this.abducted++;
    this.scoreText.setText(group(this.score));
    this.tweens.add({ targets: this.scoreText, scale: { from: 1.2 * this.k, to: this.k }, duration: 200, ease: 'Back.easeOut' });
    // Small animals squeak up higher than big ones.
    playSfx(this, SFX, 'abduct', { volume: 0.5, detune: 400 - c.type.size * 6 + (this.combo - 1) * 120 });
    this.tweens.add({
      targets: c.img, x: this.sx, y: SHIP_Y, scale: 0, angle: c.img.angle + 180, duration: 220, ease: 'Cubic.easeIn',
      onComplete: () => c.img.destroy(),
    });
    this.flash();
    this.popup(c.img.x, c.img.y - 30, `+${points}`, this.combo);
    this.tweens.add({ targets: this.ship, scaleY: { from: SHIP_SCALE * 0.9, to: SHIP_SCALE }, scaleX: { from: SHIP_SCALE * 1.08, to: SHIP_SCALE }, duration: 240, ease: 'Back.easeOut' });
    if (this.state === 'playing') this.tickWanted(c.type);
  }

  /** The bull reaches the ship and butts it: dents, a shake and lost time. */
  private ram(c: Critter) {
    c.calmUntil = this.time.now + 1600;
    c.lifted = false;
    this.matter.body.setVelocity(c.body, { x: Phaser.Math.FloatBetween(-4, 4), y: 5 });
    this.stunnedUntil = this.time.now + 700;
    this.setBeam(false);
    this.damage = Math.min(this.damage + 1, 2);
    this.dents.setFrame(DAMAGE_FRAMES[this.colour][this.damage - 1]).setVisible(true);
    const f = this.textures.getFrame(SHIPS, DAMAGE_FRAMES[this.colour][this.damage - 1]);
    const cut = f.height * 0.38;
    this.dents.setCrop(0, cut, f.width, f.height - cut);
    this.cameras.main.shake(300, 0.016);
    this.cameras.main.flash(120, 255, 90, 70);
    playSfx(this, SFX, 'ram', { volume: 0.8 });
    playSfx(this, SFX, 'clang', { volume: 0.6 });
    this.tweens.add({ targets: this.ship, angle: { from: Phaser.Math.Between(-25, 25), to: 0 }, duration: 600, ease: 'Elastic.easeOut' });
    this.svx += Phaser.Math.Between(-300, 300);
    this.popup(this.sx, SHIP_Y + 50, 'BONK!', 0, '#ff6b5e');
    if (this.state === 'playing') {
      this.combo = 0;
      this.addTime(-RAM_PENALTY_S);
    }
  }

  // ---- Effects -----------------------------------------------------------------------------

  /** A starburst under the ship as something goes aboard. */
  private flash() {
    const b = this.add.image(this.sx, SHIP_Y + 24, LASERS, `laser${this.colour}_burst.png`).setDepth(39).setBlendMode(Phaser.BlendModes.ADD);
    this.world.add(b);
    this.tweens.add({ targets: b, scale: { from: 0.2, to: 0.7 }, alpha: { from: 1, to: 0 }, angle: 40, duration: 350, onComplete: () => b.destroy() });
  }

  private popup(x: number, y: number, text: string, combo: number, color = '#ffe08a') {
    const k = this.k;
    const parts: Phaser.GameObjects.GameObject[] = [this.add.text(0, 0, text, { ...TEXT, fontSize: '28px', color, strokeThickness: 7 }).setOrigin(0.5)];
    if (combo > 1) parts.push(this.add.text(0, 28, `x${combo}`, { ...TEXT, fontSize: '22px', color: '#8cf08c', strokeThickness: 6 }).setOrigin(0.5));
    const c = this.add.container(x * this.u, y * this.u, parts);
    this.ui.add(c);
    this.tweens.add({ targets: c, scale: { from: 0.3 * k, to: k }, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, y: c.y - 40 * k, alpha: 0, duration: 600, delay: 450, ease: 'Cubic.easeIn', onComplete: () => c.destroy() });
  }

  private banner(title: string, sub?: string) {
    const { width: w, height: h } = this.scale;
    const k = this.k;
    const parts: Phaser.GameObjects.GameObject[] = [this.add.text(0, 0, title, { ...TEXT, fontSize: '60px', strokeThickness: 12 }).setOrigin(0.5)];
    if (sub) parts.push(this.add.text(0, 54, sub, { ...TEXT, fontSize: '30px', color: '#ffe08a', strokeThickness: 8 }).setOrigin(0.5));
    const c = this.add.container(w / 2, h * 0.42, parts).setScale(0);
    const fit = Math.min(k, (w - 32) / ((parts[0] as Phaser.GameObjects.Text).width + 20));
    this.ui.add(c);
    this.tweens.add({ targets: c, scale: fit, duration: 380, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, alpha: 0, y: c.y - 30 * k, duration: 400, delay: 1100, onComplete: () => c.destroy() });
  }

  private voice(name: Voice) {
    this.sound.play(`voice:${name}`, { volume: 0.9 });
  }

  private setBeam(on: boolean) {
    if (on === this.beaming) return;
    this.beaming = on;
    [this.beam, ...this.rings, this.glow].forEach((o) => o.setVisible(on));
    if (on) {
      playSfx(this, SFX, 'beamOn', { volume: 0.35 });
      this.hum ??= this.sound.add('hum', { loop: true, volume: 0.25 });
      this.hum.play();
    } else {
      this.hum?.stop();
    }
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
    return makeButton(this, x, y, label, onClick, { textStyle: TEXT, color: 0x7a5cd6, onPress: () => playSfx(this, SFX, 'click') }).parts;
  }

  private showTitle() {
    this.state = 'title';
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const k = this.k;
      const card = this.add.container(w / 2, h * 0.5);
      const title = this.add.text(0, -120, 'ABDUCTION', { ...TEXT, fontSize: '80px', strokeThickness: 14 }).setOrigin(0.5);
      this.tweens.add({ targets: title, y: -128, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const tag = this.add.text(0, -40, touch ? 'Touch and hold to beam them up' : 'Hold the mouse or space to beam them up', {
        ...TEXT, fontFamily: FONT_BODY, fontSize: '24px', strokeThickness: 7,
      }).setOrigin(0.5);
      const bull = this.add.image(-118, 18, ZOO, 'buffalo.png').setScale(0.36);
      const warn = this.add.text(-80, 18, "...but don't beam the bull!", { ...TEXT, fontFamily: FONT_BODY, fontSize: '22px', color: '#ffb0a8', strokeThickness: 7 }).setOrigin(0, 0.5);
      this.tweens.add({ targets: bull, angle: { from: -8, to: 8 }, duration: 300, yoyo: true, repeat: -1 });
      const play = this.button(0, 110, 'PLAY', () => this.startGame());
      const parts: Phaser.GameObjects.GameObject[] = [title, tag, bull, warn, ...play];
      if (this.best) parts.push(this.add.text(0, 178, `best ${group(this.best)}`, { ...TEXT, fontSize: '24px', color: '#ffe08a', strokeThickness: 7 }).setOrigin(0.5));
      card.add(parts);
      fitCard(card, k, w, 620, title);
      return [card];
    });
  }

  private showGameOver(record: boolean, animate: boolean) {
    this.setOverlay(() => {
      const { width: w, height: h } = this.scale;
      const k = this.k;
      const card = this.add.container(w / 2, h * 0.46);
      const title = this.add.text(0, -170, "TIME'S UP", { ...TEXT, fontSize: '64px', strokeThickness: 12 }).setOrigin(0.5);
      const panel = this.add.graphics();
      panel.fillStyle(0x000000, 0.3).fillRoundedRect(-200, -102, 400, 210, 26);
      panel.fillStyle(0x1d2b53, 0.92).fillRoundedRect(-200, -110, 400, 210, 26);
      panel.lineStyle(4, 0x8a7bf0, 1).strokeRoundedRect(-200, -110, 400, 210, 26);
      const label = { ...TEXT, fontSize: '22px', color: '#b8b0ff', strokeThickness: 0 };
      const big = { ...TEXT, fontSize: '52px', color: '#ffe08a', strokeThickness: 8 };
      const scoreLabel = this.add.text(0, -88, 'SCORE', label).setOrigin(0.5);
      const scoreNum = this.add.text(0, -40, animate ? '0' : group(this.score), big).setOrigin(0.5);
      const small = { ...big, fontSize: '32px', color: '#ffffff' };
      const bestLabel = this.add.text(-95, 22, 'BEST', label).setOrigin(0.5);
      const bestNum = this.add.text(-95, 60, group(this.best), small).setOrigin(0.5);
      const herdLabel = this.add.text(95, 22, 'ABDUCTED', label).setOrigin(0.5);
      const herdNum = this.add.text(95, 60, `${this.abducted}`, small).setOrigin(0.5);
      const newTag = record ? this.add.text(150, -62, 'NEW!', { ...TEXT, fontSize: '26px', color: '#ff6b5e', stroke: '#ffffff', strokeThickness: 6 }).setOrigin(0.5).setAngle(14) : undefined;
      const again = this.button(0, 170, 'AGAIN', () => this.startGame());
      const parts = [title, panel, scoreLabel, scoreNum, bestLabel, bestNum, herdLabel, herdNum, newTag, ...again];
      card.add(parts.filter((p): p is NonNullable<typeof p> => !!p));
      fitCard(card, k, w, 460, title);
      if (!animate) {
        this.canRestart = true;
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
        this.canRestart = true;
        this.rebuildOverlay = () => this.showGameOver(record, false);
      });
      return [card];
    });
  }

  // ---- Frame loop --------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(delta / 1000, 1 / 30);
    this.clouds.tilePositionX += dt * 6;

    if (this.state === 'playing') {
      this.elapsed += dt;
      this.timeLeft -= dt;
      const whole = Math.ceil(this.timeLeft);
      if (whole !== this.lastWhole) {
        this.lastWhole = whole;
        this.updateTime();
        if (whole <= 5 && whole > 0) playSfx(this, SFX, 'tick', { volume: 0.5, detune: 0 });
        if (whole <= 10 && whole > 0) this.tweens.add({ targets: this.timeText, scale: { from: 1.25 * this.k, to: this.k }, duration: 250 });
      }
      if (!this.hurried && this.timeLeft <= 10) {
        this.hurried = true;
        this.voice('hurry_up');
      }
      if (this.timeLeft <= 0) this.endGame();
    }

    this.flyShip(dt, time);
    this.setBeam(this.state === 'playing' && this.wantsBeam() && time >= this.stunnedUntil);
    if (this.beaming) this.drawBeam(time);

    this.spawnIn -= dt;
    if (this.spawnIn <= 0 && this.state !== 'over') {
      if (this.critters.length < this.populationCap) this.spawn();
      this.spawnIn = Phaser.Math.FloatBetween(0.5, 1.1);
    }

    for (const c of [...this.critters]) this.updateCritter(c, dt, time);
  }

  /** Eases the ship towards the pointer, or along with the arrow keys; slower while beaming. */
  private flyShip(dt: number, time: number) {
    const keys = this.keys;
    const kx = keys ? (keys.right.isDown || keys.d.isDown ? 1 : 0) - (keys.left.isDown || keys.a.isDown ? 1 : 0) : 0;
    if (kx) this.tx = this.sx + kx * 120;
    if (this.state === 'title') this.tx = this.vw / 2 + Math.sin(time / 2200) * this.vw * 0.3;
    this.tx = Phaser.Math.Clamp(this.tx, 40, this.vw - 40);

    const max = this.beaming ? SHIP_SPEED_BEAMING : SHIP_SPEED;
    const want = Phaser.Math.Clamp((this.tx - this.sx) * 6, -max, max);
    this.svx += (want - this.svx) * Math.min(1, dt * 8);
    this.sx += this.svx * dt;
    // When time's up the ship zooms off with its haul, and drops back in for the next round.
    const away = this.state === 'over' ? -SHIP_Y - 120 : 0;
    this.shipLift += (away - this.shipLift) * Math.min(1, dt * (away ? 2.5 : 5));
    const bob = Math.sin(time / 420) * 5;
    this.ship.setPosition(this.sx, SHIP_Y + bob + this.shipLift);
    if (!this.tweens.isTweening(this.ship)) this.ship.setAngle(Phaser.Math.Clamp(this.svx / 22, -16, 16));
  }

  /** The beam from the hull to the ground, with rings sliding up it and a glow where it lands. */
  private drawBeam(time: number) {
    const top = this.ship.y + BEAM_DROP;
    const len = this.groundY - top + 6;
    this.beam.setPosition(this.sx, top).setDisplaySize(BEAM_BOTTOM_HALF * 2.3, len).setAlpha(0.45 + Math.sin(time / 50) * 0.06);
    this.rings.forEach((ring, i) => {
      const f = 1 - ((time / 900 + i / this.rings.length) % 1);
      const half = BEAM_TOP_HALF + (BEAM_BOTTOM_HALF - BEAM_TOP_HALF) * f;
      ring.setPosition(this.sx, top + len * f).setDisplaySize(half * 2.2, half * 0.55).setAlpha(Math.min(1, f * 3) * 0.7);
    });
    this.glow.setPosition(this.sx, this.groundY + 6).setScale(0.75 + Math.sin(time / 90) * 0.06, 0.5).setAlpha(0.55);
  }

  private inBeam(x: number, y: number, r: number) {
    if (!this.beaming) return false;
    const top = this.ship.y + BEAM_DROP;
    if (y < top - r || y > this.groundY + 4) return false;
    const f = (y - top) / (this.groundY - top);
    const half = BEAM_TOP_HALF + (BEAM_BOTTOM_HALF - BEAM_TOP_HALF) * Phaser.Math.Clamp(f, 0, 1);
    return Math.abs(x - this.sx) < half + r * 0.5;
  }

  private updateCritter(c: Critter, dt: number, time: number) {
    const { body, type } = c;
    const r = type.size / 2;
    const { x, y } = body.position;
    const v = this.matter.body.getVelocity(body);
    c.lifted = time >= c.calmUntil && this.inBeam(x, y, r);
    if (!c.lifted) c.liftSpeed = 0;
    // The beam takes over from gravity entirely while it holds something, and what it holds
    // passes through each other, so a crowd in the beam can't jam below the ship.
    body.ignoreGravity = c.lifted;
    body.collisionFilter.group = c.lifted ? -1 : 0;

    if (c.lifted) {
      // Draw it up the beam and towards its middle, carried along with the ship. It's moved by
      // position at a speed in units a second, with no velocity of its own, so Matter only
      // nudges it apart from others; let go and it drops from rest.
      c.liftSpeed = Math.min(type.rise, c.liftSpeed + type.rise * dt * 4);
      const dx = Phaser.Math.Clamp((this.sx - x) * 6, -360, 360) * dt + this.svx * dt;
      this.matter.body.setPosition(body, { x: x + dx, y: y - c.liftSpeed * dt }, false);
      this.matter.body.setVelocity(body, { x: 0, y: 0 });
      c.img.angle += dt * 140 * (x < this.sx ? 1 : -1);
      if (y - r < this.ship.y + BEAM_DROP + 4) {
        if (type.angry) this.ram(c);
        else this.abduct(c);
        return;
      }
    } else {
      const grounded = y > this.groundY - r - 3 && Math.abs(v.y) < 0.6;
      // Settle back upright after a ride in the beam.
      c.img.angle *= grounded ? 0.8 : 0.97;
      if (grounded) {
        c.hopIn -= dt;
        const near = this.beaming && !type.angry && Math.abs(x - this.sx) < 150;
        if (near) c.hopIn = Math.min(c.hopIn, Phaser.Math.FloatBetween(0.1, 0.35));
        if (c.hopIn <= 0) {
          let dir = near ? Math.sign(x - this.sx) || 1 : Math.random() < 0.5 ? -1 : 1;
          if (x < 40) dir = 1;
          else if (x > this.vw - 40) dir = -1;
          const scared = near ? 1.5 : 1;
          const small = 50 / type.size;
          this.matter.body.setVelocity(body, { x: dir * Phaser.Math.FloatBetween(1.2, 2.2) * scared * small, y: -Phaser.Math.FloatBetween(3.2, 5) * Math.min(1.3, small) });
          c.hopIn = type.angry ? Phaser.Math.FloatBetween(0.8, 2) : Phaser.Math.FloatBetween(0.5, 1.8);
        }
      }
    }

    c.squash = Math.max(0, c.squash - dt * 5);
    const s = type.size / FACE_PX;
    const stretch = c.lifted ? 0.06 : 0;
    c.img.setPosition(x, y).setScale(s * (1 + c.squash * 0.25 - stretch), s * (1 - c.squash * 0.25 + stretch));
  }
}

function group(n: number) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
