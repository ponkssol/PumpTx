const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

/**
 * @param {object} buyData
 * @param {string|null} imagePath
 */
async function notify(buyData, imagePath) {
  if (!bot || !chatId) throw new Error('Telegram not configured');
  const base = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const detailUrl = `${base}/tx/${buyData.signature}`;
  const cap = [
    '🚀 <b>PUMPTX — BUY DETECTED</b>',
    '',
    `🪙 <b>${buyData.tokenName}</b> (<code>${buyData.tokenSymbol}</code>)`,
    `💰 <b>SOL:</b> <code>${buyData.solSpent} SOL</code>`,
    `📊 <b>MC:</b> <code>$${buyData.marketCapUsd}</code>`,
    `👛 <b>Buyer:</b> <code>${buyData.buyerWalletShort}</code>`,
    `🕐 ${buyData.timestamp}`,
    '',
    `🔗 <a href="${buyData.pumpFunUrl}">PumpFun</a> | <a href="${buyData.solscanUrl}">Solscan</a> | <a href="${detailUrl}">PumpTx Detail</a>`,
    '',
    '<i>powered by PumpTx</i>',
  ].join('\n');
  if (imagePath && fs.existsSync(imagePath)) {
    await bot.sendPhoto(chatId, fs.createReadStream(imagePath), { caption: cap, parse_mode: 'HTML' });
  } else {
    await bot.sendMessage(chatId, cap, { parse_mode: 'HTML', disable_web_page_preview: false });
  }
}

module.exports = { notify };
