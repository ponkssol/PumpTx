const { LAMPORTS_PER_SOL } = require('./load-solana-web3');

const PUMP_FUN = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const WSOL = 'So11111111111111111111111111111111111111112';

/**
 * Runtime account order: static keys, then writable ALT, then readonly ALT.
 * Matches meta.preBalances / postBalances indices (required for v0 + address lookup tables).
 * @param {import('@solana/web3.js').VersionedTransactionResponse} tx
 * @returns {string[]}
 */
function getAccountKeysB58(tx) {
  const msg = tx.transaction.message;
  if (msg.staticAccountKeys && Array.isArray(msg.staticAccountKeys)) {
    const staticB58 = msg.staticAccountKeys.map((k) => k.toBase58());
    const loaded = tx.meta && tx.meta.loadedAddresses;
    if (!loaded) return staticB58;
    const w = Array.isArray(loaded.writable) ? loaded.writable : [];
    const r = Array.isArray(loaded.readonly) ? loaded.readonly : [];
    if (w.length === 0 && r.length === 0) return staticB58;
    return [...staticB58, ...w, ...r];
  }
  if (msg.accountKeys) {
    return msg.accountKeys.map((k) => (k.pubkey ? k.pubkey : k).toBase58());
  }
  return [];
}

/**
 * @param {string} s
 * @param {number} a
 * @param {number} b
 */
function shortSig(s, a, b) {
  if (!s || s.length <= a + b) return s || '';
  return `${s.slice(0, a)}...${s.slice(-b)}`;
}

/**
 * Buyer wallet for alerts: first 4 + "...." + last 4 (e.g. xasj....Xaxm).
 * @param {string|undefined|null} wallet
 * @returns {string}
 */
function formatBuyerWalletPreview(wallet) {
  const s = String(wallet || '').trim();
  if (!s) return '';
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}....${s.slice(-4)}`;
}

/**
 * @param {import('@solana/web3.js').VersionedTransactionResponse | null} tx
 * @returns {object|null}
 */
function parseBuyTx(tx) {
  if (!tx || !tx.meta || tx.meta.err) return null;
  const sig = tx.transaction.signatures[0];
  const msg = tx.transaction.message;
  /** @type {string[]} */
  let keys = getAccountKeysB58(tx);
  const nb = (tx.meta.preBalances || []).length;
  if (keys.length !== nb) {
    if (msg.accountKeys) {
      keys = msg.accountKeys.map((k) => (k.pubkey ? k.pubkey : k).toBase58());
    }
  }
  if (!keys.length || keys.length !== nb) return null;
  const buyer = keys[0];
  const pre = tx.meta.preBalances || [];
  const post = tx.meta.postBalances || [];
  const feeLamports = tx.meta.fee || 0;
  const delta = (pre[0] || 0) - (post[0] || 0) - feeLamports;
  const solSpent = Math.max(0, Math.round((delta / LAMPORTS_PER_SOL) * 1e4) / 1e4);
  const preTok = tx.meta.preTokenBalances || [];
  const postTok = tx.meta.postTokenBalances || [];
  let mint = '';
  let tokenAmount = 0;
  for (const p of postTok) {
    if (p.mint === WSOL) continue;
    const owner = p.owner;
    if (owner !== buyer) continue;
    const preR = preTok.find((x) => x.accountIndex === p.accountIndex && x.mint === p.mint);
    const preAmt = preR ? Number(preR.uiTokenAmount.uiAmount || 0) : 0;
    const postAmt = Number(p.uiTokenAmount.uiAmount || 0);
    const d = postAmt - preAmt;
    if (d > tokenAmount) {
      tokenAmount = Math.round(d * 1e6) / 1e6;
      mint = p.mint;
    }
  }
  if (!mint) {
    const ix = msg.compiledInstructions || msg.instructions || [];
    for (const c of ix) {
      if (c.programIdIndex == null) continue;
      const pid = keys[c.programIdIndex];
      if (pid !== PUMP_FUN) continue;
      const accIdx = c.accountKeyIndexes || c.accounts || [];
      for (const ai of accIdx) {
        const cand = keys[ai];
        if (cand && cand.length >= 32 && cand.length <= 44) {
          mint = cand;
          break;
        }
      }
      if (mint) break;
    }
  }
  if (!mint) return null;
  const tokenSymbol = '???';
  const tokenName = mint.slice(0, 6);
  const bt = tx.blockTime ? new Date(tx.blockTime * 1000) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${pad(bt.getUTCDate())}/${pad(bt.getUTCMonth() + 1)}/${bt.getUTCFullYear()} ${pad(bt.getUTCHours())}:${pad(bt.getUTCMinutes())}:${pad(bt.getUTCSeconds())} UTC`;
  return {
    signature: sig,
    signatureShort: shortSig(sig, 8, 8),
    tokenMint: mint,
    tokenSymbol,
    tokenName,
    buyerWallet: buyer,
    buyerWalletShort: formatBuyerWalletPreview(buyer),
    solSpent,
    tokenAmount,
    marketCapUsd: 0,
    volumeUsd24h: 0,
    fdvUsd: 0,
    timestamp,
    pumpFunUrl: `https://pump.fun/coin/${mint}`,
    solscanUrl: `https://solscan.io/tx/${sig}`,
  };
}

module.exports = { parseBuyTx, formatBuyerWalletPreview };
