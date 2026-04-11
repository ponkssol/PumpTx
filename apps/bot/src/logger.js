const C = { r: '\x1b[0m', c: '\x1b[36m', y: '\x1b[33m', e: '\x1b[31m', g: '\x1b[32m' };

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function line(level, color, msg) {
  console.log(`${color}[${ts()}] [PUMPTX] [${level}]${C.r} ${msg}`);
}

/** Logs an INFO line in cyan. @param {string} msg */
function info(msg) { line('INFO', C.c, msg); }
/** Logs a WARN line in yellow. @param {string} msg */
function warn(msg) { line('WARN', C.y, msg); }
/** Logs an ERROR line in red. @param {string} msg */
function error(msg) { line('ERROR', C.e, msg); }
/** Logs a SUCCESS line in green. @param {string} msg */
function success(msg) { line('SUCCESS', C.g, msg); }

/**
 * Counts events and prints one summary line per window (reduces terminal spam).
 * @param {number} windowMs
 * @param {(count: number) => string} format
 */
function createCountSummarizer(windowMs, format) {
  let n = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let t = null;
  return {
    /** @returns {void} */
    bump() {
      n += 1;
      if (t) return;
      t = setTimeout(() => {
        warn(format(n));
        n = 0;
        t = null;
      }, windowMs);
    },
    /** @returns {void} */
    flush() {
      if (t) clearTimeout(t);
      t = null;
      if (n > 0) warn(format(n));
      n = 0;
    },
  };
}

/**
 * Aggregates identical error messages into one line per window.
 * @param {number} windowMs
 */
function createErrorSummarizer(windowMs) {
  let n = 0;
  let last = '';
  /** @type {ReturnType<typeof setTimeout>|null} */
  let t = null;
  return {
    /**
     * @param {string} msg
     * @returns {void}
     */
    push(msg) {
      if (msg !== last) {
        if (t) clearTimeout(t);
        if (n > 0) error(`Listener tx error: ${last}${n > 1 ? ` (×${n})` : ''}`);
        last = msg;
        n = 0;
        t = null;
      }
      n += 1;
      if (t) return;
      t = setTimeout(() => {
        error(`Listener tx error: ${last}${n > 1 ? ` (×${n})` : ''}`);
        n = 0;
        last = '';
        t = null;
      }, windowMs);
    },
    /** @returns {void} */
    flush() {
      if (t) clearTimeout(t);
      t = null;
      if (n > 0) error(`Listener tx error: ${last}${n > 1 ? ` (×${n})` : ''}`);
      n = 0;
      last = '';
    },
  };
}

const rpcQueueSat = createCountSummarizer(10000, (c) => `RPC queue saturated — skipped ${c} fetch(es). Tune RPC_QUEUE_CAP / RPC_MIN_INTERVAL_MS or upgrade RPC plan.`);
const lutUnresolved = createCountSummarizer(12000, (c) => `Skipped ${c} tx(es): address lookup tables not resolved (v0 + RPC). Common on free tier under heavy load.`);
const listenerErr = createErrorSummarizer(8000);

module.exports = {
  info,
  warn,
  error,
  success,
  createCountSummarizer,
  rpcQueueSat,
  lutUnresolved,
  listenerErr,
};
