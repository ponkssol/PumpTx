const { formatMarketCapUsd } = require('./format-mc');
const { formatSolAmount } = require('./format-sol');

const AUTHOR_GITHUB_URL = 'https://github.com/ponkssol';

/** X post body must stay under ~280 characters (API error 186). */
const CHAR_MAX = Number(1000);

/** @param {string} s @param {number} max */
function trunc(s, max) {
  const t = String(s);
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * Same structure as Telegram caption (see `telegram.js`), plain text for Twitter.
 * @param {object} o
 * @param {string} o.name
 * @param {string} o.sym
 * @param {string} o.mint
 * @param {string} o.buyer
 * @param {string} o.linkRow
 * @param {boolean} o.withFooter
 * @param {object} buyData
 */
function buildPumptxBuyPlainBlock(o, buyData) {
  const parts = [
    '🚀 PUMPTX — BUY DETECTED',
    '',
    `🏛️ ${o.name} ( ${o.sym} )`,
    `💰 SOL: ${formatSolAmount(buyData.solSpent)} SOL`,
    `📊 MC: ${formatMarketCapUsd(buyData.marketCapUsd)}`,
    `📈 24h vol: ${formatMarketCapUsd(buyData.volumeUsd24h ?? 0)}`,
    `💎 FDV: ${formatMarketCapUsd(buyData.fdvUsd ?? 0)}`,
    `📋 CA: ${o.mint}`,
    `👛 Buyer: ${o.buyer}`,
    `🕒 ${buyData.timestamp}`,
    '',
    o.linkRow,
  ];
  if (o.withFooter) {
    parts.push('');
    parts.push(`powered by PumpTx · by ponks ${AUTHOR_GITHUB_URL}`);
  }
  return parts.join('\n');
}

/**
 * Same labels as full block but MC / 24h vol / FDV on one line (fits Solana tx URLs on X).
 * @param {object} o
 * @param {object} buyData
 */
function buildPumptxBuyCompactPlainBlock(o, buyData) {
  const statsLine = `📊 MC: ${formatMarketCapUsd(buyData.marketCapUsd)}`;
  const parts = [
    '🚀 PUMPTX — BUY DETECTED',
    '',
    `🏛️ ${o.name} ( ${o.sym} )`,
    `💰 SOL: ${formatSolAmount(buyData.solSpent)} SOL`,
    statsLine,
    `📋 CA: ${o.mint}`,
    `👛 Buyer: ${o.buyer}`,
    `🕒 ${buyData.timestamp}`,
    '',
    o.linkRow,
  ];
  if (o.withFooter) {
    parts.push('');
    parts.push(`powered by PumpTx · by ponks ${AUTHOR_GITHUB_URL}`);
  }
  return parts.join('\n');
}

/**
 * Last resort under X length cap: compact stats, optional no buyer row, short link prefix.
 * @param {object} o
 * @param {object} buyData
 * @param {{ includeBuyer: boolean, tsMax: number, statsStyle?: 'full'|'mini' }} opts
 */
function buildPumptxBuyMicroPlainBlock(o, buyData, opts) {
  const statsLine =
    opts.statsStyle === 'mini'
      ? `📊 ${formatMarketCapUsd(buyData.marketCapUsd)}`
      : `📊 MC: ${formatMarketCapUsd(buyData.marketCapUsd)}`;
  const ts = trunc(String(buyData.timestamp || ''), opts.tsMax);
  const parts = [
    '🚀 PUMPTX — BUY DETECTED',
    '',
    `🏛️ ${o.name} ( ${o.sym} )`,
    `💰 SOL: ${formatSolAmount(buyData.solSpent)} SOL`,
    statsLine,
    `📋 CA: ${o.mint}`,
  ];
  if (opts.includeBuyer) parts.push(`👛 Buyer: ${o.buyer}`);
  parts.push(`🕒 ${ts}`, '', o.linkRow);
  return parts.join('\n');
}

/**
 * Telegram-style BUY card in plain text (for X). Tiers shrink labels/CA/buyer/links until under CHAR_MAX.
 * @param {object} buyData
 * @returns {string}
 */
function buildTwitterSafePlainText(buyData) {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const t = Number(buyData.blockTimeMs || buyData.blockTime || buyData.timestampMs || Date.now());
  const detailUrl = `${base}/tx/${buyData.signature}?t=${encodeURIComponent(String(t))}`;
  const mintFull = String(buyData.tokenMint || '');
  const name = String(buyData.tokenName || '');
  const sym = String(buyData.tokenSymbol || '???').trim();
  const buyerFull = String(buyData.buyerWallet || buyData.buyerWalletShort || '');

  const statsLine = `📊 ${formatMarketCapUsd(buyData.marketCapUsd)}`;
  return [
    '🚀 PUMPTX — BUY DETECTED\n', 
    `🏛️ ${name} ( $${sym} )`,
    `💰 ${formatSolAmount(buyData.solSpent)} SOL`,
    `📋 CA: ${mintFull}`,
    `👛 Buyer: ${buyerFull}`,
    detailUrl,
  ].join('\n');
}

/**
 * Plain-text BUY alert matching Telegram (`telegram.js`) content order, for Twitter / APIs.
 * @param {object} buyData
 * @returns {string}
 */
function buildTelegramStylePlainText(buyData) {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const detailUrl = `${base}/tx/${buyData.signature}`;
  const mint = buyData.tokenMint || '';
  const lines = [
    '🚀 PUMPTX — BUY DETECTED',
    '',
    `🏛️ ${buyData.tokenName} ( ${buyData.tokenSymbol} )`,
    `💰 SOL: ${formatSolAmount(buyData.solSpent)} SOL`,
    `📊 MC: ${formatMarketCapUsd(buyData.marketCapUsd)}`,
    `📋 CA: ${mint}`,
    `👛 Buyer: ${buyData.buyerWallet}`,
    `🕒 ${buyData.timestamp}`,
    '',
    `🔗 PumpFun: ${buyData.pumpFunUrl} | Solscan: ${buyData.solscanUrl} | PumpTx Detail: ${detailUrl}`,
    '',
    `powered by PumpTx · by ponks ${AUTHOR_GITHUB_URL}`,
  ];
  return lines.join('\n');
}

/** Approximate X weighted length (for diagnostics). */
function twitterWeightedLength(text) {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) n += 2;
    else if (cp >= 0x2600 && cp <= 0x27bf) n += 2;
    else if (cp >= 0xfe00 && cp <= 0xfe0f) n += 0;
    else if (cp >= 0x1f300 && cp <= 0x1faf6) n += 2;
    else n += 1;
  }
  return n;
}

module.exports = { buildTelegramStylePlainText, buildTwitterSafePlainText, twitterWeightedLength };
