const { Connection, PublicKey } = require('@solana/web3.js');
const log = require('./logger');

const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const MAX_RETRIES = 10;
const RECONNECT_MS = 5000;
/** Cap queued `getTransaction` at ≤7/s (Helius Free = 10 RPS total across all RPC). Gap = ceil(1000/7) ms. */
const RPC_GAP_MS = Number(process.env.RPC_MIN_INTERVAL_MS || String(Math.ceil(1000 / 7)));
const RPC_QUEUE_CAP = Number(process.env.RPC_QUEUE_CAP || '80');
const RATE_LIMIT_BACKOFF_MS = Number(process.env.RPC_429_BACKOFF_MS || '2500');

/**
 * @param {(raw: import('@solana/web3.js').VersionedTransactionResponse) => Promise<void>} onBuy
 * @returns {Promise<() => Promise<void>>}
 */
async function startListener(onBuy) {
  let retries = 0;
  /** @type {Connection|null} */
  let conn = null;
  const connRef = { current: /** @type {Connection|null} */ (null) };
  /** @type {number|null} */
  let subId = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let health = null;
  let stopped = false;
  /** @type {Set<string>} */
  const pendingSigs = new Set();
  /** @type {Promise<void>} */
  let rpcChain = Promise.resolve();

  /**
   * Serializes getTransaction calls to respect Helius Free (~10 RPS total RPC budget).
   * @param {string} signature
   */
  function queueTxFetch(signature) {
    if (pendingSigs.has(signature)) return;
    if (pendingSigs.size >= RPC_QUEUE_CAP) {
      log.rpcQueueSat.bump();
      return;
    }
    pendingSigs.add(signature);
    rpcChain = rpcChain.then(async () => {
      try {
        await new Promise((r) => setTimeout(r, RPC_GAP_MS));
        const c = connRef.current;
        if (!c || stopped) return;
        const raw = await c.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        });
        if (raw) await onBuy(raw);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (/429|Too Many Requests/i.test(msg)) {
          await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
        }
        if (/address table lookups were not resolved/i.test(msg)) {
          log.lutUnresolved.bump();
        } else {
          log.listenerErr.push(msg);
        }
      } finally {
        pendingSigs.delete(signature);
      }
    });
  }

  const stopSub = () => {
    try {
      if (conn && subId != null) conn.removeOnLogsListener(subId);
    } catch (_) { /* ignore */ }
    subId = null;
  };

  const wire = () => {
    stopSub();
    conn = new Connection(process.env.SOLANA_RPC_HTTPS, {
      commitment: 'confirmed',
      wsEndpoint: process.env.SOLANA_RPC_WSS,
    });
    connRef.current = conn;
    subId = conn.onLogs(
      PUMP,
      (l) => {
        try {
          if (!l.logs.some((x) => x.includes('Buy'))) return;
          queueTxFetch(l.signature);
        } catch (e) {
          log.listenerErr.push(e.message || String(e));
        }
      },
      'confirmed',
    );
    log.success(`Subscribed to PumpFun logs (id ${subId})`);
    retries = 0;
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    retries += 1;
    if (retries > MAX_RETRIES) {
      log.error('Max WS reconnect retries reached');
      return;
    }
    log.warn(`Reconnecting listener in ${RECONNECT_MS}ms (${retries}/${MAX_RETRIES})`);
    setTimeout(() => {
      if (stopped) return;
      try { wire(); } catch (e) { log.error(e.message); scheduleReconnect(); }
    }, RECONNECT_MS);
  };

  wire();

  health = setInterval(async () => {
    if (stopped || !conn) return;
    try {
      await conn.getSlot('processed');
    } catch (e) {
      log.warn(`Health check failed: ${e.message}`);
      scheduleReconnect();
    }
  }, 30000);

  return async () => {
    stopped = true;
    connRef.current = null;
    if (health) clearInterval(health);
    stopSub();
    conn = null;
    try { await rpcChain; } catch (_) { /* ignore */ }
    log.rpcQueueSat.flush();
    log.lutUnresolved.flush();
    log.listenerErr.flush();
  };
}

module.exports = { startListener };
