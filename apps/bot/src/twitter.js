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
  if (!data || typeof data !== 'object') return false;
  if (String(data.status || '').toLowerCase() !== 'success') return false;
  // twitterapi.io create_tweet_v2 success payload includes tweet_id.
  // Example: { status: "success", message: "post tweet success.", tweet_id: "..." }
  return Boolean(data.tweet_id);
}

/** @param {unknown} data */
function isCreateTweetAmbiguousSuccess(data) {
  if (!data || typeof data !== 'object') return false;
  if (String(data.status || '').toLowerCase() !== 'error') return false;
  const msg = String(data.message || '').toLowerCase();
  return msg.includes('could not extract tweet_id');
}

/** @param {unknown} data */
function shouldReloginForCreateTweet(data) {
  if (!data || typeof data !== 'object') return true;
  const msg = `${String(data.status || '')} ${String(data.message || '')}`.toLowerCase();
  return (
    msg.includes('login') ||
    msg.includes('auth') ||
    msg.includes('authentication') ||
    msg.includes('cookie') ||
    msg.includes('cookies') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden')
  );
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

  const runCreate = async (cookies) => createTweetV2(tweetText, cookies || '');

  let first;
  try {
    first = await runCreate(getTwitterLoginCookies());
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    log.warn(`Twitter create_tweet_v2 request error: ${msg}`);
    // Network-level errors are retried after relogin (best effort).
    await userLoginV2();
    const fresh = getTwitterLoginCookies();
    if (!fresh) throw new Error('Twitter login cookies missing after login');
    const second = await runCreate(fresh);
    if (second.httpStatus >= 200 && second.httpStatus < 300 && (isApiSuccess(second.data) || isCreateTweetAmbiguousSuccess(second.data))) {
      return { posted: true };
    }
    throw new Error(`Twitter create_tweet_v2 failed after login: http=${second.httpStatus} body=${safeJson(second.data)}`);
  }

  if (first.httpStatus >= 200 && first.httpStatus < 300 && (isApiSuccess(first.data) || isCreateTweetAmbiguousSuccess(first.data))) {
    return { posted: true };
  }

  log.warn(`Twitter create_tweet_v2 failed: http=${first.httpStatus} body=${safeJson(first.data)}`);
  if (!shouldReloginForCreateTweet(first.data)) {
    throw new Error(`Twitter create_tweet_v2 failed (no relogin): http=${first.httpStatus} body=${safeJson(first.data)}`);
  }

  await userLoginV2();
  const fresh = getTwitterLoginCookies();
  if (!fresh) throw new Error('Twitter login cookies missing after login');
  const retry = await runCreate(fresh);
  if (retry.httpStatus >= 200 && retry.httpStatus < 300 && (isApiSuccess(retry.data) || isCreateTweetAmbiguousSuccess(retry.data))) {
    return { posted: true };
  }
  throw new Error(`Twitter create_tweet_v2 failed after re-login: http=${retry.httpStatus} body=${safeJson(retry.data)}`);
}

module.exports = { tweet };
