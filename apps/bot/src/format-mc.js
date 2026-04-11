/**
 * USD market cap: $12K, $1.25M, $500.
 * @param {number} n
 * @param {{ zeroLabel?: string }} [opts] — default zero is "$0"; use "N/A" for share-card pill.
 * @returns {string}
 */
function formatMarketCapUsd(n, opts = {}) {
  const x = Number(n);
  const zero = opts.zeroLabel !== undefined ? opts.zeroLabel : '$0';
  if (!Number.isFinite(x) || x <= 0) return zero;
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (x >= 1000) return `$${Math.round(x / 1000)}K`;
  return `$${Math.round(x)}`;
}

module.exports = { formatMarketCapUsd };
