'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Transaction } from '@/lib/db';
import StatusBadge from './StatusBadge';
import TransactionRow from './TransactionRow';
import {
  FEED_COL_DEFAULTS,
  FEED_COL_MINS,
  FEED_COL_STORAGE_KEY,
  feedColumnFlexStyle,
  parseFeedColumnWidths,
} from './feed-column-layout';
import styles from './TransactionFeed.module.css';

const LABELS = ['time', 'token', 'sym', 'sol', 'mc', 'buyer', 'tx', 'links'] as const;

const GAP_PX = 8;
const COLS = FEED_COL_DEFAULTS.length;
/** Horizontal padding on header and rows (8px + 8px). */
const TABLE_PAD_X = 16;

type Props = {
  transactions: Transaction[];
  newestId?: number;
  selectedSignature: string | null;
  onSelect: (tx: Transaction) => void;
};

type DragSession = { i: number; startX: number; startW: number[] };

export default function TransactionFeed({ transactions, newestId, selectedSignature, onSelect }: Props) {
  const [colWidths, setColWidths] = useState<number[]>(() => [...FEED_COL_DEFAULTS]);
  const [drag, setDrag] = useState<DragSession | null>(null);

  useEffect(() => {
    try {
      const parsed = parseFeedColumnWidths(localStorage.getItem(FEED_COL_STORAGE_KEY));
      if (parsed) setColWidths(parsed);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FEED_COL_STORAGE_KEY, JSON.stringify(colWidths));
    } catch {
      /* ignore */
    }
  }, [colWidths]);

  /** Fill the pane width but never shrink below the sum of columns; trail flex absorbs extra space. */
  const scrollStyle = useMemo(() => {
    const sum = colWidths.reduce((a, b) => a + b, 0);
    const gaps = (COLS - 1) * GAP_PX;
    const w = TABLE_PAD_X + sum + gaps;
    return { width: '100%', minWidth: `${w}px` } as CSSProperties;
  }, [colWidths]);

  const startResize = useCallback((boundaryIndex: number, clientX: number) => {
    if (boundaryIndex < 0 || boundaryIndex >= COLS - 1) return;
    setDrag({ i: boundaryIndex, startX: clientX, startW: [...colWidths] });
  }, [colWidths]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const dx = Math.round(e.clientX - drag.startX);
      const wi = drag.startW[drag.i] + dx;
      const wi1 = drag.startW[drag.i + 1] - dx;
      if (wi < FEED_COL_MINS[drag.i]! || wi1 < FEED_COL_MINS[drag.i + 1]!) return;
      setColWidths(() => {
        const next = [...drag.startW];
        next[drag.i] = wi;
        next[drag.i + 1] = wi1;
        return next;
      });
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag]);

  const resetWidths = useCallback(() => {
    setColWidths([...FEED_COL_DEFAULTS]);
    try {
      localStorage.removeItem(FEED_COL_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <section className={styles.shell} aria-label="transaction feed">
      <div className={styles.chrome}>
        <div className={styles.query}>is:buy program:pump · sort:newest · limit:50</div>
        <div className={styles.chromeRight}>
          <button type="button" className={styles.resetCols} onClick={resetWidths} title="Reset column widths">
            reset cols
          </button>
          <span className={styles.live}>live</span>
          <StatusBadge />
        </div>
      </div>

      <div className={styles.viewport}>
        <div className={styles.scrollInner} style={scrollStyle}>
          <div className={styles.header}>
            {LABELS.map((label, i) => (
              <div
                key={label}
                className={styles.headerCell}
                style={feedColumnFlexStyle(i, colWidths)}
              >
                <span className={styles.headerLabel}>{label}</span>
                {i < COLS - 1 ? (
                  <button
                    type="button"
                    className={styles.colGrip}
                    aria-label={`Resize columns ${label} and ${LABELS[i + 1]}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startResize(i, e.clientX);
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>

          <div className={styles.list}>
            {transactions.length === 0 ? (
              <div className={styles.empty}>No transactions yet</div>
            ) : (
              transactions.map((t) => (
                <TransactionRow
                  key={t.id}
                  tx={t}
                  columnWidths={colWidths}
                  animate={newestId === t.id}
                  selected={t.signature === selectedSignature}
                  onSelect={onSelect}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
