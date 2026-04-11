'use client';

import Link from 'next/link';
import type { RecentBuySummary, Transaction } from '@/lib/db';
import { safeFiniteNumber } from '@/lib/format';
import styles from './TransactionDetail.module.css';

type Props = {
  tx: Transaction;
  onCopy: (text: string) => void;
  embedded?: boolean;
  recentSameMint?: RecentBuySummary[];
};

function shortSig(sig: string) {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}…${sig.slice(-6)}`;
}

function shortWallet(w: string) {
  if (w.length <= 14) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

export default function TransactionDetail({ tx, onCopy, embedded, recentSameMint = [] }: Props) {
  const solSpent = safeFiniteNumber(tx.sol_spent);
  const mcUsd = safeFiniteNumber(tx.market_cap_usd);
  const mcDisplay = mcUsd > 0 ? `$${mcUsd}` : '$0';

  return (
    <div className={`${styles.wrap} ${embedded ? styles.embedded : styles.fullPage}`}>
      {!embedded ? (
        <div className={styles.panelHead}>
          <div className={styles.title}>
            {tx.token_name} <span className={styles.sym}>[{tx.token_symbol}]</span>
          </div>
        </div>
      ) : (
        <header className={styles.embedHead}>
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
        {embedded ? (
          <>
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
          </>
        ) : (
          <div
            className={`${styles.fullSplit} ${styles.fullSplitPage} ${
              tx.image_url ? styles.fullSplitWithShare : styles.fullSplitSingle
            }`}
          >
            <section className={`${styles.fullCol} ${styles.fullColMerged}`} aria-labelledby="tx-chain-heading">
              <h3 className={styles.blockTitle} id="tx-chain-heading">
                On-chain
              </h3>
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
              <h4 className={styles.blockSubtitle} id="tx-meta-heading">
                Trade &amp; record
              </h4>
              <div className={styles.row}>
                <div className={styles.k}>Indexed at</div>
                <div className={styles.v}>{tx.created_at}</div>
              </div>
              <div className={styles.row}>
                <div className={styles.k}>Block time</div>
                <div className={styles.v}>{tx.timestamp}</div>
              </div>
              <div className={styles.row}>
                <div className={styles.k}>SOL spent</div>
                <div className={`${styles.v} ${styles.solVal}`}>{solSpent.toFixed(4)} SOL</div>
              </div>
              <div className={styles.row}>
                <div className={styles.k}>Token amount</div>
                <div className={styles.v}>{tx.token_amount}</div>
              </div>
              <div className={styles.row}>
                <div className={styles.k}>Market cap</div>
                <div className={styles.v}>{mcDisplay}</div>
              </div>
              <div className={styles.row}>
                <div className={styles.k}>Row id</div>
                <div className={styles.v}>{tx.id}</div>
              </div>
              {recentSameMint.length ? (
                <div className={styles.recentSection}>
                  <h4 className={styles.recentTitle} id="tx-recent-mint-heading">
                    Newer buys · same mint
                  </h4>
                  <ul className={styles.recentList} aria-labelledby="tx-recent-mint-heading">
                    {recentSameMint.map((r) => (
                      <li key={r.signature} className={styles.recentItem}>
                        <Link className={styles.recentLink} href={`/tx/${encodeURIComponent(r.signature)}`}>
                          {shortSig(r.signature)}
                        </Link>
                        <div className={styles.recentMeta}>
                          <span className={styles.recentSol}>{safeFiniteNumber(r.sol_spent).toFixed(4)} SOL</span>
                          <span className={styles.recentSep}>·</span>
                          <span>{r.timestamp}</span>
                        </div>
                        <div className={styles.recentBuyer}>{shortWallet(r.buyer_wallet)}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
            {tx.image_url ? (
              <section className={`${styles.fullCol} ${styles.fullColShare}`} aria-labelledby="tx-share-heading">
                <h3 className={styles.blockTitle} id="tx-share-heading">
                  Share card
                </h3>
                <figure className={styles.shareCardFigure}>
                  <div className={styles.canvasAccent} aria-hidden />
                  <div className={styles.shareCardFrame}>
                    <img
                      className={styles.shareCardImg}
                      src={tx.image_url}
                      alt={`${tx.token_symbol} share card preview`}
                    />
                  </div>
                </figure>
              </section>
            ) : null}
          </div>
        )}

        <div className={styles.sep} />

        <div className={styles.actions}>
          <a className={styles.btn} href={tx.pump_fun_url} target="_blank" rel="noreferrer">
            Pump.fun
          </a>
          <a className={styles.btn} href={tx.solscan_url} target="_blank" rel="noreferrer">
            Solscan
          </a>
        </div>

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
