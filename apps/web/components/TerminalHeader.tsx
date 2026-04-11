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
      <div className={styles.inner}>
        <div className={styles.lead}>
          <img className={styles.brandLogo} src="/pumptx-logo.png" alt="PumpTx" width={96} height={20} />
        </div>
        <div className={styles.trail}>
          <span className={styles.clock}>{mounted ? formatNow(now) : '—'}</span>
        </div>
      </div>
    </header>
  );
}
