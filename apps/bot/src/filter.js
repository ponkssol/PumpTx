const log = require('./logger');

const cooldownMs = Number(process.env.COOLDOWN_MS || 10000);
/** @type {Map<string, number>} */
const lastByMint = new Map();

const cooldownLog = log.createCountSummarizer(15000, (c) => `Skipped ${c} BUY(s) on per-mint cooldown`);

/**
 * @param {{ tokenMint: string, solSpent: number }} buyData
 * @returns {boolean}
 */
function shouldNotify(buyData) {
  if (!buyData) return false;
  const now = Date.now();
  const prev = lastByMint.get(buyData.tokenMint) || 0;
  if (now - prev < cooldownMs) {
    cooldownLog.bump();
    return false;
  }
  lastByMint.set(buyData.tokenMint, now);
  return true;
}

module.exports = { shouldNotify };
