/**
 * Circuits made of the Toy Car Kit's wide track pieces, chained end to end. No three.js or
 * Rapier here, so the circuit checker runs it in Node.
 *
 * Every piece is modelled entering at its origin heading +z, with its deck 0.9 below the origin
 * and its far end ("exit") somewhere ahead. A piece can be mirrored (a right corner becomes a
 * left one) and driven backwards (a hill up becomes a hill down), which covers every turn and
 * slope with a handful of models.
 */

export const MODEL_PREFIX = 'track-wide-';
/** How far below a piece's origin its deck sits. */
export const DECK = 0.9;
/** Track width, wall to wall. */
export const WIDTH = 2;

/** A position and heading. Heading 0 faces +z; positive turns towards +x. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface PieceDef {
  model: string;
  /** Where the far end is, relative to the entry, and how the heading and height change. */
  exit: Pose;
  /** A point on the centre line of the deck at t ∈ [0, 1], relative to the entry. */
  centre: (t: number) => { x: number; y: number; z: number };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The corner pieces turn right (towards -x when heading +z) about a centre `r` to the side. */
const arc = (r: number, rise = 0) => (t: number) => {
  const a = (t * Math.PI) / 2;
  return { x: -r + r * Math.cos(a), y: rise * smooth(t), z: r * Math.sin(a) };
};

export const PIECES = {
  straight: { model: 'straight', exit: { x: 0, y: 0, z: 4, yaw: 0 }, centre: (t) => ({ x: 0, y: 0, z: 4 * t }) },
  corner: { model: 'corner-small', exit: { x: -2, y: 0, z: 2, yaw: -Math.PI / 2 }, centre: arc(2) },
  bigCorner: { model: 'corner-large', exit: { x: -4, y: 0, z: 4, yaw: -Math.PI / 2 }, centre: arc(4) },
  rampCorner: { model: 'corner-small-ramp', exit: { x: -2, y: 1, z: 2, yaw: -Math.PI / 2 }, centre: arc(2, 1) },
  bigRampCorner: { model: 'corner-large-ramp', exit: { x: -4, y: 1, z: 4, yaw: -Math.PI / 2 }, centre: arc(4, 1) },
  curve: { model: 'curve', exit: { x: -2, y: 0, z: 4, yaw: 0 }, centre: (t) => ({ x: -2 * smooth(t), y: 0, z: 4 * t }) },
  hill: { model: 'straight-hill-complete', exit: { x: 0, y: 1, z: 4, yaw: 0 }, centre: (t) => ({ x: 0, y: smooth(t), z: 4 * t }) },
  bump: { model: 'straight-bump-up', exit: { x: 0, y: 0, z: 4, yaw: 0 }, centre: (t) => ({ x: 0, y: 0.25 * (1 - Math.cos(2 * Math.PI * t)), z: 4 * t }) },
  dip: { model: 'straight-bump-down', exit: { x: 0, y: 0, z: 4, yaw: 0 }, centre: (t) => ({ x: 0, y: -0.25 * (1 - Math.cos(2 * Math.PI * t)), z: 4 * t }) },
} satisfies Record<string, PieceDef>;

export type PieceName = keyof typeof PIECES;

/**
 * Circuit notation, one token per piece:
 *   S straight · r/l small corner · R/L big corner · sr/sl S-bend to the right/left
 *   U/D hill up/down · b bump · v dip · ur/ul/dr/dl small corner climbing or descending
 *   UR/UL/DR/DL big corner climbing or descending
 */
const TOKENS: Record<string, { piece: PieceName; mirror: boolean; reverse: boolean }> = {
  S: { piece: 'straight', mirror: false, reverse: false },
  r: { piece: 'corner', mirror: false, reverse: false },
  l: { piece: 'corner', mirror: true, reverse: false },
  R: { piece: 'bigCorner', mirror: false, reverse: false },
  L: { piece: 'bigCorner', mirror: true, reverse: false },
  sr: { piece: 'curve', mirror: false, reverse: false },
  sl: { piece: 'curve', mirror: true, reverse: false },
  U: { piece: 'hill', mirror: false, reverse: false },
  D: { piece: 'hill', mirror: false, reverse: true },
  b: { piece: 'bump', mirror: false, reverse: false },
  v: { piece: 'dip', mirror: false, reverse: false },
  ur: { piece: 'rampCorner', mirror: false, reverse: false },
  ul: { piece: 'rampCorner', mirror: true, reverse: false },
  // Driven backwards, a climbing right corner is a descending left one.
  dl: { piece: 'rampCorner', mirror: false, reverse: true },
  dr: { piece: 'rampCorner', mirror: true, reverse: true },
  UR: { piece: 'bigRampCorner', mirror: false, reverse: false },
  UL: { piece: 'bigRampCorner', mirror: true, reverse: false },
  DL: { piece: 'bigRampCorner', mirror: false, reverse: true },
  DR: { piece: 'bigRampCorner', mirror: true, reverse: true },
};

export interface Placed {
  piece: PieceName;
  model: string;
  /** Where the model goes: its origin's position (deck height, not origin height) and turn. */
  at: Pose;
  mirror: boolean;
  reverse: boolean;
  entry: Pose;
  exit: Pose;
  /** World centre-line point at t ∈ [0, 1] in driving order. */
  centre: (t: number) => { x: number; y: number; z: number };
}

