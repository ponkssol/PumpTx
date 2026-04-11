const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve(__dirname, '../../..', 'pumptx.db');
let db;

/** @returns {import('better-sqlite3').Database} Internal singleton accessor. */
function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

/** Initializes SQLite schema and indexes. */
function initDb() {
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signature TEXT UNIQUE NOT NULL,
      token_mint TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      token_name TEXT NOT NULL,
      buyer_wallet TEXT NOT NULL,
      sol_spent REAL NOT NULL,
      token_amount REAL NOT NULL,
      market_cap_usd REAL DEFAULT 0,
      volume_24h_usd REAL DEFAULT 0,
      fdv_usd REAL DEFAULT 0,
      timestamp TEXT NOT NULL,
      pump_fun_url TEXT NOT NULL,
      solscan_url TEXT NOT NULL,
      image_path TEXT,
      image_url TEXT,
      token_icon_url TEXT,
      tweet_posted INTEGER DEFAULT 0,
      telegram_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY DEFAULT 1,
      total_transactions INTEGER DEFAULT 0,
      total_sol_volume REAL DEFAULT 0,
      last_updated TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_signature ON transactions(signature);
    CREATE INDEX IF NOT EXISTS idx_transactions_token_mint ON transactions(token_mint);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    INSERT OR IGNORE INTO stats (id) VALUES (1);
  `);
  const cols = db.prepare('PRAGMA table_info(transactions)').all();
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('token_icon_url')) {
    db.exec('ALTER TABLE transactions ADD COLUMN token_icon_url TEXT');
  }
  if (!colNames.has('volume_24h_usd')) {
    db.exec('ALTER TABLE transactions ADD COLUMN volume_24h_usd REAL DEFAULT 0');
  }
  if (!colNames.has('fdv_usd')) {
    db.exec('ALTER TABLE transactions ADD COLUMN fdv_usd REAL DEFAULT 0');
  }
}

/**
 * @param {object} buyData
 * @param {string|null} imageUrl
 * @param {string|null} imagePath
 */
function saveTx(buyData, imageUrl, imagePath) {
  const stmt = getDb().prepare(`
    INSERT INTO transactions (
      signature, token_mint, token_symbol, token_name, buyer_wallet,
      sol_spent, token_amount, market_cap_usd, volume_24h_usd, fdv_usd, timestamp, pump_fun_url,
      solscan_url, image_path, image_url, token_icon_url
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  stmt.run(
    buyData.signature,
    buyData.tokenMint,
    buyData.tokenSymbol,
    buyData.tokenName,
    buyData.buyerWallet,
    buyData.solSpent,
    buyData.tokenAmount,
    buyData.marketCapUsd,
    buyData.volumeUsd24h ?? 0,
    buyData.fdvUsd ?? 0,
    buyData.timestamp,
    buyData.pumpFunUrl,
    buyData.solscanUrl,
    imagePath,
    imageUrl,
    buyData.tokenIconUrl ?? null,
  );
}

/** @param {string} signature @param {0|1} posted */
function updateTweetStatus(signature, posted) {
  getDb().prepare('UPDATE transactions SET tweet_posted=? WHERE signature=?').run(posted, signature);
}

/** @param {string} signature @param {0|1} sent */
function updateTelegramStatus(signature, sent) {
  getDb().prepare('UPDATE transactions SET telegram_sent=? WHERE signature=?').run(sent, signature);
}

/** @param {number} [limit=50] @returns {object[]} */
function getAllTx(limit = 50) {
  return getDb().prepare(
    'SELECT * FROM transactions ORDER BY id DESC LIMIT ?',
  ).all(limit);
}

/** @param {string} signature @returns {object|undefined} */
function getTxBySignature(signature) {
  return getDb().prepare('SELECT * FROM transactions WHERE signature=?').get(signature);
}

/** @returns {object|undefined} */
function getStats() {
  return getDb().prepare('SELECT * FROM stats WHERE id=1').get();
}

/** @param {number} solSpent */
function updateStats(solSpent) {
  getDb().prepare(`
    UPDATE stats SET
      total_transactions = total_transactions + 1,
      total_sol_volume = total_sol_volume + ?,
      last_updated = datetime('now')
    WHERE id=1
  `).run(solSpent);
}

module.exports = {
  initDb,
  saveTx,
  updateTweetStatus,
  updateTelegramStatus,
  getAllTx,
  getTxBySignature,
  getStats,
  updateStats,
};
