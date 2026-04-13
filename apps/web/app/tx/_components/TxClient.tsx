'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { RecentBuySummary, Transaction } from '@/lib/db';
import TerminalHeader from '@/components/TerminalHeader';
import TransactionDetail from '@/components/TransactionDetail';
import styles from '../[signature]/page.module.css';

export default function TxClient({
  signature,
  initialTx,
  initialRecentSameMint,
}: {
  signature: string;
  initialTx: Transaction | null;
  initialRecentSameMint: RecentBuySummary[];
}) {
  const [tx, setTx] = useState<Transaction | null | undefined>(initialTx ?? null);
  const [recentSameMint, setRecentSameMint] = useState<RecentBuySummary[]>(initialRecentSameMint);
  const [toast, setToast] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  }, []);

  const onCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        flash('// COPIED TO CLIPBOARD');
      } catch {
        flash('// COPY FAILED');
      }
    },
    [flash],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/transactions/${encodeURIComponent(signature)}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 404) {
          setTx(null);
          setRecentSameMint([]);
        } else if (!res.ok) {
          setTx(null);
          setRecentSameMint([]);
        } else {
          const { recent_same_mint: recent, ...row } = data as Transaction & {
            recent_same_mint?: RecentBuySummary[];
          };
          setTx(row as Transaction);
          setRecentSameMint(Array.isArray(recent) ? recent : []);
        }
      } catch {
        if (!cancelled) {
          setTx(null);
          setRecentSameMint([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signature]);

  return (
    <div className={styles.page}>
      <TerminalHeader />
      <main className={styles.main}>
        <div className={styles.toolbar}>
          <Link className={styles.back} href="/">
            ← Back to feed
          </Link>
          <div className={styles.h}>Transaction detail</div>
        </div>

        {tx === undefined ? <div className={styles.loading}>// LOADING…</div> : null}
        {tx === null ? <div className={styles.err}>// 404 — TRANSACTION NOT FOUND</div> : null}
        {tx ? <TransactionDetail tx={tx} recentSameMint={recentSameMint} onCopy={onCopy} /> : null}

        {toast ? <div className={styles.toast}>{toast}</div> : null}
      </main>
    </div>
  );
}

