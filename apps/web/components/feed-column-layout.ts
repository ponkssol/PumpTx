import type { CSSProperties } from 'react';

/** Default feed column widths (px): time, token, sym, sol, mc, 24h vol, fdv, buyer, tx, links. */
export const FEED_COL_DEFAULTS: readonly number[] = [100, 148, 52, 56, 60, 58, 58, 104, 112, 72];

/** Columns that grow with available width (flex); others stay fixed to the stored pixel width. */
export const FEED_COL_GROW: readonly boolean[] = [false, true, false, false, false, false, false, true, true, false];

/** Minimum width (px) per column for resize clamps. */
export const FEED_COL_MINS: readonly number[] = [72, 96, 40, 44, 44, 44, 44, 72, 80, 60];

/** Bumped when column count or semantics change (invalidates saved widths). */
export const FEED_COL_STORAGE_KEY = 'pumptx-feed-col-widths-v3';

export const FEED_COL_COUNT = 10;

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
