const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { formatMarketCapUsd } = require('./format-mc');

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

const AUTHOR_GITHUB_URL = 'https://github.com/ponkssol';

/** @param {string} s */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {object} buyData
 * @param {string|Buffer|null} imagePathOrBuffer — filesystem path or in-memory PNG (no disk).
 */
async function notify(buyData, imagePathOrBuffer) {
  if (!bot || !chatId) throw new Error('Telegram not configured');
  const base = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const detailUrl = `${base}/tx/${buyData.signature}`;
  const mint = buyData.tokenMint || '';
  const cap = [
    '🚀 <b>PUMPTX — BUY DETECTED</b>',
    '',
    `🪙 <b>${escHtml(buyData.tokenName)}</b> (<code>${escHtml(buyData.tokenSymbol)}</code>)`,
    `💰 <b>SOL:</b> <code>${escHtml(String(buyData.solSpent))} SOL</code>`,
    `📊 <b>MC:</b> <code>${escHtml(formatMarketCapUsd(buyData.marketCapUsd))}</code>`,
    `📈 <b>24h vol:</b> <code>${escHtml(formatMarketCapUsd(buyData.volumeUsd24h ?? 0))}</code>`,
    `💎 <b>FDV:</b> <code>${escHtml(formatMarketCapUsd(buyData.fdvUsd ?? 0))}</code>`,
    `📋 <b>CA:</b> <code>${escHtml(mint)}</code>`,
    `👛 <b>Buyer:</b> <code>${escHtml(buyData.buyerWallet || buyData.buyerWalletShort || '')}</code>`,
    `🕐 ${buyData.timestamp}`,
    '',
    `🔗 <a href="${buyData.pumpFunUrl}">PumpFun</a> | <a href="${buyData.solscanUrl}">Solscan</a> | <a href="${detailUrl}">PumpTx Detail</a>`,
    '',
    `<i>powered by PumpTx · by <a href="${AUTHOR_GITHUB_URL}">ponks</a></i>`,
  ].join('\n');
  if (Buffer.isBuffer(imagePathOrBuffer) && imagePathOrBuffer.length) {
    await bot.sendPhoto(chatId, imagePathOrBuffer, { caption: cap, parse_mode: 'HTML' });
  } else if (imagePathOrBuffer && typeof imagePathOrBuffer === 'string' && fs.existsSync(imagePathOrBuffer)) {
    await bot.sendPhoto(chatId, fs.createReadStream(imagePathOrBuffer), { caption: cap, parse_mode: 'HTML' });
  } else {
    await bot.sendMessage(chatId, cap, { parse_mode: 'HTML', disable_web_page_preview: false });
  }
}

module.exports = { notify };
