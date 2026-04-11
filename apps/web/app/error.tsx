'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 24,
        background: '#030303',
        color: '#f4f4f4',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <h1 style={{ fontSize: 16, margin: '0 0 12px', color: '#00ff41' }}>PumpTx — error</h1>
      <p style={{ color: '#9a9a9a', fontSize: 13, margin: '0 0 16px', maxWidth: 560 }}>{error.message}</p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          padding: '10px 16px',
          background: '#0a0a0a',
          border: '1px solid #00ff41',
          color: '#00ff41',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 12,
        }}
      >
        Try again
      </button>
    </div>
  );
}
