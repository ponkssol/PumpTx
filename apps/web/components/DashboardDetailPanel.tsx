'use client';

import Link from 'next/link';
import type { Transaction } from '@/lib/db';
import TransactionDetail from '@/components/TransactionDetail';
import styles from './DashboardDetailPanel.module.css';

type Props = {
  tx: Transaction | null;
  orphanSignature: string | null;
  feedEmpty: boolean;
  onCopy: (text: string) => void;
};

export default function DashboardDetailPanel({ tx, orphanSignature, feedEmpty, onCopy }: Props) {
  if (feedEmpty) {
    return (
      <aside className={styles.aside} aria-label="transaction detail">
        <div className={styles.topBar}>
          <span className={styles.label}>// DETAIL</span>
        </div>
        <p className={styles.hint}>No buys recorded yet. When the bot detects trades, they appear in the list.</p>
      </aside>
    );
  }

  if (orphanSignature) {
    return (
      <aside className={styles.aside} aria-label="transaction detail">
        <div className={styles.topBar}>
          <span className={styles.label}>// DETAIL</span>
        </div>
        <p className={styles.muted}>This row is not in the latest 50 results.</p>
        <Link className={styles.linkOut} href={`/tx/${encodeURIComponent(orphanSignature)}`}>
          OPEN FULL PAGE →
        </Link>
      </aside>
    );
  }

  if (!tx) {
    return (
      <aside className={styles.aside} aria-label="transaction detail">
        <div className={styles.topBar}>
          <span className={styles.label}>// DETAIL</span>
        </div>
        <p className={styles.hint}>Select a row on the left. Double-click opens the full page.</p>
      </aside>
    );
  }

  return (
    <aside className={styles.aside} aria-label="transaction detail">
      <div className={styles.topBar}>
        <span className={styles.label}>// DETAIL</span>
        <Link className={styles.linkOut} href={`/tx/${encodeURIComponent(tx.signature)}`}>
          FULL PAGE →
        </Link>
      </div>
      <TransactionDetail tx={tx} onCopy={onCopy} embedded />
    </aside>
  );
}
