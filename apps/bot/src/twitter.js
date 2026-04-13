const axios = require('axios');
const log = require('./logger');
const { buildTwitterSafePlainText } = require('./buy-alert-text');
const { getTwitterLoginCookies, saveTwitterLoginCookies } = require('./twitter-cookies-store');

const MIN_SOL = Number(process.env.TWITTER_ALERT_MIN_SOL || 5);
/** @param {unknown} v */
function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}

function twitterHeaders() {
  const key = process.env.TWITTER_API_IO_KEY;
  if (!key) throw new Error('TWITTER_API_IO_KEY missing');
  return {
    'Content-Type': 'application/json',
    'X-API-Key': key,
  };
}

function twitterBaseUrl() {
  const u = (process.env.TWITTER_BASE_URL || '').trim().replace(/\/$/, '');
  if (!u) throw new Error('TWITTER_BASE_URL missing');
  return u;
}

/**
 * @param {unknown} data
 */
function isApiSuccess(data) {
  return Boolean(data && typeof data === 'object' && String(data.status || '').toLowerCase() === 'success');
}

/**
 * @param {string} tweetText
 * @param {string} loginCookies
 */
async function createTweetV2(tweetText, loginCookies) {
  const url = `${twitterBaseUrl()}/create_tweet_v2`;
  const bodyText = String(tweetText);
  if (bodyText.length > 280) {
    log.warn(`Twitter tweet length ${bodyText.length} > 280; API may reject`);
  }
  const res = await axios.post(
    url,
    {
      login_cookies: loginCookies,
      tweet_text: bodyText,
      proxy: process.env.TWITTER_PROXY_URL || '',
      is_note_tweet: true,
    },
    {
      headers: twitterHeaders(),
      validateStatus: () => true,
      timeout: Number(process.env.TWITTER_HTTP_TIMEOUT_MS || 60000),
    },
  );
  return { httpStatus: res.status, data: res.data };
}

async function userLoginV2() {
  const user = (process.env.TWITTER_USERNAME || '').trim();
  const email = (process.env.TWITTER_EMAIL || '').trim();
  const password = (process.env.TWITTER_PASSWORD || '').trim();
  if (!user || !email || !password) {
    throw new Error('TWITTER_USERNAME, TWITTER_EMAIL, and TWITTER_PASSWORD are required for user_login_v2');
  }
  const url = `${twitterBaseUrl()}/user_login_v2`;
  const totp = (process.env.TWITTER_TOTP || process.env.TWITTER_TOTP_SECRET || '').trim();
  const res = await axios.post(
    url,
    {
      user_name: user,
      email,
      password,
      proxy: process.env.TWITTER_PROXY_URL || '',
      totp_secret: totp,
    },
    {
      headers: twitterHeaders(),
      validateStatus: () => true,
      timeout: Number(process.env.TWITTER_HTTP_TIMEOUT_MS || 120000),
    },
  );
  const { data, status } = res;
  if (status >= 200 && status < 300 && isApiSuccess(data) && data.login_cookies) {
    saveTwitterLoginCookies(String(data.login_cookies));
    log.info('Twitter user_login_v2: cookies refreshed');
    return;
  }
  throw new Error(`Twitter user_login_v2 failed: http=${status} body=${safeJson(data)}`);
}

/**
 * Posts to Twitter only for buys >= MIN_SOL (default 5). Text + link only (OG preview from URL).
 * @param {object} buyData
 * @param {string|Buffer|null} _imagePathOrBuffer — ignored (no media upload).
 * @returns {Promise<{ posted: boolean }>}
 */
async function tweet(buyData, _imagePathOrBuffer) {
  if (!buyData || Number(buyData.solSpent) < MIN_SOL) {
    return { posted: false };
  }

  const tweetText = buildTwitterSafePlainText(buyData);

  let cookies = getTwitterLoginCookies();
  if (!cookies) {
    await userLoginV2();
    cookies = getTwitterLoginCookies();
  }

  const runCreate = async () => {
    const c = getTwitterLoginCookies();
    if (!c) throw new Error('Twitter login cookies missing after login');
    return createTweetV2(tweetText, c);
  };

  let first;
  try {
    first = await runCreate();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    log.warn(`Twitter create_tweet_v2 request error: ${msg}`);
    await userLoginV2();
    const second = await runCreate();
    if (!(second.httpStatus >= 200 && second.httpStatus < 300 && isApiSuccess(second.data))) {
      throw new Error(`Twitter create_tweet_v2 failed after login: http=${second.httpStatus} body=${safeJson(second.data)}`);
    }
    return { posted: true };
  }

  if (first.httpStatus >= 200 && first.httpStatus < 300 && isApiSuccess(first.data)) {
    return { posted: true };
  }

  log.warn(`Twitter create_tweet_v2 failed: http=${first.httpStatus} body=${safeJson(first.data)}`);
  await userLoginV2();
  const retry = await runCreate();
  if (!(retry.httpStatus >= 200 && retry.httpStatus < 300 && isApiSuccess(retry.data))) {
    throw new Error(`Twitter create_tweet_v2 failed after re-login: http=${retry.httpStatus} body=${safeJson(retry.data)}`);
  }
  return { posted: true };
}

module.exports = { tweet };
