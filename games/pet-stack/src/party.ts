import qrcode from 'qrcode-generator';
import * as THREE from 'three';
import { PartyHost, joinUrl } from '@shared/party';
import { CM, HEARTS, StackGame } from './game.ts';
import { REACH } from './sizes.ts';
import { PETS, type PetKind } from './pets.ts';
import type { IconMsg, PhoneMsg, PhoneState, SeatView } from './protocol.ts';

/**
 * Party play: the tower on a TV, players taking turns from their phones (see controller.ts).
 * Whoever's drop knocks a pet off loses a heart; out of hearts and you're out, and the last
 * player standing wins. It's the solo game with turns, so this only adds the seats, the lobby
 * and the results, and swaps the one set of hearts for one each.
 */

const MAX_SEATS = 8;
const COLORS = ['#ff5a5f', '#ffb800', '#3fa7ff', '#b06cff', '#ff7bc0', '#2fd38a', '#ff8a3d', '#4ee0e6'];
/** How long a phone can be away mid-round before it's out. */
const GONE_MS = 60_000;
const CHEERS = ['👏', '😱', '😂', '🙈'];
/** Hearts each: two keeps a party round short enough to want another. */
const heartsFor = (players: number) => (players === 1 ? HEARTS : 2);

type Phase = 'off' | 'lobby' | 'play' | 'over';

