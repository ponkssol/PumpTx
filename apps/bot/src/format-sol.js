/** @param {unknown} amount */
function formatSolAmount(amount) {
  const raw = String(amount ?? '').trim();
  const normalized = raw.includes(',') && !raw.includes('.') ? raw.replace(/,/g, '.') : raw;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return raw;
  return (Math.trunc(n * 100) / 100).toFixed(2);
}

module.exports = { formatSolAmount };

