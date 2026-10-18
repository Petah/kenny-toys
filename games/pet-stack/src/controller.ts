import type { Controller, ControllerContext } from '@shared/party-controller';
import { PEDESTAL_HALF, REACH } from './sizes.ts';
import type { PhoneState, SeatView } from './protocol.ts';
import './controller.css';

/**
 * Pet Stack on a phone in party play. On your turn: slide along the pad to move the pet over
 * the tower (the pad's middle block is the pedestal, to scale), turn it with the two buttons and
 * press DROP. While others stack you can send cheers to the TV.
 */

const CHEERS = ['👏', '😱', '😂', '🙈'];
/** Aim messages a second at most while dragging. */
const AIM_HZ = 20;

/** A turning arrow, anticlockwise; mirrored for clockwise. */
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5V1.5L6.5 6 12 10.5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function mount(root: HTMLElement, ctx: ControllerContext): Controller {
  const icons: Record<string, string> = {};
  let state: PhoneState = { k: 'state', phase: 'lobby' };
  let aim = 0;
  let quarter = 0;
  let deadline = 0;
  let total = 1;
  let lastSent = 0;
  let sendTimer = 0;
  let raf = 0;
  let wasTurn = false;

  root.className = 'ps';
  root.innerHTML = '';

  const icon = (kind?: string) => (kind && icons[kind] ? `<img alt="" src="${icons[kind]}">` : '<span class="blank"></span>');
  const hearts = (me: SeatView & { max: number }) =>
    Array.from({ length: me.max }, (_, i) => `<i class="${i < me.hearts ? 'on' : ''}">♥</i>`).join('');

  /** Who's playing, with hearts once a round is on. */
  function roster(withHearts: boolean) {
    const players = (state.players ?? []).filter((p) => p.online || p.playing);
    return `<ul class="roster">${players
      .map((p) => {
        const h = withHearts && p.playing ? `<span class="hearts">${'<i class="on">♥</i>'.repeat(Math.max(0, p.hearts))}</span>` : '';
        const current = state.turn && withHearts && p.name === state.turn.name && !p.out ? ' current' : '';
        return `<li class="${p.out ? 'out' : ''}${current}" style="--seat:${p.color}">${icon(p.avatar)}<b>${esc(p.name)}</b>${h}</li>`;
      })
      .join('')}</ul>`;
  }

  function header() {
    const me = state.me;
    if (!me) return '';
    return `<header style="--seat:${me.color}">${icon(me.avatar)}<b>${esc(me.name)}</b>${me.playing && state.phase !== 'lobby' ? `<span class="hearts">${hearts(me)}</span>` : ''}</header>`;
  }

  function sendAim(force = false) {
    const now = performance.now();
    clearTimeout(sendTimer);
    if (force || now - lastSent > 1000 / AIM_HZ) {
      lastSent = now;
      ctx.send({ k: 'aim', x: aim });
    } else sendTimer = window.setTimeout(() => sendAim(true), 1000 / AIM_HZ - (now - lastSent));
  }

  function render() {
    cancelAnimationFrame(raf);
    const s = state;
    const me = s.me;
    const turn = s.turn;
    let body = '';
    switch (s.phase) {
      case 'full':
        body = `<div class="msg"><h2>Game's full</h2><p>Eight players at most. Watch this one and jump in when someone leaves.</p></div>`;
        break;
      case 'lobby':
        body = `<div class="msg">
          <div class="big-pet">${icon(me?.avatar)}</div>
          <h2>You're in!</h2>
          ${roster(false)}
          ${me?.vip ? `<p>Everyone here? You start the game.</p><button class="go" data-act="start">Start!</button>` : `<p class="dim">Waiting for ${esc(s.players?.find((p) => p.online)?.name ?? 'the first player')} to start…</p>`}
        </div>`;
        break;
      case 'turn':
        body = `<div class="turn">
          <h2 class="yours">Your turn!</h2>
          <div class="timer"><div id="bar"></div></div>
          <div class="pets"><div class="held" style="transform:rotate(${-quarter * 90}deg)">${icon(turn?.kind)}</div><div class="next">NEXT ${icon(turn?.next)}</div></div>
          <div class="pad" id="pad">
            <div class="pedestal" style="width:${(PEDESTAL_HALF / REACH) * 100}%"></div>
            <div class="marker" id="marker">${icon(turn?.kind)}</div>
            <span class="pad-hint">slide to aim</span>
          </div>
          <div class="row">
            <button class="spin" data-act="left" aria-label="Turn anticlockwise">${ARROW}</button>
            <button class="drop" data-act="drop">DROP</button>
            <button class="spin cw" data-act="right" aria-label="Turn clockwise">${ARROW}</button>
          </div>
        </div>`;
        break;
      case 'wait':
      case 'out':
      case 'late': {
        const title =
          s.phase === 'out' ? `<h2>You're out!</h2><p>Cheer the others on.</p>`
          : s.phase === 'late' ? `<h2>Next round</h2><p>You'll be in when this one ends.</p>`
          : `<h2 style="color:${turn?.color}">${esc(turn?.name ?? '')} is stacking</h2>
             <p>${turn && turn.upIn > 0 ? (turn.upIn === 1 ? "You're next!" : `You're up in ${turn.upIn} turns`) : ''}</p>`;
        body = `<div class="msg">${title}${roster(true)}</div>
          <div class="cheers">${CHEERS.map((c, i) => `<button data-act="cheer" data-e="${i}">${c}</button>`).join('')}</div>`;
        break;
      }
      case 'over': {
        const r = s.result;
        const won = r?.winner && r.place === 1;
        const title = !r?.winner ? 'Tower down!' : won ? 'You win!' : `${esc(r.winner.name)} wins!`;
        const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
        body = `<div class="msg">
          <div class="big-pet">${icon(won ? me?.avatar : r?.winner?.avatar ?? me?.avatar)}</div>
          <h2 ${r?.winner ? `style="color:${won ? 'var(--accent)' : r.winner.color}"` : ''}>${title}</h2>
          <p>${r && r.place > 1 ? `You came ${ord(r.place)}. ` : ''}The tower reached ${r?.height ?? 0}cm.</p>
          ${me?.vip ? `<button class="go" data-act="start">Play again</button>` : `<p class="dim">Waiting for the next round…</p>`}
        </div>`;
        break;
      }
    }
    root.innerHTML = header() + `<main>${body}</main>`;
    if (s.phase === 'turn') {
      bindPad();
      placeMarker();
      tickTimer();
    }
  }

  function placeMarker() {
    const marker = root.querySelector<HTMLElement>('#marker');
    if (marker) marker.style.left = `${((aim + 1) / 2) * 100}%`;
  }

  function tickTimer() {
    const bar = root.querySelector<HTMLElement>('#bar');
    if (!bar) return;
    const left = Math.max(0, (deadline - performance.now()) / 1000);
    bar.style.width = `${(left / total) * 100}%`;
    bar.classList.toggle('hurry', left < 3);
    if (left > 0) raf = requestAnimationFrame(tickTimer);
  }

  function bindPad() {
    const pad = root.querySelector<HTMLElement>('#pad')!;
    const at = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      aim = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      placeMarker();
      sendAim();
    };
    pad.addEventListener('pointerdown', (e) => {
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('touched');
      at(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (pad.hasPointerCapture(e.pointerId)) at(e);
    });
    pad.addEventListener('pointerup', () => sendAim(true));
  }

  root.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    e.preventDefault();
    const act = b.dataset.act;
    b.classList.add('down');
    setTimeout(() => b.classList.remove('down'), 120);
    if (act === 'left' || act === 'right') {
      // Positive turns go anticlockwise, as in game.ts.
      const dir = act === 'left' ? 1 : -1;
      quarter += dir;
      const held = root.querySelector<HTMLElement>('.held');
      if (held) held.style.transform = `rotate(${-quarter * 90}deg)`;
      ctx.send({ k: 'turn', dir });
    } else if (act === 'drop') {
      ctx.send({ k: 'drop', x: aim });
      navigator.vibrate?.(30);
      // Show it straight away; the TV's word follows.
      state = { ...state, phase: 'wait' };
      render();
    } else if (act === 'start') ctx.send({ k: 'start' });
    else if (act === 'cheer') {
      ctx.send({ k: 'cheer', e: Number(b.dataset.e) });
      navigator.vibrate?.(10);
    }
  });

  return {
    message(data) {
      if (data.k === 'icon' && typeof data.kind === 'string' && typeof data.src === 'string') {
        icons[data.kind] = data.src;
        return;
      }
      if (data.k !== 'state') return;
      const next = data as unknown as PhoneState;
      const isTurn = next.phase === 'turn';
      // Mid-turn news (someone joined, say) mustn't redraw the pad under a sliding finger.
      if (isTurn && wasTurn && next.turn?.kind === state.turn?.kind) {
        state = next;
        return;
      }
      if (isTurn && next.turn) {
        if (!wasTurn) {
          // A fresh turn: start from where the TV has the pet.
          aim = next.turn.x ?? 0;
          navigator.vibrate?.([60, 40, 60]);
        }
        quarter = next.turn.quarter ?? 0;
        total = next.turn.total ?? 10;
        deadline = performance.now() + (next.turn.left ?? total) * 1000;
      }
      wasTurn = isTurn;
      state = next;
      render();
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(sendTimer);
    },
  };
}
