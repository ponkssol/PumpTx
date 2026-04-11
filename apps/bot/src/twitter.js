const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { formatMarketCapUsd } = require('./format-mc');

const KEY = process.env.TWITTER_API_IO_KEY;
const BASE = (process.env.TWITTERAPI_IO_BASE_URL || 'https://api.twitterapi.io').replace(/\/$/, '');

/**
 * @param {object} buyData
 * @param {string|Buffer|null} imagePathOrBuffer — filesystem path or in-memory PNG.
 */
async function tweet(buyData, imagePathOrBuffer) {
  if (!KEY) throw new Error('TWITTER_API_IO_KEY missing');
  const detailUrl = `${(process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '')}/tx/${buyData.signature}`;
  const text = [
    '🚀 New BUY on #PumpFun!',
    '',
    `🪙 ${buyData.tokenName} (${buyData.tokenSymbol})`,
    `💰 ${buyData.solSpent} SOL`,
    `📊 MC: ${formatMarketCapUsd(buyData.marketCapUsd)}`,
    `📈 24h vol: ${formatMarketCapUsd(buyData.volumeUsd24h ?? 0)}`,
    `💎 FDV: ${formatMarketCapUsd(buyData.fdvUsd ?? 0)}`,
    '',
    `🔗 ${detailUrl}`,
    '',
    '#Solana #PumpTx #Crypto',
  ].join('\n');

  const postOnce = async () => {
    /** @type {string[]} */
    const mediaIds = [];
    if (Buffer.isBuffer(imagePathOrBuffer) && imagePathOrBuffer.length) {
      const fd = new FormData();
      fd.append('file', imagePathOrBuffer, { filename: 'pumptx.png', contentType: 'image/png' });
      const up = await axios.post(`${BASE}/twitter/upload/media`, fd, {
        headers: { ...fd.getHeaders(), 'X-API-Key': KEY },
        maxBodyLength: Infinity,
      });
      const id = up.data?.media_id || up.data?.data?.media_id || up.data?.id;
      if (id) mediaIds.push(String(id));
    } else if (imagePathOrBuffer && typeof imagePathOrBuffer === 'string' && fs.existsSync(imagePathOrBuffer)) {
      const fd = new FormData();
      fd.append('file', fs.createReadStream(imagePathOrBuffer));
      const up = await axios.post(`${BASE}/twitter/upload/media`, fd, {
        headers: { ...fd.getHeaders(), 'X-API-Key': KEY },
        maxBodyLength: Infinity,
      });
      const id = up.data?.media_id || up.data?.data?.media_id || up.data?.id;
      if (id) mediaIds.push(String(id));
    }
    const body = mediaIds.length ? { text, media: { media_ids: mediaIds } } : { text };
    await axios.post(`${BASE}/twitter/tweet`, body, {
      headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    });
  };

  try {
    await postOnce();
  } catch (e) {
    await new Promise((r) => setTimeout(r, 2000));
    await postOnce();
  }
}

module.exports = { tweet };
