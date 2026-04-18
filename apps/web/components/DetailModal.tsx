'use client';

import { useEffect } from 'react';
import styles from './DetailModal.module.css';

type Props = {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
};

export default function DetailModal({ title = '// DETAIL', onClose, children }: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.root} role="dialog" aria-modal="true" aria-labelledby="pumptx-detail-modal-title">
      <button type="button" className={styles.backdrop} onClick={onClose} aria-label="Tutup detail" />
      <div className={styles.sheet}>
        <div className={styles.head}>
          <h2 id="pumptx-detail-modal-title" className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Tutup">
            ×
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
