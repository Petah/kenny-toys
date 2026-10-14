/**
 * Checks every level can be finished: the right size, parses both ways round, room for the
 * spinners, and a hole-free path from the start to the key, every star and the goal.
 *
 *   node games/tilt-maze/scripts/check-levels.ts
 *
 * It walks cell to cell, so it proves a route exists, not that it's easy to roll.
 */
import { LEVELS } from '../src/levels.ts';
import { COLS, ROWS, parseMaze, transpose } from '../src/maze.ts';

// A spinner's own cell is its pivot, so a route has to go round it.
const BLOCKED = new Set(['#', 'L', '1', '2', '3', '4', 'o', 'R']);

/** Cells reachable from the start, stepping up, down, left and right. */
function reachable(rows: string[], hasKey: boolean) {
  const start = rows.findIndex((r) => r.includes('S'));
  const seen = new Set([`${rows[start].indexOf('S')},${start}`]);
  const queue = [[rows[start].indexOf('S'), start]];
  while (queue.length) {
    const [x, y] = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ch = rows[y + dy]?.[x + dx];
      const key = `${x + dx},${y + dy}`;
      if (ch === undefined || seen.has(key) || (BLOCKED.has(ch) && !(hasKey && ch === 'L'))) continue;
      seen.add(key);
      queue.push([x + dx, y + dy]);
    }
  }
  return seen;
}

const find = (rows: string[], chars: string) =>
  rows.flatMap((row, y) => [...row].flatMap((ch, x) => (chars.includes(ch) ? [{ ch, at: `${x},${y}` }] : [])));

let failed = false;
LEVELS.forEach((level, i) => {
  const problems: string[] = [];
  const { rows } = level;
  if (rows.length !== ROWS || rows.some((r) => r.length !== COLS)) problems.push(`must be ${COLS} x ${ROWS}, rows are ${rows.map((r) => r.length).join(',')}`);
  try {
    parseMaze(rows);
    parseMaze(transpose(rows));
  } catch (e) {
    problems.push((e as Error).message);
  }

  for (const { at } of find(rows, 'R')) {
    const [x, y] = at.split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ch = rows[y + dy]?.[x + dx];
        if ((dx || dy) && ch !== undefined && ch !== '.') problems.push(`spinner at ${at} has '${ch}' next to it`);
      }
    }
  }

  // A laser spans a gap, so the cells just past each end of its run must be wall.
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== '-' && ch !== '|') return;
      const ends = ch === '-' ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
      for (const [cx, cy] of ends) {
        const end = rows[cy]?.[cx];
        if (end !== ch && end !== '#') problems.push(`laser at ${x},${y} ends at '${end ?? 'edge'}', not a wall`);
      }
    }),
  );

  const before = reachable(rows, false);
  const key = find(rows, 'k')[0];
  if (key && !before.has(key.at)) problems.push(`key at ${key.at} can't be reached`);
  const after = reachable(rows, Boolean(key));
  for (const { ch, at } of find(rows, '*Gg')) if (!after.has(at)) problems.push(`'${ch}' at ${at} can't be reached`);
  const stars = find(rows, '*').length;
  if (stars !== 3) problems.push(`has ${stars} stars, wants 3`);

  if (problems.length) failed = true;
  console.log(`${String(i + 1).padStart(2)}. ${level.name.padEnd(14)} ${problems.length ? problems.join('; ') : 'ok'}`);
});
process.exit(failed ? 1 : 0);
