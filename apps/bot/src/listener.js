const { Connection, PublicKey } = require('@solana/web3.js');
const log = require('./logger');

const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const MAX_RETRIES = 10;
const RECONNECT_MS = 5000;
const RPC_QUEUE_CAP = Number(process.env.RPC_QUEUE_CAP || '80');
const RATE_LIMIT_BACKOFF_MS = Number(process.env.RPC_429_BACKOFF_MS || '2500');
/** Drop duplicate log signatures across parallel websockets (ms). */
const WSS_LOG_DEDUPE_MS = Number(process.env.WSS_LOG_DEDUPE_MS || '45000');

/** @returns {string[]} */
function parseSolanaHttpsPool() {
  const raw = (process.env.SOLANA_RPC_HTTPS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** @returns {string[]} */
function parseSolanaWssPool() {
  const raw = (process.env.SOLANA_RPC_WSS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {(raw: import('@solana/web3.js').VersionedTransactionResponse) => Promise<void>} onBuy
 * @returns {Promise<() => Promise<void>>}
 */
async function startListener(onBuy) {
  const httpsPool = parseSolanaHttpsPool();
  if (!httpsPool.length) {
    log.error('SOLANA_RPC_HTTPS must contain at least one URL');
    return async () => {};
  }

  const wssPool = parseSolanaWssPool();
  if (!wssPool.length) {
    log.error('SOLANA_RPC_WSS must contain at least one URL');
    return async () => {};
  }

  const poolN = httpsPool.length;
  /** Helius Free ≈10 RPS per API key; spread getTransaction across keys (~7/s each headroom). */
  const RPC_GAP_MS = Number(
    process.env.RPC_MIN_INTERVAL_MS || String(Math.ceil(1000 / (7 * poolN))),
  );

  let retries = 0;
  let loggedPoolHint = false;
  /** @type {Connection[]} */
  let httpPool = [];
  /** @type {Connection|null} */
  let conn = null;
  /** Active onLogs subscriptions (multi-WSS = one per connection). */
  /** @type {{ conn: Connection, id: number }[]} */
  let subscriptions = [];
  /** @type {ReturnType<typeof setInterval>|null} */
  let health = null;
  let stopped = false;
  /** @type {Set<string>} */
  const pendingSigs = new Set();
  /** Dedupe identical Pump log events from multiple websocket keys. */
  /** @type {Map<string, number>} */
  const recentLogSig = new Map();
  /** @type {Promise<void>} */
  let rpcChain = Promise.resolve();
  let rr = 0;

  function isDuplicateLogSignature(signature) {
    const now = Date.now();
    const prev = recentLogSig.get(signature);
    if (prev != null && now - prev < WSS_LOG_DEDUPE_MS) return true;
    recentLogSig.set(signature, now);
    if (recentLogSig.size > 8000) {
      const cutoff = now - WSS_LOG_DEDUPE_MS;
      for (const [k, t] of recentLogSig) {
        if (t < cutoff) recentLogSig.delete(k);
      }
    }
    return false;
  }

  /**
   * Serializes getTransaction with RPC_GAP_MS spacing; rotates across HTTP pool.
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
        if (stopped || !httpPool.length) return;
        const c = httpPool[rr % httpPool.length];
        rr += 1;
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

  function onPumpLog(l) {
    try {
      if (!l.logs.some((x) => x.includes('Buy'))) return;
      const sig = l.signature;
      if (isDuplicateLogSignature(sig)) return;
      queueTxFetch(sig);
    } catch (e) {
      log.listenerErr.push(e.message || String(e));
    }
  }

  const stopSub = () => {
    for (const sub of subscriptions) {
      try {
        sub.conn.removeOnLogsListener(sub.id);
      } catch (_) { /* ignore */ }
    }
    subscriptions = [];
  };

  const wire = () => {
    stopSub();
    const useMultiWs = wssPool.length > 1 && wssPool.length === httpsPool.length;

    if (wssPool.length > 1 && wssPool.length !== httpsPool.length) {
      log.warn(
        `SOLANA_RPC_WSS has ${wssPool.length} URL(s) but SOLANA_RPC_HTTPS has ${httpsPool.length} — counts must match for multi-WS; falling back to first WSS only`,
      );
    }

    if (useMultiWs) {
      httpPool = httpsPool.map((endpoint, i) => new Connection(endpoint, {
        commitment: 'confirmed',
        wsEndpoint: wssPool[i],
      }));
    } else {
      const primaryWss = wssPool[0];
      httpPool = httpsPool.map((endpoint, i) => new Connection(endpoint, {
        commitment: 'confirmed',
        ...(i === 0 && primaryWss ? { wsEndpoint: primaryWss } : {}),
      }));
    }

    conn = httpPool[0] || null;
    if (!conn) return;

    if (!loggedPoolHint) {
      loggedPoolHint = true;
      const wsPart = useMultiWs
        ? `${wssPool.length} websocket log subscriptions (cross-WS dedupe ${WSS_LOG_DEDUPE_MS}ms)`
        : '1 websocket log subscription';
      log.info(
        `RPC HTTP pool: ${poolN} endpoint(s), ${wsPart}, getTransaction gap ${RPC_GAP_MS}ms (~${(1000 / RPC_GAP_MS).toFixed(1)} req/s chain)`,
      );
    }

    if (useMultiWs) {
      for (const c of httpPool) {
        const id = c.onLogs(PUMP, onPumpLog, 'confirmed');
        subscriptions.push({ conn: c, id });
      }
      log.success(`Subscribed to PumpFun logs on ${subscriptions.length} websocket(s)`);
    } else {
      const id = conn.onLogs(PUMP, onPumpLog, 'confirmed');
      subscriptions.push({ conn, id });
      log.success(`Subscribed to PumpFun logs (id ${id})`);
    }
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
    httpPool = [];
    if (health) clearInterval(health);
    stopSub();
    conn = null;
    recentLogSig.clear();
    try { await rpcChain; } catch (_) { /* ignore */ }
    log.rpcQueueSat.flush();
    log.lutUnresolved.flush();
    log.listenerErr.flush();
  };
}

module.exports = { startListener };
