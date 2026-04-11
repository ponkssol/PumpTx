import type { Transaction } from '@/lib/db';
import StatusBadge from './StatusBadge';
import TransactionRow from './TransactionRow';
import styles from './TransactionFeed.module.css';

type Props = {
  transactions: Transaction[];
  newestId?: number;
  selectedSignature: string | null;
  onSelect: (tx: Transaction) => void;
};

export default function TransactionFeed({ transactions, newestId, selectedSignature, onSelect }: Props) {
  return (
    <section className={styles.shell} aria-label="transaction feed">
      <div className={styles.chrome}>
        <div className={styles.query}>is:buy program:pump · sort:newest · limit:50</div>
        <div className={styles.chromeRight}>
          <span className={styles.live}>live</span>
          <StatusBadge />
        </div>
      </div>

      <div className={styles.viewport}>
        <div className={styles.scrollInner}>
          <div className={styles.header}>
            <div>time</div>
            <div>token</div>
            <div>sym</div>
            <div>sol</div>
            <div>mc</div>
            <div>buyer</div>
            <div>tx</div>
            <div>links</div>
          </div>

          <div className={styles.list}>
            {transactions.length === 0 ? (
              <div className={styles.empty}>// no rows</div>
            ) : (
              transactions.map((t) => (
                <TransactionRow
                  key={t.id}
                  tx={t}
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
