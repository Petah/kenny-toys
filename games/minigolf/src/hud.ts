import { HOLES } from './holes.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Name for a hole's score against par. */
export function scoreName(strokes: number, par: number) {
  if (strokes === 1) return 'Hole in one!';
  const diff = strokes - par;
  return diff <= -3 ? 'Albatross!' : diff === -2 ? 'Eagle!' : diff === -1 ? 'Birdie!' : diff === 0 ? 'Par' : diff === 1 ? 'Bogey' : diff === 2 ? 'Double bogey' : `+${diff}`;
}

/** "E", "+3" or "-2" for a running score against par. */
export const relative = (diff: number) => (diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff));

/** The HTML overlay: hole info, score, hints, the result banner and the scorecard. */
export class Hud {
  private bannerTimer = 0;
  private hintTimer = 0;

  setHole(index: number, strokes: number, totalDiff: number) {
    const hole = HOLES[index];
    $('hole').textContent = `Hole ${index + 1} · ${hole.name}`;
    $('sub').textContent = `Par ${hole.par} · ${strokes === 0 ? 'Tee off' : `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'}`}`;
    $('score').textContent = index === 0 && strokes === 0 ? '' : `Total ${relative(totalDiff)}`;
  }

  hint(text: string, seconds = 6) {
    const el = $('hint');
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(this.hintTimer);
    if (seconds > 0) this.hintTimer = window.setTimeout(() => (el.style.opacity = '0'), seconds * 1000);
  }

  hideHint() {
    $('hint').style.opacity = '0';
  }

  banner(text: string, small = '', seconds = 2) {
    const el = $('banner');
    el.innerHTML = '';
    el.append(text);
    if (small) {
      const s = document.createElement('small');
      s.textContent = small;
      el.append(s);
    }
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => el.classList.remove('show'), seconds * 1000);
  }

  /** The scorecard: par and strokes per hole so far, with totals. */
  showCard(scores: (number | undefined)[], opts: { title: string; note?: string; button: string; onGo: () => void }) {
    const table = $('card-table');
    const cells = (f: (i: number) => string, cls: (i: number) => string = () => '') =>
      HOLES.map((_, i) => `<td class="${cls(i)}">${f(i)}</td>`).join('');
    const played = scores.filter((s): s is number => s !== undefined);
    const parPlayed = HOLES.reduce((a, h, i) => a + (scores[i] !== undefined ? h.par : 0), 0);
    const total = played.reduce((a, b) => a + b, 0);
    table.innerHTML =
      `<tr><th>Hole</th>${cells((i) => String(i + 1))}<th>Total</th></tr>` +
      `<tr><th>Par</th>${cells((i) => String(HOLES[i].par))}<th>${HOLES.reduce((a, h) => a + h.par, 0)}</th></tr>` +
      `<tr><th>You</th>${cells(
        (i) => (scores[i] === undefined ? '·' : String(scores[i])),
        (i) => (scores[i] === undefined ? '' : scores[i]! < HOLES[i].par ? 'under' : scores[i]! > HOLES[i].par ? 'over' : ''),
      )}<th>${played.length ? `${total} (${relative(total - parPlayed)})` : '·'}</th></tr>`;
    $('card-title').textContent = opts.title;
    $('card-note').textContent = opts.note ?? '';
    const go = $<HTMLButtonElement>('card-go');
    go.textContent = opts.button;
    go.onclick = () => {
      this.hideCard();
      opts.onGo();
    };
    $('card').classList.add('show');
    go.focus();
  }

  hideCard() {
    $('card').classList.remove('show');
  }

  get cardOpen() {
    return $('card').classList.contains('show');
  }
}
