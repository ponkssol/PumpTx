'use client';

import { useEffect, useState } from 'react';
import styles from './TerminalHeader.module.css';

function formatNow(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function TerminalHeader() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setMounted(true);
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <img className={styles.brandLogo} src="/pumptx-logo.png" alt="PumpTx" width={132} height={28} />
        <span className={styles.tag}>pumpfun · buys</span>
      </div>
      <div className={styles.right}>
        <span className={styles.clock}>{mounted ? formatNow(now) : '—'}</span>
      </div>
    </header>
  );
}
