import type { CSSProperties } from 'react';

/** Default feed column widths (px), left → right: time, token, sym, sol, mc, buyer, tx, links. */
export const FEED_COL_DEFAULTS: readonly number[] = [100, 156, 52, 56, 64, 108, 120, 76];

/** Columns that grow with available width (flex); others stay fixed to the stored pixel width. */
export const FEED_COL_GROW: readonly boolean[] = [false, true, false, false, false, true, true, false];

/** Minimum width (px) per column for resize clamps. */
export const FEED_COL_MINS: readonly number[] = [72, 96, 40, 44, 44, 72, 80, 60];

/** Bumped so older stretched-viewport layouts do not reuse broken widths with the new table sizing. */
export const FEED_COL_STORAGE_KEY = 'pumptx-feed-col-widths-v2';

export const FEED_COL_COUNT = 8;

/** Flex styles so the table fills the pane: grow columns absorb extra horizontal space. */
export function feedColumnFlexStyle(index: number, widths: readonly number[]): CSSProperties {
  const w = widths[index] ?? FEED_COL_DEFAULTS[index] ?? 60;
  const m = FEED_COL_MINS[index] ?? 40;
  if (FEED_COL_GROW[index]) {
    return { flex: `1 1 ${w}px`, minWidth: m, minHeight: 0 };
  }
  return { flex: `0 0 ${w}px`, minWidth: m, flexShrink: 0 };
}

export function parseFeedColumnWidths(raw: string | null): number[] | null {
  if (raw == null || raw === '') return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length !== FEED_COL_COUNT) return null;
    const out: number[] = [];
    for (let i = 0; i < FEED_COL_COUNT; i++) {
      const n = Math.round(Number(arr[i]));
      if (!Number.isFinite(n)) return null;
      out.push(Math.max(FEED_COL_MINS[i]!, n));
    }
    return out;
  } catch {
    return null;
  }
}
