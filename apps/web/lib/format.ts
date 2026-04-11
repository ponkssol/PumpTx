/** Coerce API/DB values to a finite number for display and math. */
export function safeFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** USD market cap for labels: $12K, $1.25M, $500, $0. */
export function formatMarketCapUsd(value: unknown): string {
  const x = safeFiniteNumber(value, 0);
  if (x <= 0) return '$0';
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (x >= 1000) return `$${Math.round(x / 1000)}K`;
  return `$${Math.round(x)}`;
}
