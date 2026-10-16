import * as Phaser from 'phaser';
import { playSfx } from '@shared/phaser';
import { load, submitHighScore } from '@shared/storage';
import { FONT, SFX, SHEET, createAssets, preloadAssets } from './assets';
import { Crawl, H, ITEMS, MONSTERS, W, WEAPON_ATK, type Event, type Pos } from './crawl';

const T = 16;
const HUD_H = 26;
const LOG_H = 14;
/** Seconds a turn's animation takes; input waits for it. */
const TURN = 0.11;
const HERO_TILE = 96;
const WALL_TOP = 0x763b36;

type State = 'title' | 'play' | 'dead';

interface Actor {
  box: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  /** Where it's drawn, in room pixels, before rounding. */
  x: number;
  y: number;
  hop: number;
  lunge: { x: number; y: number };
}

export class CrawlScene extends Phaser.Scene {
  private state: State = 'title';
  private crawl!: Crawl;
  private zoom = 2;
  private ox = 0;
  private oy = 0;
  private room!: Phaser.GameObjects.Container;
  private things!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Container;
  private overlay?: Phaser.GameObjects.Container;
  private hero!: Actor;
  private monsters = new Map<number, Actor>();
  private props = new Map<string, Phaser.GameObjects.Image>();
  private log!: Phaser.GameObjects.BitmapText;
  private busy = 0;
  private best = 0;
  private music?: Phaser.Sound.BaseSound;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private flash!: Phaser.GameObjects.Rectangle;

  constructor() {
    super('crawl');
  }

  preload() {
    preloadAssets(this);
  }

  create() {
    createAssets(this);
    this.cameras.main.setOrigin(0, 0).setBackgroundColor(WALL_TOP);
    this.room = this.add.container(0, 0);
    this.things = this.add.container(0, 0);
    this.hud = this.add.container(0, 0);
    this.sparks = this.add.particles(0, 0, 'spark', {
      speed: { min: 20, max: 60 },
      lifespan: 400,
      scale: 1,
      gravityY: 60,
      emitting: false,
    });
    this.flash = this.add.rectangle(0, 0, 10, 10, 0xe8473a, 0).setOrigin(0);
    this.log = this.add.bitmapText(0, 0, FONT, '').setOrigin(0.5, 0);
    this.best = load('tiny-crawler:best', 0);
    this.crawl = this.newCrawl();
    this.bindInput();
    this.scale.on('resize', () => this.layout());
    this.layout();
    this.showTitle();
  }

  // ---- Layout ------------------------------------------------------------------------------

  /** The room in tiles: floor plus a wall all round, and the top wall two tiles deep. */
  private get roomW() {
    return this.crawl.w + 2;
  }

  private get roomH() {
    return this.crawl.h + 3;
  }

  /** A new crawl shaped to the screen: a tall room on a tall screen. */
  private newCrawl() {
    const tall = this.scale.height > this.scale.width * 1.15;
    return tall ? new Crawl(Math.random, 8, 10) : new Crawl(Math.random, W, H);
  }

  private layout() {
    const { width: w, height: h } = this.scale;
    const ROOM_W = this.roomW;
    const ROOM_H = this.roomH;
    const needW = ROOM_W * T + 8;
    const needH = ROOM_H * T + HUD_H + LOG_H + 8;
    // Room for the back button above the HUD, in screen pixels.
    const top = 52;
    this.zoom = Math.max(1, Math.floor(Math.min(w / needW, (h - top) / needH)));
    const vw = Math.floor(w / this.zoom);
    const vh = Math.floor(h / this.zoom);
    this.cameras.main.setSize(w, h).setZoom(this.zoom).setScroll(0, 0);
    this.ox = Math.floor((vw - ROOM_W * T) / 2);
    const topPx = Math.ceil(top / this.zoom);
    this.oy = Math.max(topPx + HUD_H, Math.floor((vh - ROOM_H * T - LOG_H + HUD_H) / 2));
    this.room.setPosition(this.ox, this.oy);
    this.things.setPosition(this.ox, this.oy);
    this.hud.setPosition(this.ox, this.oy - 14);
    this.log.setPosition(this.ox + (ROOM_W * T) / 2, this.oy + ROOM_H * T + 3);
    this.flash.setSize(vw, vh);
    this.drawRoom();
    this.drawHud();
    if (this.overlay) this.state === 'dead' ? this.showDead(false) : this.showTitle();
  }

