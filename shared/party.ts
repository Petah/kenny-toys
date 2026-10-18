import { load, save } from './storage';

/**
 * Party play: a game on a TV (the host) with phones as controllers (players), talking through
 * the relay in `party/server.ts`. Both ends reconnect by themselves, so a TV reload or a phone
 * that sleeps picks up where it was. The relay only passes messages, so each game decides what
 * `data` holds.
 */

/** Where phones go to join, shown on the TV. */
export const JOIN_PATH = `${import.meta.env.BASE_URL}join/`;

export function joinUrl(code?: string) {
  const url = new URL(JOIN_PATH, location.href);
  if (code) url.searchParams.set('code', code);
  return url.href;
}

function socketUrl(params: Record<string, string>) {
  const url = new URL(`${import.meta.env.BASE_URL}party/ws`, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.href;
}

/** A socket that comes back after it drops, waiting a little longer each try. */
abstract class Link {
  protected ws?: WebSocket;
  private retry = 0;
  private timer = 0;
  private closed = false;

  protected abstract params(): Record<string, string>;
  protected abstract receive(msg: Record<string, unknown>): void;
  protected onUp() {}
  protected onDown() {}

  protected open() {
    if (this.closed) return;
    const ws = new WebSocket(socketUrl(this.params()));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onUp();
    };
    ws.onmessage = (e) => {
      try {
        this.receive(JSON.parse(e.data));
      } catch {
        // Not ours.
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.onDown();
      this.reconnect();
    };
  }

  protected reconnect() {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.open(), Math.min(5000, 400 * 2 ** this.retry++));
  }

  protected raw(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }

  /** Reconnect straight away rather than waiting out the back-off (a phone waking up). */
  nudge() {
    if (!this.ws && !this.closed) {
      clearTimeout(this.timer);
      this.open();
    }
  }
}

export interface HostEvents {
  room(code: string): void;
  join(id: string, name: string): void;
  leave(id: string): void;
  message(id: string, data: Record<string, unknown>): void;
  /** The relay can't be reached (or came back: `up` true). */
  status?(up: boolean): void;
}

/** The TV's end. Keeps its room across reloads of the page (in this tab). */
export class PartyHost extends Link {
  code = '';
  private key = '';
  private store: string;

  constructor(private game: string, private on: HostEvents) {
    super();
    this.store = `party:host:${game}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.store) ?? 'null');
      if (saved) ({ code: this.code, key: this.key } = saved);
    } catch {
      // A fresh room then.
    }
    this.open();
  }

  protected params(): Record<string, string> {
    return this.code ? { role: 'host', game: this.game, code: this.code, key: this.key } : { role: 'host', game: this.game };
  }

  protected receive(msg: Record<string, unknown>) {
    if (msg.t === 'room') {
      this.code = String(msg.code);
      this.key = String(msg.key);
      try {
        sessionStorage.setItem(this.store, JSON.stringify({ code: this.code, key: this.key }));
      } catch {
        // Only matters for reloads.
      }
      this.on.room(this.code);
      for (const p of (msg.players as { id: string; name: string; online: boolean }[]) ?? []) {
        if (p.online) this.on.join(p.id, p.name);
      }
    } else if (msg.t === 'join') this.on.join(String(msg.id), String(msg.name));
    else if (msg.t === 'leave') this.on.leave(String(msg.id));
    else if (msg.t === 'msg' && msg.data && typeof msg.data === 'object') this.on.message(String(msg.id), msg.data as Record<string, unknown>);
  }

  protected onUp() {
    this.on.status?.(true);
  }

  protected onDown() {
    this.on.status?.(false);
  }

  send(id: string, data: unknown) {
    this.raw({ t: 'to', id, data });
  }

  broadcast(data: unknown) {
    this.raw({ t: 'all', data });
  }

  kick(id: string) {
    this.raw({ t: 'kick', id });
  }
}

export type PlayerStatus = 'connecting' | 'joined' | 'host-gone' | 'no-room' | 'full' | 'kicked';

export interface PlayerEvents {
  joined(game: string, code: string): void;
  message(data: Record<string, unknown>): void;
  status(status: PlayerStatus): void;
}

/** A phone's lasting id, so a reload or a dropped connection rejoins as the same player. */
export function playerId() {
  let id = load<string>('party:id', '');
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
    save('party:id', id);
  }
  return id;
}

/** The phone's end. */
export class PartyPlayer extends Link {
  private id = playerId();
  private gaveUp = false;

  constructor(private code: string, private name: string, private on: PlayerEvents) {
    super();
    this.on.status('connecting');
    this.open();
    // Phones drop sockets while asleep; come straight back when the screen does.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.nudge();
    });
  }

  protected params() {
    return { role: 'player', code: this.code, id: this.id, name: this.name };
  }

  protected receive(msg: Record<string, unknown>) {
    if (msg.t === 'joined') {
      this.on.joined(String(msg.game), String(msg.code));
      this.on.status('joined');
    } else if (msg.t === 'msg' && msg.data && typeof msg.data === 'object') this.on.message(msg.data as Record<string, unknown>);
    else if (msg.t === 'host-gone') this.on.status('host-gone');
    else if (msg.t === 'host-back') this.on.status('joined');
    else if (msg.t === 'error') {
      const reason = msg.reason === 'full' || msg.reason === 'kicked' ? msg.reason : 'no-room';
      this.gaveUp = true;
      this.close();
      this.on.status(reason);
    }
  }

  protected onDown() {
    if (!this.gaveUp) this.on.status('connecting');
  }

  send(data: unknown) {
    this.raw(data);
  }
}
