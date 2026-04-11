import StatusBadge from './StatusBadge';
import styles from './StatsBanner.module.css';

type Props = {
  totalBuys: number;
  totalSol: number;
};

export default function StatsBanner({ totalBuys, totalSol }: Props) {
  return (
    <section className={styles.bar} aria-label="stats">
      <span>
        <span className={styles.label}>total</span>
        <span className={styles.val}>{totalBuys.toLocaleString()}</span>
        <span> buys</span>
      </span>
      <span className={styles.sep}>|</span>
      <span>
        <span className={styles.label}>volume</span>
        <span className={styles.val}>{totalSol.toFixed(4)}</span>
        <span> SOL</span>
      </span>
      <span className={styles.sep}>|</span>
      <StatusBadge />
    </section>
  );
}