/** A local point placed by a pose. */
export function apply(p: Pose, lx: number, ly: number, lz: number) {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return { x: p.x + lx * c + lz * s, y: p.y + ly, z: p.z - lx * s + lz * c };
}

function compose(a: Pose, b: Pose): Pose {
  const q = apply(a, b.x, b.y, b.z);
  return { ...q, yaw: a.yaw + b.yaw };
}

function invert(p: Pose): Pose {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  // The inverse turns back by yaw and undoes the offset.
  return { x: -(p.x * c - p.z * s), y: -p.y, z: -(p.x * s + p.z * c), yaw: -p.yaw };
}

/** Places a piece so that driving it starts at `from`. */
export function place(name: PieceName, mirror: boolean, reverse: boolean, from: Pose): Placed {
  const def: PieceDef = PIECES[name];
  const m = mirror ? -1 : 1;
  const exitLocal: Pose = { x: def.exit.x * m, y: def.exit.y, z: def.exit.z, yaw: def.exit.yaw * m };
  const local = (t: number) => {
    const c = def.centre(t);
    return { x: c.x * m, y: c.y, z: c.z };
  };
  let at: Pose;
  let exit: Pose;
  if (!reverse) {
    at = from;
    exit = compose(at, exitLocal);
  } else {
    // Entering at the far end, facing back the way the piece was drawn.
    const farEntry: Pose = { ...exitLocal, yaw: exitLocal.yaw + Math.PI };
    at = compose(from, invert(farEntry));
    exit = compose(at, { x: 0, y: 0, z: 0, yaw: Math.PI });
  }
  const centre = (t: number) => {
    const c = local(reverse ? 1 - t : t);
    return apply(at, c.x, c.y, c.z);
  };
  return { piece: name, model: `${MODEL_PREFIX}${def.model}`, at, mirror, reverse, entry: from, exit: { ...exit, yaw: wrap(exit.yaw) }, centre };
}

export function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export interface Circuit {
  name: string;
  /** Track colour. Orange is the kit's own; the others come from its variation textures. */
  paint: 'orange' | 'yellow' | 'blue' | 'green';
  /** Height of the start line above the floor, in levels. */
  base: number;
  layout: string;
}

export interface Built {
  circuit: Circuit;
  pieces: Placed[];
  /** The centre line, evenly spaced, in driving order and closing back on itself. */
  line: { x: number; y: number; z: number }[];
  /** Distance along the line at each of its points. */
  dist: number[];
  length: number;
  /** How far the end lands from the start, which a closed circuit keeps at nothing. */
  gap: { pos: number; yaw: number; y: number };
}

/** Spacing of the centre line's points. */
export const LINE_STEP = 0.25;

export function build(circuit: Circuit): Built {
  let pose: Pose = { x: 0, y: circuit.base, z: 0, yaw: 0 };
  const pieces: Placed[] = [];
  for (const token of circuit.layout.trim().split(/\s+/)) {
    const t = TOKENS[token];
    if (!t) throw new Error(`${circuit.name}: unknown piece "${token}"`);
    const p = place(t.piece, t.mirror, t.reverse, pose);
    pieces.push(p);
    pose = p.exit;
  }
  // Sample each piece finely, then resample evenly by distance.
  const raw: { x: number; y: number; z: number }[] = [];
  for (const p of pieces) for (let i = 0; i < 40; i++) raw.push(p.centre(i / 40));
  raw.push(raw[0]);
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y, raw[i].z - raw[i - 1].z));
  const length = cum[cum.length - 1];
  const line: Built['line'] = [];
  const dist: number[] = [];
  let j = 0;
  for (let d = 0; d < length - LINE_STEP / 2; d += LINE_STEP) {
    while (cum[j + 1] < d) j++;
    const f = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const a = raw[j];
    const b = raw[j + 1];
    line.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
    dist.push(d);
  }
  const gap = { pos: Math.hypot(pose.x, pose.z), yaw: Math.abs(wrap(pose.yaw)), y: Math.abs(pose.y - circuit.base) };
  return { circuit, pieces, line, dist, length, gap };
}

/** Footprint check: any two pieces that aren't neighbours and sit at the same level shouldn't overlap. */
export function overlaps(b: Built): [number, number][] {
  const n = b.pieces.length;
  const pts = b.pieces.map((p) => Array.from({ length: 9 }, (_, i) => p.centre(i / 8)));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      if (i === 0 && k === n - 1) continue;
      const hit = pts[i].some((a) => pts[k].some((c) => Math.hypot(a.x - c.x, a.z - c.z) < WIDTH * 0.95 && Math.abs(a.y - c.y) < 1.2));
      if (hit) out.push([i, k]);
    }
  }
  return out;
}

export const CIRCUITS: Circuit[] = [
  {
    name: 'Rug Rally',
    paint: 'orange',
    base: 0,
    layout: 'S sr sl R b R S S S S R b R S',
  },
  {
    name: 'Hill Street',
    paint: 'yellow',
    base: 0,
    layout: 'S S U S sr sl D S R S S S R S b S S S S S S R S S S R',
  },
  {
    name: 'Double Decker',
    paint: 'blue',
    base: 0,
    layout: 'S r l l r S UR S S R S S v S DR S S R',
  },
];
