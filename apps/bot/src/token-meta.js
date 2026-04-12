const log = require('./logger');

const metaMiss = log.createCountSummarizer(
  20000,
  (c) => `Token metadata unavailable ${c} time(s) (Jupiter/DexScreener); SYM/MC use parser defaults until APIs respond.`,
);

const JUPITER_SEARCH = 'https://lite-api.jup.ag/tokens/v2/search';
const DEXSCREENER_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens';
const DEFAULT_TIMEOUT_MS = Number(process.env.METADATA_FETCH_MS || '4000');

/**
 * @param {string | undefined} s
 * @param {number} max
 */
function clip(s, max) {
  if (!s || typeof s !== 'string') return '';
  const t = s.trim();
  if (!t) return '';
  return t.length <= max ? t : t.slice(0, max);
}

/**
 * @param {unknown} u
 * @returns {string|null}
 */
function safeIconUrl(u) {
  if (!u || typeof u !== 'string') return null;
  const t = u.trim();
  if (!t || t.length > 2048) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

/**
 * Jupiter stats24h buy/sell USD (for Twitter-style split lines).
 * @param {any} row
 * @returns {{ buy: number, sell: number, total: number }}
 */
function jupiterBuySellVolumeUsd(row) {
  const s = row && row.stats24h;
  if (!s || typeof s !== 'object') return { buy: 0, sell: 0, total: 0 };
  const b = Number(s.buyVolume);
  const sv = Number(s.sellVolume);
  const buy = Number.isFinite(b) && b > 0 ? Math.round(b) : 0;
  const sell = Number.isFinite(sv) && sv > 0 ? Math.round(sv) : 0;
  const total = buy + sell > 0 ? buy + sell : 0;
  return { buy, sell, total };
}

/** 24h USD-ish volume from Jupiter stats24h (buy + sell legs). */
function jupiter24hVolumeUsd(row) {
  const { total } = jupiterBuySellVolumeUsd(row);
  return total;
}

/** @param {number|undefined|null} x */
function roundUsd(x) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<any|null>}
 */
