import styles from './StatusBadge.module.css';

export default function StatusBadge() {
  return (
    <div className={styles.wrap}>
      <span className={styles.dot} aria-hidden />
      <span>ONLINE</span>
    </div>
  );
}
