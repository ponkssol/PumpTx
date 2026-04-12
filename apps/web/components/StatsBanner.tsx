import StatusBadge from './StatusBadge';
import styles from './StatsBanner.module.css';

function formatVolumeUsd(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n >= 100_000 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(n);
}

type Props = {
  totalBuys: number;
  totalSol: number;
  /** Total SOL volume × spot SOL/USD (null if price unavailable). */
  volumeUsd: number | null;
};

export default function StatsBanner({ totalBuys, totalSol, volumeUsd }: Props) {
  const usdPart =
    volumeUsd != null && Number.isFinite(volumeUsd) ? formatVolumeUsd(volumeUsd) : null;

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
        {usdPart ? (
          <span className={styles.usdNote} title="Approx. from spot SOL/USD (refreshed ~60s)">
            {' '}
            (≈ {usdPart})
          </span>
        ) : null}
      </span>
      <span className={styles.sep}>|</span>
      <StatusBadge />
    </section>
  );
}