  /** Room pixel position of a floor tile's top-left. */
  private px(p: Pos) {
    return { x: (p.x + 1) * T, y: (p.y + 2) * T };
  }

  // ---- Drawing the room ---------------------------------------------------------------------

  /** Walls from the pack's sample map: a stone rim on top, brick faces, side walls, a bottom ledge. */
  private drawRoom() {
    const ROOM_W = this.roomW;
    const ROOM_H = this.roomH;
    this.room.removeAll(true);
    const c = this.crawl;
    let seed = c.floor * 97 + 13;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const put = (tx: number, ty: number, frame: number) => this.room.add(this.add.image(tx * T, ty * T, SHEET, frame).setOrigin(0));
    for (let tx = 0; tx < ROOM_W; tx++) {
      const inner = tx > 0 && tx < ROOM_W - 1;
      put(tx, 0, tx === 0 ? 1 : tx === ROOM_W - 1 ? 3 : 2);
      // The face row, with the door in it.
      const door = tx === c.doorX + 1;
      put(tx, 1, tx === 0 ? 13 : tx === ROOM_W - 1 ? 15 : door ? (c.doorOpen ? 9 : 45) : r() < 0.06 ? 29 : r() < 0.06 ? 18 : 40);
      for (let ty = 2; ty < ROOM_H - 1; ty++) {
        if (!inner) {
          put(tx, ty, tx === 0 ? 13 : 15);
          continue;
        }
        // Sand, shaded under the top wall, with the odd scattering of pebbles.
        const roll = r();
        put(tx, ty, ty === 2 ? (roll < 0.3 ? 51 : 50) : roll < 0.08 ? 42 : roll < 0.2 ? 49 : 48);
      }
      put(tx, ROOM_H - 1, tx === 0 ? 25 : tx === ROOM_W - 1 ? 27 : 26);
    }
    this.drawProps();
  }

  /** Scenery, chests and items, then the hero and monsters. */
  private drawProps() {
    this.things.removeAll(true);
    this.props.clear();
    this.monsters.clear();
    const c = this.crawl;
    for (const [k, frame] of c.obstacles) {
      const [x, y] = k.split(',').map(Number);
      const p = this.px({ x, y });
      this.things.add(this.add.image(p.x, p.y, SHEET, frame).setOrigin(0));
    }
    for (const ch of c.chests) {
      const p = this.px(ch);
      const img = this.add.image(p.x, p.y, SHEET, ch.opened ? 91 : 89).setOrigin(0);
      this.things.add(img);
      this.props.set(`chest:${ch.id}`, img);
    }
    for (const it of c.items) this.addItem(it.id, it.kind, it);
    this.hero = this.makeActor(HERO_TILE, c.hero);
    for (const m of c.monsters) this.monsters.set(m.id, this.makeActor(MONSTERS[m.kind].tile, m));
  }

  private addItem(id: number, kind: keyof typeof ITEMS, at: Pos) {
    const p = this.px(at);
    const img = kind === 'gold' ? this.add.image(p.x + 5, p.y + 5, 'coin').setOrigin(0) : this.add.image(p.x, p.y, SHEET, ITEMS[kind].tile).setOrigin(0);
    this.things.add(img);
    this.props.set(`item:${id}`, img);
    // Items bob gently.
    this.tweens.add({ targets: img, y: img.y - 1, duration: 500, yoyo: true, repeat: -1, ease: 'Stepped' });
    return img;
  }

