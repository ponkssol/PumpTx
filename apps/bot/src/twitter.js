const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const KEY = process.env.TWITTER_API_IO_KEY;
const BASE = (process.env.TWITTERAPI_IO_BASE_URL || 'https://api.twitterapi.io').replace(/\/$/, '');

/**
 * @param {object} buyData
 * @param {string|null} imagePath
 */
async function tweet(buyData, imagePath) {
  if (!KEY) throw new Error('TWITTER_API_IO_KEY missing');
  const detailUrl = `${(process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '')}/tx/${buyData.signature}`;
  const text = [
    '🚀 New BUY on #PumpFun!',
    '',
    `🪙 ${buyData.tokenName} (${buyData.tokenSymbol})`,
    `💰 ${buyData.solSpent} SOL`,
    `📊 MC: $${buyData.marketCapUsd}`,
    '',
    `🔗 ${detailUrl}`,
    '',
    '#Solana #PumpTx #Crypto',
  ].join('\n');

  const postOnce = async () => {
    /** @type {string[]} */
    const mediaIds = [];
    if (imagePath && fs.existsSync(imagePath)) {
      const fd = new FormData();
      fd.append('file', fs.createReadStream(imagePath));
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
