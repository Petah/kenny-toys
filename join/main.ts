import '@shared/theme.css';
import './join.css';
import { loadKenneyFonts } from '@shared/fonts';
import { load, save } from '@shared/storage';
import { PartyPlayer, type PlayerStatus } from '@shared/party';
import type { Controller, ControllerModule } from '@shared/party-controller';

/**
 * The phone's page: enter the TV's code and a name, then the game's own controller takes over
 * the screen. Any game with a `src/controller.ts` can be played this way.
 */

const controllers = import.meta.glob<ControllerModule>('../games/*/src/controller.ts');

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('join');
const codeInput = $<HTMLInputElement>('code');
const nameInput = $<HTMLInputElement>('name');
const app = $('app');

/** Rejoin the same room after a reload, if it was recent. */
const REJOIN_MS = 3 * 60 * 60_000;

interface Last {
  code: string;
  name: string;
  at: number;
}

let player: PartyPlayer | undefined;
let controller: Controller | undefined;
let game = '';
let pending: Record<string, unknown>[] = [];

const STATUS: Partial<Record<PlayerStatus, string>> = {
  connecting: 'Connecting…',
  'host-gone': 'Waiting for the TV to come back…',
};
const ERRORS: Partial<Record<PlayerStatus, string>> = {
  'no-room': "There's no game with that code. Check the TV?",
  full: 'That game is full.',
  kicked: 'The TV removed you from the game.',
};

function showStatus(status: PlayerStatus) {
  const text = STATUS[status];
  $('status').hidden = !text || !game;
  if (text) $('status-text').textContent = text;
  if (!game) form.querySelector('button')!.textContent = status === 'connecting' ? 'Joining…' : 'Join';
}

function backToForm(message: string) {
  player?.close();
  player = undefined;
  controller?.destroy?.();
  controller = undefined;
  game = '';
  app.hidden = true;
  app.replaceChildren();
  form.hidden = false;
  $('status').hidden = true;
  $('error').textContent = message;
  form.querySelector('button')!.textContent = 'Join';
  save('party:last', null);
}

async function keepAwake() {
  try {
    await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock?.request('screen');
  } catch {
    // Not allowed (or not supported); the phone may dim, that's all.
  }
}

function join(code: string, name: string) {
  $('error').textContent = '';
  save<Last>('party:last', { code, name, at: Date.now() });
  player?.close();
  player = new PartyPlayer(code, name, {
    async joined(id) {
      if (game === id) return;
      const load = controllers[`../games/${id}/src/controller.ts`];
      if (!load) {
        backToForm("That game can't be played from a phone yet.");
        return;
      }
      game = id;
      form.hidden = true;
      app.hidden = false;
      void keepAwake();
      const mod = await load();
      controller = mod.mount(app, { name, send: (data) => player?.send(data) });
      for (const m of pending) controller.message(m);
      pending = [];
    },
    message(data) {
      if (controller) controller.message(data);
      else pending.push(data);
    },
    status(status) {
      const error = ERRORS[status];
      if (error) backToForm(error);
      else showStatus(status);
    },
  });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = codeInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();
  if (!/^[A-Z]{4}$/.test(code)) {
    $('error').textContent = 'The code is four letters.';
    return;
  }
  if (!name) {
    $('error').textContent = 'Pick a name.';
    return;
  }
  save('party:name', name);
  nameInput.blur();
  codeInput.blur();
  join(code, name);
});

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && game) void keepAwake();
});

await loadKenneyFonts();
const fromUrl = new URLSearchParams(location.search).get('code')?.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) ?? '';
const last = load<Last | null>('party:last', null);
nameInput.value = load('party:name', '');
codeInput.value = fromUrl;
if (last && Date.now() - last.at < REJOIN_MS && (!fromUrl || fromUrl === last.code)) {
  codeInput.value = last.code;
  nameInput.value = last.name;
  join(last.code, last.name);
} else if (fromUrl && !nameInput.value) nameInput.focus();
else if (!fromUrl) codeInput.focus();
// Drop the code from the address so a reload doesn't fight a later room.
if (fromUrl) history.replaceState(null, '', location.pathname);
