const COLS = 'ABCDEFGHIJKLMNOP';

/** Convert 0-based (x, y) to human-readable grid label e.g. (11, 7) → "L8" */
export function gridLabel(x: number, y: number): string {
  const col = COLS[x] ?? x.toString();
  return `${col}${y + 1}`;
}