interface Seat {
  id: string;
  name: string;
  color: string;
  avatar: PetKind;
  hearts: number;
  /** In this round (joined before it started). */
  playing: boolean;
  out: boolean;
  online: boolean;
  /** Icons this phone already has. */
  sent: Set<string>;
  lastCheer: number;
  /** When the phone went away, mid-round. */
  goneAt: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class PartyStack extends StackGame {
  /** Unset (solo) until the party starts. */
  private phase?: Phase;
  private host?: PartyHost;
  private seats: Seat[] = [];
  private turnSeat?: Seat;
  private outOrder: Seat[] = [];
  private roundSize = 0;
  private done = false;
  private aimTarget = 0;

  private get partyOn() {
    return !!this.phase && this.phase !== 'off';
  }

  /** Switches from the solo title to the party lobby. */
  enterParty() {
    if (this.partyOn) return;
    this.phase = 'lobby';
    this.seats = [];
    document.body.classList.add('party');
    $('title').classList.remove('show');
    $('lobby').classList.add('show');
    if (!location.search.includes('party')) history.replaceState(null, '', '?party');
    this.host ??= new PartyHost('pet-stack', {
      room: (code) => this.showCode(code),
      join: (id, name) => this.seatJoin(id, name),
      leave: (id) => this.seatLeave(id),
      message: (id, data) => this.fromPhone(id, data as PhoneMsg),
      status: (up) => $('lobby').classList.toggle('offline', !up),
    });
    $('lobby-go').onclick = () => this.start();
    $('results-go').onclick = () => this.start();
    const sound = () => $('lobby').classList.add('heard');
    window.addEventListener('pointerdown', sound, { once: true });
    window.addEventListener('keydown', sound, { once: true });
    this.renderSeats();
  }

  // ---- Seats -------------------------------------------------------------------------------

  private showCode(code: string) {
    const url = joinUrl(code);
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('lobby-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    $('lobby-url').textContent = joinUrl().replace(/^https?:\/\//, '').replace(/\/$/, '');
    $('lobby-code').textContent = code;
    $('results-code').textContent = code;
  }

  private seatJoin(id: string, name: string) {
    let seat = this.seats.find((s) => s.id === id);
    if (!seat) {
      if (this.seats.length >= MAX_SEATS) {
        this.host!.send(id, { k: 'state', phase: 'full' } satisfies PhoneState);
        return;
      }
      const color = COLORS.find((c) => !this.seats.some((s) => s.color === c))!;
      const free = PETS.filter((k) => !this.seats.some((s) => s.avatar === k));
      seat = {
        id, name, color, avatar: free[Math.floor(Math.random() * free.length)],
        hearts: 0, playing: false, out: false, online: true, sent: new Set(), lastCheer: 0, goneAt: 0,
      };
      this.seats.push(seat);
      this.sounds.play('join', { volume: 0.5 });
    }
    seat.name = name;
    seat.online = true;
    // A rejoining phone may have lost what it had.
    seat.sent.clear();
    this.renderSeats();
    this.sync();
  }

  private seatLeave(id: string) {
    const seat = this.seats.find((s) => s.id === id);
    if (!seat) return;
    seat.online = false;
    seat.goneAt = performance.now();
    // Between rounds nobody's waiting on them, so they give up their seat.
    if (this.phase !== 'play') this.seats.splice(this.seats.indexOf(seat), 1);
    this.renderSeats();
    this.sync();
  }

  /** The first player still connected starts each round from their phone. */
  private get vip() {
    return this.seats.find((s) => s.online);
  }

  private fromPhone(id: string, msg: PhoneMsg) {
    const seat = this.seats.find((s) => s.id === id);
    if (!seat) return;
    const mine = this.phase === 'play' && this.turnSeat === seat && this.state === 'aim';
    switch (msg.k) {
      case 'aim':
        if (mine && Number.isFinite(msg.x)) this.aimTarget = THREE.MathUtils.clamp(msg.x, -1, 1) * REACH;
        break;
      case 'turn':
        if (mine) this.turnHeld(msg.dir < 0 ? -1 : 1);
        break;
      case 'drop':
        if (mine) {
          if (Number.isFinite(msg.x)) this.aimX = this.aimTarget = THREE.MathUtils.clamp(msg.x!, -1, 1) * REACH;
          this.dropHeld();
        }
        break;
      case 'start':
        if (seat === this.vip && this.phase !== 'play') this.start();
        break;
      case 'cheer': {
        const now = performance.now();
        if (now - seat.lastCheer < 400 || !(msg.e >= 0 && msg.e < CHEERS.length)) break;
        seat.lastCheer = now;
        this.cheer(seat, CHEERS[msg.e]);
        break;
      }
    }
  }

  // ---- Turns -------------------------------------------------------------------------------

  protected override localControl() {
    return !this.partyOn;
  }

  protected override start() {
    if (!this.partyOn) return super.start();
    const players = this.seats.filter((s) => s.online);
    if (this.phase === 'play' || !players.length) return;
    this.roundSize = players.length;
    for (const s of this.seats) {
      s.playing = s.online;
      s.out = !s.playing;
      s.hearts = s.playing ? heartsFor(this.roundSize) : 0;
    }
    this.outOrder = [];
    this.done = false;
    // A different player goes first each round.
    this.turnSeat = players[Math.floor(Math.random() * players.length)];
    this.turnSeat = this.seats[(this.seats.indexOf(this.turnSeat) - 1 + this.seats.length) % this.seats.length];
    this.phase = 'play';
    $('lobby').classList.remove('show');
    $('results').classList.remove('show');
    super.start();
    this.hint('');
    this.aimTarget = 0;
  }

  /** The next player round the table who's still in, preferring ones whose phone is on. */
  private nextSeat(): Seat | undefined {
    // A phone gone for a minute has left the game, or it could win by never having a turn.
    for (const s of this.seats) {
      if (s.playing && !s.out && !s.online && performance.now() - s.goneAt > GONE_MS) {
        s.out = true;
        this.outOrder.push(s);
        this.checkDone();
      }
    }
    const n = this.seats.length;
    const from = this.turnSeat ? this.seats.indexOf(this.turnSeat) : -1;
    const order = Array.from({ length: n }, (_, i) => this.seats[(from + 1 + i + n) % n]);
    const alive = order.filter((s) => s.playing && !s.out);
    return alive.find((s) => s.online) ?? alive[0];
  }

  protected override nextPet() {
    if (!this.partyOn) return super.nextPet();
    this.turnSeat = this.nextSeat();
    super.nextPet();
    this.aimTarget = this.aimX;
    if (this.turnSeat) {
      $('who').textContent = this.turnSeat.name;
      $('who').style.setProperty('--seat', this.turnSeat.color);
    }
    this.sounds.play('yourTurn', { volume: 0.35 });
    this.renderSeats();
    this.sync();
  }

  protected override aimSeconds() {
    // Longer than solo: eyes go between the phone and the TV.
    return this.partyOn ? Math.max(8, 14 - this.placed * 0.25) : super.aimSeconds();
  }

  protected override updateAim(dt: number) {
    if (this.partyOn) this.aimX = THREE.MathUtils.damp(this.aimX, this.aimTarget, 14, dt);
    super.updateAim(dt);
  }

  protected override dropHeld() {
    super.dropHeld();
    if (this.partyOn) this.sync();
  }

  protected override finished() {
    return this.partyOn ? this.done : super.finished();
  }

  protected override loseHeart() {
    if (!this.partyOn) return super.loseHeart();
    const seat = this.turnSeat;
    if (!seat || seat.out || this.done || this.heartTurn === this.turn) return;
    this.heartTurn = this.turn;
    seat.hearts--;
    this.shake = 0.5;
    this.sounds.play('oops', { volume: 0.5 });
    if (seat.hearts > 0) this.banner('Oops!', `${seat.name} loses a heart`);
    else {
      seat.out = true;
      this.outOrder.push(seat);
      this.banner(`${seat.name} is out!`);
      this.sounds.play('sad', { volume: 0.4 });
      this.checkDone();
    }
    this.renderSeats();
    this.sync();
  }

  /** Ends the round once one player is left (or none, playing alone). */
  private checkDone() {
    const left = this.seats.filter((s) => s.playing && !s.out).length;
    if (!this.done && left <= (this.roundSize > 1 ? 1 : 0)) {
      this.done = true;
      this.overIn = 1.8;
    }
  }

  protected override healOnMetre() {
    if (!this.partyOn) return super.healOnMetre();
    const seat = this.turnSeat;
    if (!seat || seat.out || seat.hearts >= heartsFor(this.roundSize)) return '';
    seat.hearts++;
    this.renderSeats();
    this.sync();
    return `Heart back for ${seat.name}`;
  }

  protected override gameOver() {
    super.gameOver();
    if (!this.partyOn) return;
    $('over').classList.remove('show');
    this.phase = 'over';
    const winner = this.roundSize > 1 ? this.seats.find((s) => s.playing && !s.out) : undefined;
    const standings = [...(winner ? [winner] : []), ...[...this.outOrder].reverse()];
    $('results-title').textContent = winner ? `${winner.name} wins!` : 'Tower down!';
    $('results-title').style.color = winner?.color ?? '';
    $('results-height').textContent = `Tower: ${Math.round(this.runBest * CM)}cm`;
    $('results-list').replaceChildren(
      ...standings.map((s, i) => {
        const li = document.createElement('li');
        li.style.setProperty('--seat', s.color);
        li.innerHTML = `<b>${i + 1}</b><img alt="" src="${this.icons[s.avatar]}"><span></span>`;
        li.querySelector('span')!.textContent = s.name;
        return li;
      }),
    );
    $('results').classList.add('show');
    if (winner) {
      this.sounds.play('win', { volume: 0.7 });
      this.dance();
    }
    this.turnSeat = undefined;
    this.renderSeats();
    this.sync();
  }

  protected override updateOverlays() {
    super.updateOverlays();
    if (!this.partyOn) return;
    const ring = $('ring');
    const who = $('who');
    const show = this.state === 'aim' && ring.style.display !== 'none';
    who.style.display = show ? 'block' : 'none';
    if (show) {
      who.style.left = ring.style.left;
      who.style.top = ring.style.top;
    }
  }

  // ---- TV ----------------------------------------------------------------------------------

  /** The lobby's list of who's in, and the strip of players along the bottom in a round. */
  private renderSeats() {
    const vip = this.vip;
    $('lobby-players').replaceChildren(
      ...this.seats.map((s) => {
        const li = document.createElement('li');
        li.style.setProperty('--seat', s.color);
        li.classList.toggle('offline', !s.online);
        li.innerHTML = `<img alt="" src="${this.icons[s.avatar]}"><span></span>`;
        li.querySelector('span')!.textContent = s.name;
        return li;
      }),
    );
    const count = this.seats.filter((s) => s.online).length;
    $('lobby-note').textContent = !count
      ? 'Scan the code or go to the address on your phone'
      : `${count} in · ${vip!.name} can start from their phone`;
    $<HTMLButtonElement>('lobby-go').disabled = !count;
    $('results-note').textContent = vip ? `${vip.name} can start the next round` : '';

    const heart = this.icons.heart;
    $('seats').replaceChildren(
      ...this.seats.filter((s) => s.playing || this.phase !== 'lobby').map((s) => {
        const chip = document.createElement('div');
        chip.className = 'seat';
        chip.dataset.id = s.id;
        chip.style.setProperty('--seat', s.color);
        chip.classList.toggle('current', s === this.turnSeat && this.phase === 'play');
        chip.classList.toggle('out', s.out);
        chip.classList.toggle('offline', !s.online);
        const hearts = s.playing
          ? Array.from({ length: heartsFor(this.roundSize) }, (_, i) => `<img class="h${i < s.hearts ? '' : ' lost'}" alt="" src="${heart}">`).join('')
          : '<em>next round</em>';
        chip.innerHTML = `<img class="pet" alt="" src="${this.icons[s.avatar]}"><div><span></span><div class="hs">${hearts}</div></div>`;
        chip.querySelector('span')!.textContent = s.name;
        return chip;
      }),
    );
  }

  /** An emoji floating up from a player's chip (or the lobby list). */
  private cheer(seat: Seat, emoji: string) {
    const chip = document.querySelector<HTMLElement>(`.seat[data-id="${seat.id}"]`);
    const rect = chip?.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'cheer';
    el.textContent = emoji;
    el.style.left = `${rect ? rect.left + rect.width / 2 : innerWidth / 2}px`;
    el.style.top = `${rect ? rect.top : innerHeight - 120}px`;
    el.style.setProperty('--drift', `${(Math.random() - 0.5) * 80}px`);
    document.body.append(el);
    setTimeout(() => el.remove(), 1600);
    this.sounds.play('cheer', { volume: 0.25 });
  }

  // ---- Phones ------------------------------------------------------------------------------

  private seatView(s: Seat): SeatView {
    return { name: s.name, color: s.color, avatar: s.avatar, hearts: s.hearts, out: s.out, online: s.online, playing: s.playing };
  }

  /** Sends each phone what it should show now. */
  private sync() {
    if (!this.host || !this.partyOn) return;
    const players = this.seats.map((s) => this.seatView(s));
    const alive = this.seats.filter((s) => s.playing && !s.out);
    for (const s of this.seats) {
      if (!s.online) continue;
      let phase: PhoneState['phase'];
      if (this.phase === 'lobby') phase = 'lobby';
      else if (this.phase === 'over') phase = 'over';
      else if (!s.playing) phase = 'late';
      else if (s.out) phase = 'out';
      else phase = s === this.turnSeat && this.state === 'aim' ? 'turn' : 'wait';

      const msg: PhoneState = {
        k: 'state', phase, players,
        me: { ...this.seatView(s), max: heartsFor(this.roundSize || 1), vip: s === this.vip },
      };
      const kinds = new Set<string>(this.seats.map((x) => x.avatar));
      if (this.phase === 'play' && this.turnSeat) {
        const i = alive.indexOf(this.turnSeat);
        const j = alive.indexOf(s);
        msg.turn = {
          name: this.turnSeat.name, color: this.turnSeat.color,
          upIn: i < 0 || j < 0 ? -1 : (j - i + alive.length) % alive.length,
        };
        if (phase === 'turn' && this.held) {
          msg.turn.kind = this.held.kind;
          msg.turn.next = this.nextKind;
          msg.turn.quarter = Math.round(this.angle / (Math.PI / 2));
          msg.turn.left = Math.max(0, this.aimLeft);
          msg.turn.total = this.aimSeconds();
          msg.turn.x = this.aimX / REACH;
          kinds.add(this.held.kind);
          kinds.add(this.nextKind);
        }
      }
      if (this.phase === 'over') {
        const winner = this.roundSize > 1 ? this.seats.find((x) => x.playing && !x.out) : undefined;
        const place = s === winner ? 1 : s.playing ? (winner ? 1 : 0) + this.outOrder.length - this.outOrder.indexOf(s) : 0;
        msg.result = { winner: winner ? this.seatView(winner) : undefined, place, height: Math.round(this.runBest * CM) };
      }
      for (const kind of kinds) {
        if (s.sent.has(kind)) continue;
        s.sent.add(kind);
        this.host.send(s.id, { k: 'icon', kind, src: this.icons[kind] } satisfies IconMsg);
      }
      this.host.send(s.id, msg);
    }
  }
}
