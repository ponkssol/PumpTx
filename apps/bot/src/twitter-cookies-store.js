const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '../data/twitter-login-cookies.json');

/** @returns {string} */
function cookieStorePath() {
  return (process.env.TWITTER_COOKIE_STORE_PATH || DEFAULT_FILE).trim() || DEFAULT_FILE;
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Prefer env, then persisted file from last successful login.
 * @returns {string}
 */
function getTwitterLoginCookies() {
  const fromEnv = (process.env.TWITTER_LOGIN_COOKIE || '').trim();
  if (fromEnv) return fromEnv;
  const fp = cookieStorePath();
  try {
    if (!fs.existsSync(fp)) return '';
    const raw = fs.readFileSync(fp, 'utf8');
    const j = JSON.parse(raw);
    const c = j && (j.login_cookies || j.loginCookies);
    return typeof c === 'string' ? c.trim() : '';
  } catch (_) {
    return '';
  }
}

/**
 * Persists cookies for restarts; updates in-memory env for the current process.
 * @param {string} cookies
 */
function saveTwitterLoginCookies(cookies) {
  const c = String(cookies || '').trim();
  if (!c) return;
  process.env.TWITTER_LOGIN_COOKIE = c;
  const fp = cookieStorePath();
  ensureDirForFile(fp);
  const payload = {
    login_cookies: c,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(fp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

module.exports = {
  getTwitterLoginCookies,
  saveTwitterLoginCookies,
  cookieStorePath,
};
