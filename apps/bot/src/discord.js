const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { formatMarketCapUsd } = require('./format-mc');

/** Resolves webhook URL from env (read at send time so .env is always current after restart). */
function getDiscordWebhookUrl() {
  let u = (process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK || '').trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  return u;
}

/** @returns {boolean} */
function isDiscordWebhookEnabled() {
  return Boolean(getDiscordWebhookUrl());
}

/** Escape Discord subset of markdown outside code blocks. */
function escMd(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/\|/g, '\\|');
}

/** Safe inside inline code (replace backticks). */
function inlineCode(s) {
  return String(s).replace(/`/g, "'");
}

/** @param {string} s @param {number} max */
function clip(s, max) {
  const t = String(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const DESC_MAX = 4080;

/** Avoid breaking fenced code blocks in mint strings. */
function safeMintForFence(mint) {
  return String(mint).replace(/```/g, '``\u200b`');
}

/**
 * Same information order as Telegram caption (`telegram.js`), adapted for Discord markdown.
 * @param {object} buyData
 * @param {string} detailUrl
 */
function buildEmbedDescription(buyData, detailUrl) {
  const name = escMd(clip(buyData.tokenName || 'Unknown', 200));
  const sym = inlineCode(clip(buyData.tokenSymbol || '—', 40));
  const sol = inlineCode(`${String(buyData.solSpent)} SOL`);
  const mc = inlineCode(formatMarketCapUsd(buyData.marketCapUsd));
  const vol = inlineCode(formatMarketCapUsd(buyData.volumeUsd24h ?? 0));
  const fdv = inlineCode(formatMarketCapUsd(buyData.fdvUsd ?? 0));
  const buyer = inlineCode(buyData.buyerWallet || buyData.buyerWalletShort || '');
  const mintRaw = buyData.tokenMint || '';
  const ts = escMd(buyData.timestamp || '');

  /** @type {string[]} */
  const lines = [
    `🪙 **${name}** (\`${sym}\`)`,
    `💰 **SOL:** \`${sol}\``,
    `📊 **MC:** \`${mc}\``,
    `📈 **24h vol:** \`${vol}\``,
    `💎 **FDV:** \`${fdv}\``,
  ];

  if (mintRaw.length <= 72) {
    lines.push(`📋 **CA:** \`${inlineCode(mintRaw)}\``);
  } else {
    lines.push('📋 **CA:**', '```', safeMintForFence(mintRaw), '```');
  }

  lines.push(`👛 **Buyer:** \`${buyer}\``, `🕐 ${ts}`, '');
  lines.push(
    `🔗 [PumpFun](${buyData.pumpFunUrl}) | [Solscan](${buyData.solscanUrl}) | [PumpTx Detail](${detailUrl})`,
    '',
    '*powered by PumpTx*',
  );

  let out = lines.join('\n');
  if (out.length > DESC_MAX) {
    out = `${out.slice(0, DESC_MAX - 1)}…`;
  }
  return out;
}

/** @param {object} buyData */
function footerText(buyData) {
  const mint = buyData.tokenMint || '';
  if (mint.length >= 12) {
    return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  }
  return 'PumpTx';
}

/**
 * Sends a PumpTx BUY card to Discord (optional). No-op if DISCORD_WEBHOOK_URL / DISCORD_WEBHOOK is unset.
 * @param {object} buyData
 * @param {string|Buffer|null} imagePathOrBuffer
 * @param {string|null} publicImageUrl — BOT_BASE_URL card when persisted to disk
 */
async function notifyDiscord(buyData, imagePathOrBuffer, publicImageUrl) {
  const webhookUrl = getDiscordWebhookUrl();
  if (!webhookUrl) return;

  const base = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const detailUrl = `${base}/tx/${buyData.signature}`;

  /** @type {object} */
  const embed = {
    title: '🚀 PUMPTX — BUY DETECTED',
    description: buildEmbedDescription(buyData, detailUrl),
    color: 0x00ff41,
    footer: { text: footerText(buyData) },
  };

  try {
    // Prefer file upload when we have bytes or a local path (Discord cannot fetch localhost URLs).
    if (Buffer.isBuffer(imagePathOrBuffer) && imagePathOrBuffer.length) {
      embed.image = { url: 'attachment://pumptx-card.png' };
      const form = new FormData();
      form.append('payload_json', JSON.stringify({ embeds: [embed] }));
      form.append('files[0]', imagePathOrBuffer, {
        filename: 'pumptx-card.png',
        contentType: 'image/png',
      });
      await axios.post(webhookUrl, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 30000,
      });
      return;
    }

    if (imagePathOrBuffer && typeof imagePathOrBuffer === 'string' && fs.existsSync(imagePathOrBuffer)) {
      embed.image = { url: 'attachment://pumptx-card.png' };
      const form = new FormData();
      form.append('payload_json', JSON.stringify({ embeds: [embed] }));
      form.append('files[0]', fs.createReadStream(imagePathOrBuffer), {
        filename: 'pumptx-card.png',
        contentType: 'image/png',
      });
      await axios.post(webhookUrl, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 30000,
      });
      return;
    }

    if (publicImageUrl) {
      embed.image = { url: publicImageUrl };
    }

    await axios.post(webhookUrl, { embeds: [embed] }, { timeout: 15000 });
  } catch (e) {
    const msg = e && e.response && e.response.data
      ? JSON.stringify(e.response.data)
      : (e && e.message) || String(e);
    throw new Error(`Discord webhook failed: ${msg}`);
  }
}

module.exports = { notifyDiscord, isDiscordWebhookEnabled };
