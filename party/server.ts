/**
 * Party relay: lets a game on a TV (the host) talk to phones (the players) in a room with a
 * four-letter code. It knows nothing about any game: it passes JSON between the host and each
 * player and tells the host when players come and go. Rooms live in memory only.
 *
 *   node party/server.ts          (PORT, default 8083; HOST, default 127.0.0.1)
 *
 * Sockets connect to /party/ws with a query string:
 *   host:   role=host&game=<id>                    makes a room; sends {t:'room', code, key}
 *           role=host&code=<code>&key=<key>        takes a room back after a reload
 *   player: role=player&code=<code>&id=<id>&name=<name>
 *
 * Host sends {t:'to', id, data}, {t:'all', data} or {t:'kick', id}; it hears {t:'join', id, name},
 * {t:'leave', id} and {t:'msg', id, data}. Players send any JSON, which reaches the host as
 * {t:'msg'}; they hear {t:'joined', game}, {t:'msg', data}, {t:'host-gone'}, {t:'host-back'} and
 * {t:'error', reason} (no-room, full, kicked).
 *
 * Node runs this file as is (it strips the types), so it sticks to erasable TypeScript.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT ?? 8083);
const HOST = process.env.HOST ?? '127.0.0.1';

/** No vowels, so codes never spell anything, and no Z, which Kenney Bold draws like a 2. */
const LETTERS = 'BCDFGHJKLMNPQRSTVWX';
const MAX_ROOMS = 300;
const MAX_PLAYERS = 12;
/** How long a room waits for its host to come back (a TV reload) before it closes. */
const HOST_GRACE_MS = 10 * 60_000;
/** Rooms with no messages at all for this long close. */
const IDLE_MS = 3 * 60 * 60_000;
/** Cloudflare drops sockets quiet for 100s, so everyone gets pinged well inside that. */
const PING_MS = 25_000;
/**
 * Messages per second a socket may send before the extras are dropped. The host gets far more:
 * it sends every phone its own state at once, plus pictures the first time.
 */
const PLAYER_RATE = 40;
const HOST_RATE = 600;

interface Player {
  id: string;
  name: string;
  ws?: WebSocket;
}

interface Room {
  code: string;
  key: string;
  game: string;
  host?: WebSocket;
  hostGoneAt?: number;
  players: Map<string, Player>;
  lastActive: number;
}

const rooms = new Map<string, Room>();
const alive = new WeakMap<WebSocket, boolean>();

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

function send(ws: WebSocket | undefined, msg: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += LETTERS[crypto.randomInt(LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}

/** A token bucket per socket: true while it's within `rate` messages a second. */
function limiter(rate: number) {
  let tokens = rate;
  let at = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(rate, tokens + ((now - at) / 1000) * rate);
    at = now;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}

function parse(raw: WebSocket.RawData): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(raw.toString());
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

const cleanName = (s: string | null) =>
  (s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Player';
const cleanId = (s: string | null) => (s && /^[A-Za-z0-9_-]{6,40}$/.test(s) ? s : undefined);

function closeRoom(room: Room, why: string) {
  rooms.delete(room.code);
  for (const p of room.players.values()) {
    send(p.ws, { t: 'error', reason: 'no-room' });
    p.ws?.close();
  }
  room.host?.close();
  log('room', room.code, 'closed:', why);
}

function attachHost(ws: WebSocket, url: URL) {
  const code = (url.searchParams.get('code') ?? '').toUpperCase();
  const key = url.searchParams.get('key') ?? '';
  let room = rooms.get(code);
  if (room && room.key === key) {
    // A reload: the new socket takes over from any old one still hanging on.
    const old = room.host;
    room.host = ws;
    room.hostGoneAt = undefined;
    old?.close();
    for (const p of room.players.values()) send(p.ws, { t: 'host-back' });
    log('room', room.code, 'host back');
  } else {
    const game = (url.searchParams.get('game') ?? '').replace(/[^a-z0-9-]/g, '').slice(0, 40);
    if (!game || rooms.size >= MAX_ROOMS) {
      send(ws, { t: 'error', reason: 'busy' });
      ws.close();
      return;
    }
    room = { code: newCode(), key: crypto.randomBytes(12).toString('base64url'), game, host: ws, players: new Map(), lastActive: Date.now() };
    rooms.set(room.code, room);
    log('room', room.code, 'opened for', game, `(${rooms.size} open)`);
  }
  const r = room;
  send(ws, {
    t: 'room', code: r.code, key: r.key,
    players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name, online: !!p.ws })),
  });

  const ok = limiter(HOST_RATE);
  ws.on('message', (raw) => {
    if (r.host !== ws || !ok()) return;
    const msg = parse(raw);
    if (!msg) return;
    r.lastActive = Date.now();
    if (msg.t === 'to' && typeof msg.id === 'string') send(r.players.get(msg.id)?.ws, { t: 'msg', data: msg.data });
    else if (msg.t === 'all') for (const p of r.players.values()) send(p.ws, { t: 'msg', data: msg.data });
    else if (msg.t === 'kick' && typeof msg.id === 'string') {
      const p = r.players.get(msg.id);
      if (!p) return;
      r.players.delete(msg.id);
      send(p.ws, { t: 'error', reason: 'kicked' });
      p.ws?.close();
    }
  });
  ws.on('close', () => {
    if (r.host !== ws) return;
    r.host = undefined;
    r.hostGoneAt = Date.now();
    for (const p of r.players.values()) send(p.ws, { t: 'host-gone' });
  });
}

function attachPlayer(ws: WebSocket, url: URL) {
  const room = rooms.get((url.searchParams.get('code') ?? '').toUpperCase());
  const id = cleanId(url.searchParams.get('id'));
  if (!room || !id) {
    send(ws, { t: 'error', reason: 'no-room' });
    ws.close();
    return;
  }
  let player = room.players.get(id);
  if (!player) {
    if (room.players.size >= MAX_PLAYERS) {
      send(ws, { t: 'error', reason: 'full' });
      ws.close();
      return;
    }
    player = { id, name: cleanName(url.searchParams.get('name')) };
    room.players.set(id, player);
  } else {
    player.name = cleanName(url.searchParams.get('name'));
  }
  // The same phone again (a reload or a dropped connection): the newest socket wins.
  const old = player.ws;
  player.ws = ws;
  old?.close();
  const p = player;
  room.lastActive = Date.now();
  send(ws, { t: 'joined', game: room.game, code: room.code });
  if (!room.host) send(ws, { t: 'host-gone' });
  send(room.host, { t: 'join', id, name: p.name });

  const ok = limiter(PLAYER_RATE);
  ws.on('message', (raw) => {
    if (p.ws !== ws || !ok()) return;
    const data = parse(raw);
    if (!data) return;
    room.lastActive = Date.now();
    send(room.host, { t: 'msg', id, data });
  });
  ws.on('close', () => {
    if (p.ws !== ws) return;
    p.ws = undefined;
    send(room.host, { t: 'leave', id });
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/party/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`ok ${rooms.size}\n`);
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/party/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('error', () => ws.terminate());
    if (url.searchParams.get('role') === 'host') attachHost(ws, url);
    else attachPlayer(ws, url);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.hostGoneAt && now - room.hostGoneAt > HOST_GRACE_MS) closeRoom(room, 'host gone');
    else if (now - room.lastActive > IDLE_MS) closeRoom(room, 'idle');
  }
}, PING_MS);

server.listen(PORT, HOST, () => log(`party relay on ${HOST}:${PORT}`));

const stop = () => {
  log('stopping');
  for (const ws of wss.clients) ws.close(1012, 'restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