  private makeActor(frame: number, at: Pos): Actor {
    const p = this.px(at);
    const sprite = this.add.image(0, 0, SHEET, frame).setOrigin(0);
    const box = this.add.container(p.x, p.y, [sprite]);
    this.things.add(box);
    return { box, sprite, x: p.x, y: p.y, hop: 0, lunge: { x: 0, y: 0 } };
  }

  private drawHud() {
    const ROOM_W = this.roomW;
    this.hud.removeAll(true);
    const h = this.crawl.hero;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.hud.add(o);
      return o;
    };
    add(this.add.image(1, 3, 'heart').setOrigin(0));
    add(this.add.bitmapText(10, 2, FONT, `${Math.max(0, h.hp)}/${h.maxHp}`).setTint(h.hp <= 3 ? 0xff8a7a : 0xffffff));
    // Attack, with the weapon held (bare fists show just the number).
    let x = 50;
    if (h.weapon !== 'fists') add(this.add.image(x - 3, -2, SHEET, ITEMS[h.weapon].tile).setOrigin(0));
    add(this.add.bitmapText(x + 11, 2, FONT, `${WEAPON_ATK[h.weapon]}`).setTint(0xffd23f));
    x += 24;
    if (h.shield > 0) {
      add(this.add.image(x - 3, -2, SHEET, 102).setOrigin(0));
      add(this.add.bitmapText(x + 11, 2, FONT, `${h.shield}`));
      x += 24;
    }
    add(this.add.image(x, 4, 'coin').setOrigin(0));
    add(this.add.bitmapText(x + 8, 2, FONT, `${h.gold}`));
    // The floor number sits in a row of its own above, out of the way.
    add(this.add.bitmapText(ROOM_W * T - 1, -11, FONT, `FLOOR ${this.crawl.floor}`).setOrigin(1, 0).setTint(0xffd23f));
  }

  private say(text: string, tint = 0xffffff) {
    this.log.setText(text.toUpperCase()).setTint(tint);
  }

  // ---- Input -------------------------------------------------------------------------------

  private bindInput() {
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('UP,DOWN,LEFT,RIGHT,SPACE');
      kb.on('keydown', (e: KeyboardEvent) => {
        const dirs: Record<string, [number, number]> = {
          ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
          w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
          ' ': [0, 0], '.': [0, 0],
        };
        if (this.state !== 'play') {
          if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) this.start();
          return;
        }
        const d = dirs[e.key];
        if (d) this.act(d[0], d[1]);
      });
    }
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.state !== 'play') {
        this.start();
        return;
      }
      const wx = p.x / this.zoom - this.ox;
      const wy = p.y / this.zoom - this.oy;
      const tx = Math.floor(wx / T) - 1;
      const ty = Math.floor(wy / T) - 2;
      const h = this.crawl.hero;
      const dx = tx - h.x;
      const dy = ty - h.y;
      if (dx === 0 && dy === 0) this.act(0, 0);
      else if (Math.abs(dx) >= Math.abs(dy)) this.act(Math.sign(dx), 0);
      else this.act(0, Math.sign(dy));
    });
  }

  // ---- Turns -------------------------------------------------------------------------------

  private act(dx: number, dy: number) {
    if (this.busy > 0 || this.crawl.dead) return;
    const before = this.crawl.floor;
    const events = this.crawl.act(dx, dy);
    if (!events.length) return;
    this.busy = TURN;
    if (this.crawl.floor !== before) {
      this.descend();
      return;
    }
    let delay = 0;
    for (const e of events) delay = this.play(e, delay);
    this.drawHud();
  }

  /** Animates one event; monsters' moves come a beat after the hero's. */
  private play(e: Event, delay: number): number {
    const c = this.crawl;
    switch (e.type) {
      case 'move': {
        const a = e.who === 'hero' ? this.hero : this.monsters.get(e.who);
        if (!a) return delay;
        const to = this.px(e.to);
        if (e.to.x !== e.from.x) a.sprite.setFlipX(e.to.x < e.from.x);
        this.tweens.add({ targets: a, x: to.x, y: to.y, duration: TURN * 800, delay, ease: 'Quad.easeOut' });
        this.tweens.add({ targets: a, hop: 3, duration: TURN * 400, delay, yoyo: true, ease: 'Quad.easeOut' });
        if (e.who === 'hero') playSfx(this, SFX, 'step', { volume: 0.25 });
        return e.who === 'hero' ? delay + 40 : delay;
      }
      case 'bump':
        playSfx(this, SFX, 'bump', { volume: 0.2 });
        this.tweens.add({ targets: this.hero.lunge, x: Math.sign(e.at.x - c.hero.x) * 2, y: Math.sign(e.at.y - c.hero.y) * 2, duration: 50, yoyo: true });
        return delay;
      case 'attack': {
        const byHero = e.by === 'hero';
        const attacker = byHero ? this.hero : this.monsters.get(e.by as number);
        const target = e.target === 'hero' ? this.hero : this.monsters.get(e.target as number);
        if (!attacker || !target) return delay;
        const lx = Math.sign(target.x - attacker.x) * 5;
        const ly = Math.sign(target.y - attacker.y) * 5;
        if (lx) attacker.sprite.setFlipX(lx < 0);
        this.tweens.add({ targets: attacker.lunge, x: lx, y: ly, duration: 50, delay, yoyo: true, ease: 'Quad.easeOut' });
        this.time.delayedCall(delay + 50, () => {
          playSfx(this, SFX, byHero ? 'swing' : 'hit', { volume: 0.4 });
          if (e.blocked) playSfx(this, SFX, 'block', { volume: 0.5 });
          target.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
          this.time.delayedCall(70, () => target.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY));
          this.number(target, e.damage ? `-${e.damage}` : 'BLOCK', byHero ? 0xffffff : 0xff6a5a);
          if (!byHero) {
            if (e.damage) playSfx(this, SFX, 'hurt', { volume: 0.4 });
            this.flash.setAlpha(e.damage ? 0.25 : 0.1);
            this.tweens.add({ targets: this.flash, alpha: 0, duration: 200 });
          }
          if (e.killed && byHero) this.kill(e.target as number, target);
        });
        const name = byHero ? MONSTERS[this.kindOf(e.target as number)]?.name : MONSTERS[this.kindOf(e.by as number)]?.name;
        if (byHero) this.say(e.killed ? `You beat the ${name}!` : `You hit the ${name}`, e.killed ? 0x9ff09a : 0xffffff);
        else this.say(e.blocked ? `Your shield blocks the ${name}` : `The ${name} hits you!`, 0xff8a7a);
        return delay + 70;
      }
      case 'pickup': {
        const img = this.props.get(`item:${e.item.id}`);
        if (img) {
          this.props.delete(`item:${e.item.id}`);
          this.tweens.killTweensOf(img);
          this.tweens.add({ targets: img, y: img.y - 10, alpha: 0, duration: 300, onComplete: () => img.destroy() });
        }
        const k = e.item.kind;
        playSfx(this, SFX, k === 'gold' ? 'coins' : k === 'red' || k === 'blue' ? 'potion' : 'weapon', { volume: 0.5 });
        this.say(k === 'gold' ? `${e.item.amount} gold!` : k === 'red' ? 'A red potion: +4 HP' : k === 'blue' ? 'A blue potion: +2 max HP' : k === 'shield' ? 'A shield: blocks 3 hits' : `A ${ITEMS[k].name}!`, 0xffd23f);
        return delay;
      }
      case 'open': {
        const img = this.props.get(`chest:${e.chest.id}`);
        img?.setFrame(91);
        playSfx(this, SFX, 'chest', { volume: 0.5 });
        // The loot pops up out of the chest.
        const p = this.px(e.chest);
        const loot = e.chest.loot.kind === 'gold' ? this.add.image(p.x + 5, p.y + 2, 'coin').setOrigin(0) : this.add.image(p.x, p.y - 2, SHEET, ITEMS[e.chest.loot.kind].tile).setOrigin(0);
        this.things.add(loot);
        this.tweens.add({ targets: loot, y: loot.y - 12, duration: 300, ease: 'Quad.easeOut', onComplete: () => this.tweens.add({ targets: loot, alpha: 0, duration: 250, delay: 300, onComplete: () => loot.destroy() }) });
        return delay;
      }
      case 'mimic': {
        const img = this.props.get(`chest:${e.chest.id}`);
        img?.destroy();
        const a = this.makeActor(MONSTERS.mimic.tile, e.monster);
        this.monsters.set(e.monster.id, a);
        this.tweens.add({ targets: a, hop: 5, duration: 120, yoyo: true, repeat: 1 });
        playSfx(this, SFX, 'mimic', { volume: 0.5, rate: 0.6 });
        this.say("It's a mimic!", 0xff8a7a);
        return delay + 100;
      }
      case 'door':
        this.time.delayedCall(delay + 150, () => {
          playSfx(this, SFX, 'door', { volume: 0.6 });
          this.say('The door creaks open...', 0x9ff09a);
          this.drawRoomKeepingActors();
        });
        return delay;
      case 'dead':
        this.time.delayedCall(delay + 300, () => this.die());
        return delay;
      default:
        return delay;
    }
  }

  private kindOf(id: number) {
    const m = this.crawl.monsters.find((x) => x.id === id);
    if (m) return m.kind;
    return this.lastKinds.get(id) ?? 'rat';
  }

  /** Remember monsters' kinds so the log can name them after they're gone. */
  private lastKinds = new Map<number, keyof typeof MONSTERS>();

  private kill(id: number, a: Actor) {
    this.monsters.delete(id);
    playSfx(this, SFX, 'thud', { volume: 0.4 });
    const x = this.ox + a.x + 8;
    const y = this.oy + a.y + 8;
    this.sparks.setPosition(0, 0);
    this.sparks.explode(10, x, y);
    this.tweens.add({ targets: a.sprite, alpha: 0, duration: 200, onComplete: () => a.box.destroy() });
  }

  private number(a: Actor, text: string, tint: number) {
    const t = this.add.bitmapText(this.ox + a.x + 8, this.oy + a.y - 2, FONT, text).setOrigin(0.5, 1).setTint(tint);
    this.tweens.add({ targets: t, y: t.y - 10, duration: 500, ease: 'Quad.easeOut', onComplete: () => this.tweens.add({ targets: t, alpha: 0, duration: 200, onComplete: () => t.destroy() }) });
  }

  /** Redraws the walls (for the open door) without moving anyone. */
  private drawRoomKeepingActors() {
    const ROOM_H = this.roomH;
    // Only the door tile changes: the room is laid a column at a time, top to bottom.
    const doorIndex = (this.crawl.doorX + 1) * ROOM_H + 1;
    const img = this.room.list[doorIndex] as Phaser.GameObjects.Image | undefined;
    img?.setFrame(9);
  }

  private descend() {
    playSfx(this, SFX, 'stairs', { volume: 0.5 });
    this.busy = 0.6;
    this.cameras.main.fadeOut(220, 0x1d, 0x16, 0x20);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      for (const m of this.crawl.monsters) this.lastKinds.set(m.id, m.kind);
      this.drawRoom();
      this.drawHud();
      this.say(`Floor ${this.crawl.floor}`, 0xffd23f);
      this.cameras.main.fadeIn(260, 0x1d, 0x16, 0x20);
      // Drop in from above.
      this.hero.hop = 12;
      this.tweens.add({ targets: this.hero, hop: 0, duration: 260, ease: 'Bounce.easeOut' });
    });
  }

  // ---- Flow --------------------------------------------------------------------------------

  private clearOverlay() {
    this.overlay?.destroy();
    this.overlay = undefined;
  }

  private card(lines: { text: string; scale?: number; tint?: number }[]) {
    this.clearOverlay();
    const vw = Math.floor(this.scale.width / this.zoom);
    const vh = Math.floor(this.scale.height / this.zoom);
    const shade = this.add.rectangle(0, 0, vw, vh, 0x1d1620, 0.72).setOrigin(0);
    const parts: Phaser.GameObjects.GameObject[] = [shade];
    let y = Math.floor(vh * 0.32);
    for (const l of lines) {
      const s = l.scale ?? 1;
      const t = this.add.bitmapText(Math.floor(vw / 2), y, FONT, l.text).setOrigin(0.5, 0).setScale(s).setTint(l.tint ?? 0xffffff);
      parts.push(t);
      y += 12 * s + 4;
    }
    this.overlay = this.add.container(0, 0, parts).setDepth(10);
  }

  private showTitle() {
    this.state = 'title';
    const touch = this.sys.game.device.input.touch;
    this.card([
      { text: 'TINY CRAWLER', scale: 3, tint: 0xffd23f },
      { text: 'ONE ROOM A FLOOR. HOW DEEP CAN YOU GO?' },
      { text: touch ? 'TAP A SIDE OF THE HERO TO STEP OR FIGHT' : 'ARROWS OR WASD TO STEP OR FIGHT, SPACE TO WAIT' },
      { text: '' },
      { text: touch ? 'TAP TO START' : 'PRESS ENTER OR CLICK TO START', tint: 0x9ff09a },
      ...(this.best ? [{ text: `BEST ${this.best}`, tint: 0xffd23f }] : []),
    ]);
    this.say('');
  }

  private start() {
    if (this.state === 'play') return;
    playSfx(this, SFX, 'click', { volume: 0.4 });
    this.music ??= this.sound.add('music', { loop: true, volume: 0.25 });
    if (!this.music.isPlaying) this.music.play();
    this.clearOverlay();
    this.crawl = this.newCrawl();
    this.lastKinds.clear();
    this.state = 'play';
    this.drawRoom();
    this.drawHud();
    this.say('Floor 1. Beat every monster to open the door.', 0xffd23f);
  }

  private die() {
    this.state = 'dead';
    playSfx(this, SFX, 'dead', { volume: 0.5 });
    this.hero.sprite.setTint(0x884444);
    this.tweens.add({ targets: this.hero.sprite, angle: 90, duration: 300 });
    const { best, isNew } = submitHighScore('tiny-crawler', this.crawl.score);
    this.best = best;
    this.time.delayedCall(700, () => {
      playSfx(this, SFX, 'over', { volume: 0.5, detune: 0 });
      this.time.delayedCall(400, () => playSfx(this, SFX, isNew && this.crawl.score > 0 ? 'voiceBest' : 'voiceOver', { volume: 0.6, detune: 0 }));
      this.showDead(isNew && this.crawl.score > 0);
    });
  }

  private showDead(record: boolean) {
    const c = this.crawl;
    this.card([
      { text: record ? 'NEW BEST!' : 'YOU DIED', scale: 3, tint: record ? 0xffd23f : 0xff6a5a },
      { text: `ON FLOOR ${c.floor}` },
      { text: `${c.hero.kills} MONSTERS, ${c.hero.gold} GOLD` },
      { text: `SCORE ${c.score}`, scale: 2, tint: 0xffd23f },
      { text: `BEST ${this.best}` },
      { text: '' },
      { text: this.sys.game.device.input.touch ? 'TAP TO TRY AGAIN' : 'PRESS ENTER OR CLICK TO TRY AGAIN', tint: 0x9ff09a },
    ]);
  }

  update(_t: number, delta: number) {
    this.busy = Math.max(0, this.busy - delta / 1000);
    for (const m of this.crawl.monsters) this.lastKinds.set(m.id, m.kind);
    // Draw every actor on whole pixels.
    for (const a of [this.hero, ...this.monsters.values()]) {
      if (!a) continue;
      a.box.setPosition(Math.round(a.x + a.lunge.x), Math.round(a.y + a.lunge.y - a.hop));
    }
  }
}
