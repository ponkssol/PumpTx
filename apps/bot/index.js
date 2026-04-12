require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const express = require('express');
const log = require('./src/logger');
const { initDb, saveTx, updateStats, updateTweetStatus, updateTelegramStatus } = require('./src/db');
const { parseBuyTx } = require('./src/parser');
const { shouldNotify } = require('./src/filter');
const { generateImage } = require('./src/image-generator');
const { notify } = require('./src/telegram');
const { notifyDiscord, isDiscordWebhookEnabled } = require('./src/discord');
const { tweet } = require('./src/twitter');
const { startListener } = require('./src/listener');
const { enrichPumpMetadata } = require('./src/token-meta');

const banner = `
██████╗ ██╗   ██╗███╗   ███╗██████╗ ████████╗██╗  ██╗
██╔══██╗██║   ██║████╗ ████║██╔══██╗╚══██╔══╝╚██╗██╔╝
██████╔╝██║   ██║██╔████╔██║██████╔╝   ██║    ╚███╔╝
██╔═══╝ ██║   ██║██║╚██╔╝██║██╔═══╝    ██║    ██╔██╗
██║     ╚██████╔╝██║ ╚═╝ ██║██║        ██║   ██╔╝ ██╗
╚═╝      ╚═════╝ ╚═╝     ╚═╝╚═╝        ╚═╝   ╚═╝  ╚═╝
PumpTx v1.0.0 — PumpFun Buy Monitor + Dashboard
`;

/** @returns {string[]} */
function requiredEnv() {
  return [
    'SOLANA_RPC_HTTPS', 'SOLANA_RPC_WSS', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
    'TWITTER_API_IO_KEY', 'TWITTER_BASE_URL', 'NEXT_PUBLIC_BASE_URL', 'BOT_PORT', 'MIN_BUY_SOL', 'COOLDOWN_MS', 'BOT_BASE_URL',
  ];
}

function validateEnv() {
  const miss = requiredEnv().filter((k) => !process.env[k]);
  if (miss.length) {
    log.error(`Missing env: ${miss.join(', ')}`);
    process.exit(1);
  }
}

/**
 * End-to-end handler for a fetched PumpFun transaction.
 * @param {import('@solana/web3.js').VersionedTransactionResponse} raw
 */
async function onBuy(raw) {
  const buy = parseBuyTx(raw);
  if (!buy) return;
  if (!shouldNotify(buy)) return;
  let row = buy;
  try {
    row = await enrichPumpMetadata(buy);
  } catch (e) {
    log.warn(`Metadata enrich failed: ${e.message}`);
  }
  let imgPath = null;
  let imgUrl = null;
  /** @type {Buffer|null} */
  let imgBuffer = null;
  const shareImageMemory =
    String(process.env.PUMPTX_SHARE_IMAGE_MODE || 'disk').toLowerCase() === 'memory';
  try {
    const g = await generateImage(row, { persistToDisk: !shareImageMemory });
    imgPath = g.filePath;
    imgUrl = g.imageUrl;
    imgBuffer = g.buffer;
  } catch (e) {
    log.warn(`Image generation failed: ${e.message}`);
  }
  try {
    saveTx(row, imgUrl, imgPath);
    updateStats(row.solSpent);
  } catch (e) {
    log.error(`DB save failed: ${e.message}`);
  }
  await Promise.all([
    (async () => {
      try {
        await notify(row, imgBuffer || imgPath);
        updateTelegramStatus(row.signature, 1);
      } catch (e) {
        log.error(`Telegram failed: ${e.message}`);
        try { updateTelegramStatus(row.signature, 0); } catch (_) { /* ignore */ }
      }
    })(),
    (async () => {
      try {
        const { posted } = await tweet(row, imgBuffer || imgPath);
        if (posted) updateTweetStatus(row.signature, 1);
      } catch (e) {
        log.error(`Twitter failed: ${e.message}`);
        try { updateTweetStatus(row.signature, 0); } catch (_) { /* ignore */ }
      }
    })(),
    (async () => {
      try {
        await notifyDiscord(row, imgBuffer || imgPath, imgUrl);
      } catch (e) {
        log.error(`Discord failed: ${e.message}`);
      }
    })(),
  ]);
}

/** Bootstraps env validation, DB, static server, and listener lifecycle hooks. */
async function main() {
  console.log(banner);
  validateEnv();
  if (isDiscordWebhookEnabled()) {
    log.info('Discord webhook: enabled (BUY alerts will post to Discord)');
  }
  initDb();
  if (String(process.env.PUMPTX_SHARE_IMAGE_MODE || 'disk').toLowerCase() === 'memory') {
    log.info('Share card: PUMPTX_SHARE_IMAGE_MODE=memory (PNG not written to disk; DB image_url empty)');
  }
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));
  const port = Number(process.env.BOT_PORT);
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, () => {
      log.info(`Static + generated images on :${port}`);
      resolve(s);
    });
    s.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        log.error(`Port ${port} is already in use. Stop the other process (or prior bot) or change BOT_PORT in .env`);
      } else {
        log.error(err.message || String(err));
      }
      reject(err);
    });
  });
  const stop = await startListener(onBuy);
  const shutdown = async () => {
    log.warn('Shutting down...');
    await stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  if (!e || e.code !== 'EADDRINUSE') {
    log.error(e && e.message ? e.message : String(e));
  }
  process.exit(1);
});
