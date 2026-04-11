'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Transaction } from '@/lib/db';
import TerminalHeader from '@/components/TerminalHeader';
import StatsBanner from '@/components/StatsBanner';
import TransactionFeed from '@/components/TransactionFeed';
import DashboardDetailPanel from '@/components/DashboardDetailPanel';
import styles from './page.module.css';

type Stats = { total_transactions: number; total_sol_volume: number };

export default function HomePage() {
  const [loading, setLoading] = useState(true);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<Stats>({ total_transactions: 0, total_sol_volume: 0 });
  const [newestId, setNewestId] = useState<number | undefined>(undefined);
  const [selectedSig, setSelectedSig] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const prevTop = useRef<number | undefined>(undefined);

  const selectedTx = useMemo(
    () => (selectedSig ? txs.find((t) => t.signature === selectedSig) ?? null : null),
    [txs, selectedSig],
  );

  const orphanSignature = useMemo(() => {
    if (!selectedSig || !txs.length) return null;
    return txs.some((t) => t.signature === selectedSig) ? null : selectedSig;
  }, [txs, selectedSig]);

  /** Detail: newest row until user picks a row; after pick, that row (orphan falls back to newest preview). */
  const detailTx = useMemo(() => {
    if (!txs.length) return null;
    if (selectedSig === null || orphanSignature) return txs[0];
    return selectedTx;
  }, [txs, selectedSig, orphanSignature, selectedTx]);

  const feedSelectedSignature = selectedSig ?? txs[0]?.signature ?? null;

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

    const load = async () => {
      try {
        const res = await fetch('/api/transactions', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to load');
        if (cancelled) return;
        const next: Transaction[] = data.transactions || [];
        const top = next[0]?.id;
        if (prevTop.current && top && top !== prevTop.current) setNewestId(top);
        prevTop.current = top;
        setTxs(next);
        setStats(data.stats || { total_transactions: 0, total_sol_volume: 0 });
      } catch {
        // Keep UI stable; next poll may recover
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!txs.length) setSelectedSig(null);
  }, [loading, txs]);

  const statusLine = useMemo(() => {
    if (loading) return 'PumpTx · loading…';
    const n = txs.length;
    const pos = detailTx ? txs.findIndex((t) => t.signature === detailTx.signature) + 1 : 0;
    const idx = pos > 0 ? `${pos}/${n}` : `—/${n}`;
    return `PumpTx · BUYS · ${idx} · poll 5s · ${stats.total_transactions} total`;
  }, [loading, txs, detailTx, stats.total_transactions]);

  return (
    <div className={styles.page}>
      <TerminalHeader />
      <main className={styles.main}>
        <StatsBanner totalBuys={stats.total_transactions} totalSol={stats.total_sol_volume} />
        <div className={styles.window}>
          {loading ? <div className={styles.skel} aria-label="loading" /> : null}
          {!loading ? (
            <div className={styles.dashboard}>
              <div className={styles.paneList}>
                <TransactionFeed
                  transactions={txs}
                  newestId={newestId}
                  selectedSignature={feedSelectedSignature}
                  onSelect={(t) => setSelectedSig(t.signature)}
                />
              </div>
              <div className={styles.paneDetail}>
                <DashboardDetailPanel
                  tx={detailTx}
                  orphanSignature={orphanSignature}
                  feedEmpty={!loading && txs.length === 0}
                  onCopy={onCopy}
                />
              </div>
            </div>
          ) : null}
        </div>
        <footer className={styles.statusBar} role="status">
          {statusLine}
        </footer>
      </main>
      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </div>
  );
}
