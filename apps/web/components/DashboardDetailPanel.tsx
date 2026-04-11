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
          {tx ? (
            <Link className={styles.linkOut} href={`/tx/${encodeURIComponent(tx.signature)}`}>
              NEWEST IN FEED →
            </Link>
          ) : null}
        </div>
        <p className={styles.muted}>Selection is not in the latest 50 rows. The card below shows the newest buy in the feed.</p>
        <div className={styles.orphanActions}>
          <Link className={styles.linkOut} href={`/tx/${encodeURIComponent(orphanSignature)}`}>
            OPEN SELECTED TX →
          </Link>
        </div>
        {tx ? <TransactionDetail tx={tx} onCopy={onCopy} embedded /> : null}
      </aside>
    );
  }

  if (!tx) {
    return (
      <aside className={styles.aside} aria-label="transaction detail">
        <div className={styles.topBar}>
          <span className={styles.label}>// DETAIL</span>
        </div>
        <p className={styles.hint}>Waiting for data. When buys load, the newest row appears here.</p>
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