async function fetchJson(url, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {string} mint
 * @param {number} timeoutMs
 * @returns {Promise<{ tokenName: string, tokenSymbol: string, marketCapUsd: number, volumeUsd24h: number, volumeBuyUsd24h: number, volumeSellUsd24h: number, fdvUsd: number, tokenIconUrl: string|null }|null>}
 */
async function fromJupiter(mint, timeoutMs) {
  const data = await fetchJson(`${JUPITER_SEARCH}?query=${encodeURIComponent(mint)}`, timeoutMs);
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data.find((x) => x && x.id === mint) || null;
  if (!row) return null;
  const mcap = Number(row.mcap ?? row.fdv ?? 0);
  const name = clip(row.name, 80);
  const symbol = clip(row.symbol, 24);
  if (!name && !symbol) return null;
  const iconRaw = row.icon || row.logoURI || row.image || row.logo;
  const vol24 = jupiterBuySellVolumeUsd(row);
  return {
    tokenName: name || mint.slice(0, 8),
    tokenSymbol: symbol || '???',
    marketCapUsd: Number.isFinite(mcap) && mcap > 0 ? Math.round(mcap) : 0,
    volumeUsd24h: vol24.total,
    volumeBuyUsd24h: vol24.buy,
    volumeSellUsd24h: vol24.sell,
    fdvUsd: roundUsd(row.fdv),
    tokenIconUrl: safeIconUrl(iconRaw),
  };
}

/**
 * @param {string} mint
 * @param {number} timeoutMs
 * @returns {Promise<{ tokenName: string, tokenSymbol: string, marketCapUsd: number, volumeUsd24h: number, fdvUsd: number, liquidityUsd: number, tokenIconUrl: string|null }|null>}
 */
async function fromDexscreener(mint, timeoutMs) {
  const data = await fetchJson(`${DEXSCREENER_TOKENS}/${mint}`, timeoutMs);
  const pairs = data && data.pairs;
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const pumpPair = pairs.find((p) => p && p.dexId === 'pumpfun');
  const pair = pumpPair || pairs.find((p) => p.baseToken && p.baseToken.address === mint) || pairs[0];
  if (!pair) return null;
  let base = pair.baseToken;
  if (base && base.address !== mint && pair.quoteToken && pair.quoteToken.address === mint) {
    base = pair.quoteToken;
  }
  if (!base || !base.address) return null;
  const mcap = Number(pair.marketCap || pair.fdv || 0);
  const name = clip(base.name, 80);
  const symbol = clip(base.symbol, 24);
  if (!name && !symbol) return null;
  const info = pair.info && typeof pair.info === 'object' ? pair.info : null;
  const tokenIconUrl =
    safeIconUrl(base.imageUrl) ||
    safeIconUrl(info && info.imageUrl) ||
    safeIconUrl(pair.imageUrl) ||
    safeIconUrl(pair.iconUrl) ||
    null;
  let volumeUsd24h = 0;
  if (pair.volume && typeof pair.volume === 'object') {
    volumeUsd24h = roundUsd(pair.volume.h24);
  }
  const fdvUsd = roundUsd(pair.fdv);
  let liquidityUsd = 0;
  if (pair.liquidity && typeof pair.liquidity === 'object') {
    liquidityUsd = roundUsd(pair.liquidity.usd);
  }
  return {
    tokenName: name || mint.slice(0, 8),
    tokenSymbol: symbol || '???',
    marketCapUsd: Number.isFinite(mcap) && mcap > 0 ? Math.round(mcap) : 0,
    volumeUsd24h,
    fdvUsd,
    liquidityUsd,
    tokenIconUrl,
  };
}

/**
 * Fills tokenName, tokenSymbol, marketCapUsd for a parsed buy using public APIs (no API keys).
 * @param {object} buy
 * @returns {Promise<object>}
 */
async function enrichPumpMetadata(buy) {
  if (!buy || !buy.tokenMint) return buy;
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  let meta = await fromJupiter(buy.tokenMint, timeoutMs);
  const needDex =
    !meta ||
    !meta.tokenIconUrl ||
    meta.volumeUsd24h === 0 ||
    meta.fdvUsd === 0 ||
    !(Number(meta.liquidityUsd) > 0);
  let dex = null;
  if (needDex) {
    dex = await fromDexscreener(buy.tokenMint, timeoutMs);
  }
  if (meta && dex) {
    meta = {
      ...meta,
      tokenIconUrl: meta.tokenIconUrl || dex.tokenIconUrl,
      volumeUsd24h: meta.volumeUsd24h || dex.volumeUsd24h,
      fdvUsd: meta.fdvUsd || dex.fdvUsd,
      marketCapUsd: meta.marketCapUsd > 0 ? meta.marketCapUsd : dex.marketCapUsd,
      liquidityUsd: dex.liquidityUsd || meta.liquidityUsd || 0,
    };
  } else if (!meta && dex) {
    meta = dex;
  }
  if (!meta) {
    metaMiss.bump();
    return buy;
  }
  const tokenIconUrl = meta.tokenIconUrl || buy.tokenIconUrl || null;
  const volumeBuyUsd24h = Number(meta.volumeBuyUsd24h) > 0 ? meta.volumeBuyUsd24h : buy.volumeBuyUsd24h || 0;
  const volumeSellUsd24h = Number(meta.volumeSellUsd24h) > 0 ? meta.volumeSellUsd24h : buy.volumeSellUsd24h || 0;
  const liquidityUsd = Number(meta.liquidityUsd) > 0 ? meta.liquidityUsd : buy.liquidityUsd || 0;
  return {
    ...buy,
    tokenName: meta.tokenName || buy.tokenName,
    tokenSymbol: meta.tokenSymbol || buy.tokenSymbol,
    marketCapUsd: meta.marketCapUsd > 0 ? meta.marketCapUsd : buy.marketCapUsd,
    volumeUsd24h: meta.volumeUsd24h > 0 ? meta.volumeUsd24h : buy.volumeUsd24h || 0,
    fdvUsd: meta.fdvUsd > 0 ? meta.fdvUsd : buy.fdvUsd || 0,
    volumeBuyUsd24h,
    volumeSellUsd24h,
    liquidityUsd,
    tokenIconUrl,
  };
}

module.exports = { enrichPumpMetadata };
