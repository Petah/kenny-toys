/** What the TV (party.ts) and the phones (controller.ts) say to each other in party play. */

export interface SeatView {
  name: string;
  color: string;
  avatar: string;
  hearts: number;
  out: boolean;
  online: boolean;
  /** In this round. */
  playing: boolean;
}

/** TV → phone: everything the phone shows, sent whenever any of it changes. */
export interface PhoneState {
  k: 'state';
  /** turn: yours to drop; wait: someone else's; late: joined mid-round; full: no seat left. */
  phase: 'lobby' | 'turn' | 'wait' | 'out' | 'late' | 'over' | 'full';
  me?: SeatView & { max: number; vip: boolean };
  players?: SeatView[];
  turn?: {
    name: string;
    color: string;
    /** Turns until this phone's (0 = now, -1 = not playing). */
    upIn: number;
    /** On your turn: the pet, the one after, its quarter turns, seconds left of total, and where it hangs (-1…1). */
    kind?: string;
    next?: string;
    quarter?: number;
    left?: number;
    total?: number;
    x?: number;
  };
  result?: { winner?: SeatView; place: number; height: number };
}

/** TV → phone: a pet's picture, sent once per phone before anything shows it. */
export interface IconMsg {
  k: 'icon';
  kind: string;
  src: string;
}

/** Phone → TV. Aim is -1 (far left) to 1 (far right). */
export type PhoneMsg =
  | { k: 'aim'; x: number }
  | { k: 'turn'; dir: number }
  | { k: 'drop'; x?: number }
  | { k: 'start' }
  | { k: 'cheer'; e: number };
