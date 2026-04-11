'use client';

import { useRouter } from 'next/navigation';
import type { Transaction } from '@/lib/db';
import { safeFiniteNumber } from '@/lib/format';
import styles from './TransactionRow.module.css';

type Props = { tx: Transaction; animate?: boolean; selected?: boolean; onSelect: (tx: Transaction) => void };

function shortSig(sig: string) {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}…${sig.slice(-6)}`;
}

export default function TransactionRow({ tx, animate, selected, onSelect }: Props) {
  const router = useRouter();
  const wallet = String(tx.buyer_wallet ?? '');
  const buyerShort = wallet.length > 14 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
  const solSpent = safeFiniteNumber(tx.sol_spent);
  const mcUsd = safeFiniteNumber(tx.market_cap_usd);

  return (
    <article
      className={`${styles.card} ${animate ? styles.enter : ''} ${selected ? styles.selected : ''}`}
      role="button"
      aria-pressed={Boolean(selected)}
      tabIndex={0}
      onClick={() => onSelect(tx)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(tx);
        }
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        router.push(`/tx/${encodeURIComponent(tx.signature)}`);
      }}
    >
      <div className={styles.cell}>
        <span className={styles.time}>{tx.timestamp}</span>
      </div>
      <div className={`${styles.cell} ${styles.cellToken}`}>
        <span className={styles.token}>{tx.token_name}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.badge}>{tx.token_symbol}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.sol}>{solSpent.toFixed(4)}</span>
      </div>
      <div className={styles.cell}>
        <span className={mcUsd > 0 ? styles.mc : styles.mc0}>{mcUsd > 0 ? `$${mcUsd}` : '$0'}</span>
      </div>
      <div className={`${styles.cell} ${styles.cellBuyer}`}>
        <span className={styles.buyer} title={wallet}>
          {buyerShort}
        </span>
      </div>
      <div className={styles.cell}>
        <a
          className={styles.sigLink}
          href={tx.solscan_url}
          target="_blank"
          rel="noreferrer"
          title={tx.signature}
          onClick={(e) => e.stopPropagation()}
        >
          {shortSig(tx.signature)}
        </a>
      </div>
      <div className={`${styles.cell} ${styles.cellLinks}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.links}>
          <a className={styles.iconBtn} href={tx.pump_fun_url} target="_blank" rel="noreferrer" title="PumpFun">
            PF
          </a>
          <a className={styles.iconBtn} href={tx.solscan_url} target="_blank" rel="noreferrer" title="Solscan">
            SC
          </a>
        </div>
      </div>
    </article>
  );
}
