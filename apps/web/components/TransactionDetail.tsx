'use client';

import type { Transaction } from '@/lib/db';
import { safeFiniteNumber } from '@/lib/format';
import styles from './TransactionDetail.module.css';

type Props = { tx: Transaction; onCopy: (text: string) => void; embedded?: boolean };

export default function TransactionDetail({ tx, onCopy, embedded }: Props) {
  const solSpent = safeFiniteNumber(tx.sol_spent);
  const mcUsd = safeFiniteNumber(tx.market_cap_usd);
  const mcDisplay = mcUsd > 0 ? `$${mcUsd}` : '$0';

  return (
    <div className={`${styles.wrap} ${embedded ? styles.embedded : ''}`}>
      {!embedded ? (
        <div className={styles.panelHead}>
          <img className={styles.panelBrandLogo} src="/pumptx-logo.png" alt="PumpTx" width={120} height={26} />
          <div className={styles.title}>
            {tx.token_name} <span className={styles.sym}>[{tx.token_symbol}]</span>
          </div>
        </div>
      ) : (
        <header className={styles.embedHead}>
          <div className={styles.embedBrandRow}>
            <img className={styles.embedBrandLogo} src="/pumptx-logo.png" alt="PumpTx" width={112} height={24} />
          </div>
          <div className={styles.embedTitleRow}>
            <h2 className={styles.tokenTitle}>{tx.token_name}</h2>
            <span className={styles.symBadge}>{tx.token_symbol}</span>
          </div>
          <dl className={styles.statStrip}>
            <div className={styles.statItem}>
              <dt>Time</dt>
              <dd>{tx.timestamp}</dd>
            </div>
            <div className={styles.statItem}>
              <dt>SOL</dt>
              <dd className={styles.statHighlight}>{solSpent.toFixed(4)}</dd>
            </div>
            <div className={styles.statItem}>
              <dt>Tokens</dt>
              <dd>{tx.token_amount}</dd>
            </div>
            <div className={styles.statItem}>
              <dt>MC</dt>
              <dd>{mcDisplay}</dd>
            </div>
          </dl>
        </header>
      )}

      <div className={styles.body}>
        <div className={styles.row}>
          <div className={styles.k}>Signature</div>
          <div className={`${styles.v} ${styles.sigRow}`}>
            <a className={styles.sigLink} href={tx.solscan_url} target="_blank" rel="noreferrer" title="Open on Solscan">
              {tx.signature}
            </a>
            <button type="button" className={styles.copyMini} onClick={() => onCopy(tx.signature)} title="Copy signature">
              Copy
            </button>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.k}>Token mint</div>
          <div className={`${styles.v} ${styles.mint}`} onClick={() => onCopy(tx.token_mint)} title="Click to copy">
            {tx.token_mint}
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.k}>Buyer</div>
          <div className={styles.v}>{tx.buyer_wallet}</div>
        </div>

        {!embedded ? (
          <>
            <div className={styles.row}>
              <div className={styles.k}>SOL spent</div>
              <div className={`${styles.v} ${styles.solVal}`}>{solSpent.toFixed(4)} SOL</div>
            </div>
            <div className={styles.row}>
              <div className={styles.k}>Token amt</div>
              <div className={styles.v}>{tx.token_amount}</div>
            </div>
            <div className={styles.row}>
              <div className={styles.k}>Market cap</div>
              <div className={styles.v}>{mcDisplay}</div>
            </div>
            <div className={styles.row}>
              <div className={styles.k}>Timestamp</div>
              <div className={styles.v}>{tx.timestamp}</div>
            </div>
          </>
        ) : null}

        <div className={styles.sep} />

        <div className={styles.actions}>
          <a className={styles.btn} href={tx.pump_fun_url} target="_blank" rel="noreferrer">
            Pump.fun
          </a>
          <a className={styles.btn} href={tx.solscan_url} target="_blank" rel="noreferrer">
            Solscan
          </a>
        </div>

        {tx.image_url ? (
          <figure className={styles.canvas}>
            <div className={styles.canvasAccent} aria-hidden />
            <figcaption className={styles.canvasCap}>
              <span className={styles.canvasCapLeft}>
                <img className={styles.canvasBrandLogo} src="/pumptx-logo.png" alt="" width={96} height={20} />
                <span className={styles.canvasCapLabel}>Share card</span>
              </span>
            </figcaption>
            <div className={styles.canvasFrame}>
              <img
                className={styles.img}
                src={tx.image_url}
                alt={`${tx.token_symbol} share card preview`}
              />
            </div>
          </figure>
        ) : null}

        <div className={styles.sep} />

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              const base = (process.env.NEXT_PUBLIC_BASE_URL || window.location.origin).replace(/\/$/, '');
              onCopy(`${base}/tx/${tx.signature}`);
            }}
          >
            Copy tx link
          </button>
          <button type="button" className={styles.btn} onClick={() => onCopy(tx.token_mint)}>
            Copy mint
          </button>
        </div>
      </div>
    </div>
  );
}
