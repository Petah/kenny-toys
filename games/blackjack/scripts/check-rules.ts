/**
 * Checks the rules: a few hand totals, then plays many rounds of basic strategy to measure the
 * house edge, which for these rules should come out near 0.5% of each stake. Also plays runs the
 * way the game does (start with $500, flat $25 bets) to see how long a bankroll lasts.
 *
 *   node games/blackjack/scripts/check-rules.ts [rounds]
 */
import {
  Shoe,
  bestMove,
  canDouble,
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
  type Outcome,
} from '../src/rules.ts';

const card = (rank: number): Card => ({ rank, suit: 'spades' });
const expect = (what: string, got: unknown, want: unknown) => {
  if (got !== want) {
    console.error(`FAIL ${what}: got ${got}, want ${want}`);
    process.exitCode = 1;
  }
};
expect('A+K', total([card(1), card(13)]).total, 21);
expect('A+A+9', total([card(1), card(1), card(9)]).total, 21);
expect('A+6 soft', total([card(1), card(6)]).soft, true);
expect('A+6+10 hard', total([card(1), card(6), card(10)]).total, 17);
expect('label A+6', totalLabel([card(1), card(6)]), '7/17');
expect('label A+K', totalLabel([card(1), card(13)]), '21');
expect('blackjack', isBlackjack([card(1), card(12)]), true);
expect('dealer stands soft 17', dealerHits([card(1), card(6)]), false);
expect('3:2 on 25', payout(newHand(25), 'blackjack'), 63);
expect('peek under ace', dealerPeeks(card(1)), true);
expect('no peek under 9', dealerPeeks(card(9)), false);

/** Plays one round with basic strategy. Returns what came back minus what was staked, and the outcomes. */
function playRound(shoe: Shoe, bet: number) {
  const draw = () => shoe.draw();
  const hands: Hand[] = [newHand(bet)];
  const dealer = [draw()];
  hands[0].cards.push(draw());
  hands[0].cards.push(draw());
  dealer.push(draw());
  const up = dealer[0];
  const peekBj = dealerPeeks(up) && isBlackjack(dealer);
  if (!peekBj && !handBlackjack(hands[0])) {
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i];
      while (!h.done) {
        if (h.cards.length === 1) h.cards.push(draw());
        if (h.split && h.cards[0].rank === 1) {
          h.done = true;
          break;
        }
        if (total(h.cards).total >= 21) {
          h.done = true;
          break;
        }
        const move = bestMove(hands, h, up);
        if (move === 'stand') h.done = true;
        else if (move === 'hit') h.cards.push(draw());
        else if (move === 'double' && canDouble(h)) {
          h.bet *= 2;
          h.doubled = true;
          h.cards.push(draw());
          h.done = true;
        } else if (move === 'split') {
          const second = newHand(h.bet, true);
          second.cards.push(h.cards.pop()!);
          h.split = true;
          hands.push(second);
        }
      }
    }
    if (hands.some((h) => !isBust(h))) while (dealerHits(dealer)) dealer.push(draw());
  }
  let net = 0;
  const results: Outcome[] = [];
  for (const h of hands) {
    const r = outcome(h, dealer);
    results.push(r);
    net += payout(h, r) - h.bet;
  }
  if (shoe.needsShuffle) shoe.shuffle();
  return { net, results };
}

// A seeded generator so runs compare.
let seed = 12345;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

const rounds = Number(process.argv[2] ?? 1_000_000);
const shoe = new Shoe(rand);
let net = 0;
const counts: Record<string, number> = {};
for (let i = 0; i < rounds; i++) {
  const r = playRound(shoe, 10);
  net += r.net;
  for (const o of r.results) counts[o] = (counts[o] ?? 0) + 1;
}
const edge = (-net / rounds / 10) * 100;
console.log(`${rounds} rounds of basic strategy: house edge ${edge.toFixed(2)}%`);
console.log(Object.entries(counts).map(([k, v]) => `${k} ${((v / rounds) * 100).toFixed(1)}%`).join(', '));
if (rounds >= 500_000 && (edge < 0 || edge > 1.2)) {
  console.error('FAIL house edge outside 0–1.2%');
  process.exitCode = 1;
}

// Runs as the game plays them.
const lengths: number[] = [];
const peaks: number[] = [];
for (let run = 0; run < 2000; run++) {
  let bank = 500;
  let peak = bank;
  let n = 0;
  const s = new Shoe(rand);
  while (bank >= 25 && n < 5000) {
    bank += playRound(s, 25).net;
    peak = Math.max(peak, bank);
    n++;
  }
  lengths.push(n);
  peaks.push(peak);
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)];
console.log(`flat $25 from $500: rounds before broke median ${pct(lengths, 0.5)}, peak median $${pct(peaks, 0.5)}, 90th $${pct(peaks, 0.9)}`);
