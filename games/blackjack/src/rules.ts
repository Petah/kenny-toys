/**
 * Blackjack's cards, shoe, hand totals and basic strategy, with no Phaser in it so scripts can
 * deal thousands of hands.
 *
 * House rules: six decks, dealer stands on every 17, blackjack pays 3 to 2, the dealer peeks for
 * blackjack under an ace or ten, double on any first two cards (after a split too), split once,
 * and split aces take one card each.
 */

export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
  /** 1 for an ace up to 13 for a king. */
  rank: number;
  suit: Suit;
}

export const DECKS = 6;
/** The shoe is reshuffled once fewer than this share of its cards are left. */
const CUT = 0.25;

/** A card's blackjack value, with aces as 1 (hand totals count one up as 11 when they can). */
export const pips = (c: Card) => Math.min(c.rank, 10);

export class Shoe {
  cards: Card[] = [];
  private rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.shuffle();
  }

  get size() {
    return DECKS * 52;
  }

  get needsShuffle() {
    return this.cards.length < this.size * CUT;
  }

  shuffle() {
    this.cards = [];
    for (let d = 0; d < DECKS; d++) for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) this.cards.push({ rank, suit });
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw(): Card {
    if (!this.cards.length) this.shuffle();
    return this.cards.pop()!;
  }
}

export interface Total {
  total: number;
  /** An ace is counting as 11. */
  soft: boolean;
}

export function total(cards: Card[]): Total {
  let sum = 0;
  let aces = 0;
  for (const c of cards) {
    sum += pips(c);
    if (c.rank === 1) aces++;
  }
  const soft = aces > 0 && sum + 10 <= 21;
  return { total: soft ? sum + 10 : sum, soft };
}

export const isBlackjack = (cards: Card[]) => cards.length === 2 && total(cards).total === 21;

export interface Hand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  /** Came from a split, so 21 in two cards is just 21. */
  split: boolean;
  /** Finished acting: stood, bust, doubled or a split ace. */
  done: boolean;
}

export const newHand = (bet: number, split = false): Hand => ({ cards: [], bet, doubled: false, split, done: false });

export const handTotal = (h: Hand) => total(h.cards).total;
export const isBust = (h: Hand) => handTotal(h) > 21;
export const handBlackjack = (h: Hand) => !h.split && isBlackjack(h.cards);

export const canDouble = (h: Hand) => h.cards.length === 2 && !h.done;
/** Only the first hand can split, and only once. */
export const canSplit = (hands: Hand[], h: Hand) => hands.length === 1 && h.cards.length === 2 && pips(h.cards[0]) === pips(h.cards[1]);

/** The dealer peeks under an ace or a ten-card for blackjack. */
export const dealerPeeks = (up: Card) => up.rank === 1 || pips(up) === 10;

/** Whether the dealer draws again: below 17, standing on all 17s. */
export const dealerHits = (cards: Card[]) => total(cards).total < 17;

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

/** How a finished hand did against the dealer's finished hand. */
export function outcome(h: Hand, dealer: Card[]): Outcome {
  const mine = handTotal(h);
  if (mine > 21) return 'bust';
  const dealerBj = isBlackjack(dealer);
  if (handBlackjack(h)) return dealerBj ? 'push' : 'blackjack';
  if (dealerBj) return 'lose';
  const theirs = total(dealer).total;
  if (theirs > 21 || mine > theirs) return 'win';
  return mine === theirs ? 'push' : 'lose';
}

/** What comes back to the player for a hand, stake included: 3 to 2 for blackjack, rounding odd stakes up in your favour. */
export function payout(h: Hand, result: Outcome) {
  if (result === 'blackjack') return h.bet + Math.ceil((h.bet * 3) / 2);
  if (result === 'win') return h.bet * 2;
  if (result === 'push') return h.bet;
  return 0;
}

export type Move = 'hit' | 'stand' | 'double' | 'split';

/**
 * The basic-strategy play for these rules (six decks, stand on 17, double after split). Falls
 * back to hitting or standing where doubling or splitting isn't allowed.
 */
export function bestMove(hands: Hand[], h: Hand, up: Card): Move {
  const d = up.rank === 1 ? 11 : pips(up);
  const { total: t, soft } = total(h.cards);
  const dbl = canDouble(h);
  if (canSplit(hands, h)) {
    const p = pips(h.cards[0]);
    const split =
      p === 1 ||
      p === 8 ||
      (p === 9 && d !== 7 && d !== 10 && d !== 11) ||
      (p === 7 && d <= 7) ||
      (p === 6 && d <= 6) ||
      (p === 4 && (d === 5 || d === 6)) ||
      ((p === 2 || p === 3) && d <= 7);
    if (split) return 'split';
  }
  if (soft) {
    if (t >= 19) return 'stand';
    if (t === 18) {
      if (d >= 3 && d <= 6) return dbl ? 'double' : 'stand';
      return d <= 8 ? 'stand' : 'hit';
    }
    const from = { 17: 3, 16: 4, 15: 4, 14: 5, 13: 5 }[t] ?? 7;
    return dbl && d >= from && d <= 6 ? 'double' : 'hit';
  }
  if (t >= 17) return 'stand';
  if (t >= 13) return d <= 6 ? 'stand' : 'hit';
  if (t === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
  if (t === 11) return dbl && d !== 11 ? 'double' : 'hit';
  if (t === 10) return dbl && d <= 9 ? 'double' : 'hit';
  if (t === 9) return dbl && d >= 3 && d <= 6 ? 'double' : 'hit';
  return 'hit';
}

/** The words the table shows for a total: 'BUST', '21', 'SOFT 17' and the like. */
export function totalLabel(cards: Card[]) {
  if (!cards.length) return '';
  const { total: t, soft } = total(cards);
  if (t > 21) return `${t}`;
  return soft && t < 21 ? `${t - 10}/${t}` : `${t}`;
}
