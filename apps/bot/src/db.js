const { Pool } = require('pg');

let db;

/** @returns {Pool} Internal singleton accessor. */
function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

/** Initializes PostgreSQL schema and indexes. */
async function initDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for PostgreSQL storage');
  }

  const useSsl =
    String(process.env.PGSSL || '').toLowerCase() === 'true'
    || String(process.env.PGSSLMODE || '').toLowerCase() === 'require';
  db = new Pool({
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  await db.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      signature TEXT UNIQUE NOT NULL,
      token_mint TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      token_name TEXT NOT NULL,
      buyer_wallet TEXT NOT NULL,
      sol_spent DOUBLE PRECISION NOT NULL,
      token_amount DOUBLE PRECISION NOT NULL,
      market_cap_usd DOUBLE PRECISION DEFAULT 0,
      volume_24h_usd DOUBLE PRECISION DEFAULT 0,
      fdv_usd DOUBLE PRECISION DEFAULT 0,
      timestamp TEXT NOT NULL,
      pump_fun_url TEXT NOT NULL,
      solscan_url TEXT NOT NULL,
      image_path TEXT,
      image_url TEXT,
      token_icon_url TEXT,
      tweet_posted SMALLINT DEFAULT 0,
      telegram_sent SMALLINT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY DEFAULT 1,
      total_transactions BIGINT DEFAULT 0,
      total_sol_volume DOUBLE PRECISION DEFAULT 0,
      last_updated TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS telegram_groups (
      id BIGSERIAL PRIMARY KEY,
      group_id TEXT UNIQUE NOT NULL,
      group_title TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      owner_username TEXT,
      min_sol DOUBLE PRECISION DEFAULT 0,
      min_mcap DOUBLE PRECISION DEFAULT 0,
      is_active SMALLINT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_signature ON transactions(signature);
    CREATE INDEX IF NOT EXISTS idx_transactions_token_mint ON transactions(token_mint);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_telegram_groups_active ON telegram_groups(is_active);
    INSERT INTO stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `);

  await db.query(`
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS token_icon_url TEXT;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS volume_24h_usd DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fdv_usd DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE telegram_groups ALTER COLUMN is_active SET DEFAULT 0;
    ALTER TABLE telegram_groups ADD COLUMN IF NOT EXISTS group_url TEXT;
  `);
}

/**
 * @param {object} buyData
 * @param {string|null} imageUrl
 * @param {string|null} imagePath
 */
async function saveTx(buyData, imageUrl, imagePath) {
  await getDb().query(`
    INSERT INTO transactions (
      signature, token_mint, token_symbol, token_name, buyer_wallet,
      sol_spent, token_amount, market_cap_usd, volume_24h_usd, fdv_usd, timestamp, pump_fun_url,
      solscan_url, image_path, image_url, token_icon_url, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
  `, [
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
  ]);
}

/** @param {string} signature @param {0|1} posted */
async function updateTweetStatus(signature, posted) {
  await getDb().query('UPDATE transactions SET tweet_posted=$1 WHERE signature=$2', [posted, signature]);
}

/** @param {string} signature @param {0|1} sent */
async function updateTelegramStatus(signature, sent) {
  await getDb().query('UPDATE transactions SET telegram_sent=$1 WHERE signature=$2', [sent, signature]);
}

/** @param {number} [limit=50] @returns {object[]} */
async function getAllTx(limit = 50) {
  const { rows } = await getDb().query(
    'SELECT * FROM transactions ORDER BY id DESC LIMIT $1',
    [limit],
  );
  return rows;
}

/** @param {string} signature @returns {object|undefined} */
async function getTxBySignature(signature) {
  const { rows } = await getDb().query('SELECT * FROM transactions WHERE signature=$1 LIMIT 1', [signature]);
  return rows[0];
}

/** @returns {object|undefined} */
async function getStats() {
  const { rows } = await getDb().query('SELECT * FROM stats WHERE id=1 LIMIT 1');
  return rows[0];
}

/** @param {number} solSpent */
async function updateStats(solSpent) {
  await getDb().query(`
    UPDATE stats SET
      total_transactions = total_transactions + 1,
      total_sol_volume = total_sol_volume + $1,
      last_updated = now()
    WHERE id=1
  `, [solSpent]);
}

/**
 * @param {{
 *  groupId: string,
 *  groupTitle: string,
 *  ownerUserId: string,
 *  ownerUsername?: string|null,
 *  minSol: number,
 *  minMcap: number,
 *  groupUrl?: string|null
 * }} group
 */
async function upsertTelegramGroup(group) {
  const url = group.groupUrl && String(group.groupUrl).trim() ? String(group.groupUrl).trim() : null;
  await getDb().query(`
    INSERT INTO telegram_groups (
      group_id, group_title, owner_user_id, owner_username, min_sol, min_mcap, group_url, is_active, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, now())
    ON CONFLICT(group_id) DO UPDATE SET
      group_title = excluded.group_title,
      owner_user_id = excluded.owner_user_id,
      owner_username = excluded.owner_username,
      min_sol = excluded.min_sol,
      min_mcap = excluded.min_mcap,
      group_url = COALESCE(NULLIF(TRIM(excluded.group_url), ''), telegram_groups.group_url),
      updated_at = now()
  `, [
    group.groupId,
    group.groupTitle,
    group.ownerUserId,
    group.ownerUsername || null,
    group.minSol,
    group.minMcap,
    url,
  ]);
}

/**
 * Registers group if new and re-activates if existing without overriding existing thresholds.
 * @param {{
 *  groupId: string,
 *  groupTitle: string,
 *  ownerUserId: string,
 *  ownerUsername?: string|null,
 *  minSol: number,
 *  minMcap: number,
 *  groupUrl?: string|null
 * }} group
 */
async function registerTelegramGroup(group) {
  const url = group.groupUrl && String(group.groupUrl).trim() ? String(group.groupUrl).trim() : null;
  await getDb().query(`
    INSERT INTO telegram_groups (
      group_id, group_title, owner_user_id, owner_username, min_sol, min_mcap, group_url, is_active, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, now())
    ON CONFLICT(group_id) DO UPDATE SET
      group_title = excluded.group_title,
      owner_user_id = excluded.owner_user_id,
      owner_username = excluded.owner_username,
      updated_at = now(),
      group_url = COALESCE(NULLIF(TRIM(excluded.group_url), ''), telegram_groups.group_url)
  `, [
    group.groupId,
    group.groupTitle,
    group.ownerUserId,
    group.ownerUsername || null,
    group.minSol,
    group.minMcap,
    url,
  ]);
}

/**
 * Sets group_url when we learn a non-empty link (e.g. after bot becomes admin).
 * @param {string} groupId
 * @param {string|null|undefined} groupUrl
 */
async function updateTelegramGroupUrl(groupId, groupUrl) {
  const u = groupUrl && String(groupUrl).trim() ? String(groupUrl).trim() : '';
  if (!u) return;
  await getDb().query(
    'UPDATE telegram_groups SET group_url = $1, updated_at = now() WHERE group_id = $2',
    [u, groupId],
  );
}

/**
 * @param {string} groupId
 * @param {0|1} active
 */
async function setTelegramGroupActive(groupId, active) {
  await getDb().query(`
    UPDATE telegram_groups
    SET is_active = $1, updated_at = now()
    WHERE group_id = $2
  `, [active, groupId]);
}

/** @param {string} groupId */
async function deactivateTelegramGroup(groupId) {
  await setTelegramGroupActive(groupId, 0);
}

/** @param {string} groupId */
async function activateTelegramGroup(groupId) {
  await setTelegramGroupActive(groupId, 1);
}

/**
 * Permanently deletes a group row from storage.
 * @param {string} groupId
 * @returns {Promise<boolean>}
 */
async function deleteTelegramGroupPermanently(groupId) {
  const result = await getDb().query(
    'DELETE FROM telegram_groups WHERE group_id = $1',
    [groupId],
  );
  return Number(result.rowCount || 0) > 0;
}

/**
 * @param {string} groupId
 * @param {'min_sol'|'min_mcap'} key
 * @param {number} value
 */
async function updateTelegramGroupThreshold(groupId, key, value) {
  if (key !== 'min_sol' && key !== 'min_mcap') {
    throw new Error('Invalid threshold key');
  }
  const query = `
    UPDATE telegram_groups
    SET ${key} = $1, updated_at = now()
    WHERE group_id = $2
  `;
  await getDb().query(query, [value, groupId]);
}

/**
 * @param {string} groupId
 * @returns {{ group_id: string, group_title: string, min_sol: number, min_mcap: number, is_active: number }|undefined}
 */
async function getTelegramGroupById(groupId) {
  const { rows } = await getDb().query(`
    SELECT group_id, group_title, min_sol, min_mcap, is_active, group_url
    FROM telegram_groups
    WHERE group_id = $1
    LIMIT 1
  `, [groupId]);
  return rows[0];
}

/**
 * @param {string} ownerUserId
 * @returns {Array<{group_id: string, group_title: string, min_sol: number, min_mcap: number, is_active: number}>}
 */
async function getTelegramGroupsByOwner(ownerUserId) {
  const { rows } = await getDb().query(`
    SELECT group_id, group_title, min_sol, min_mcap, is_active, group_url
    FROM telegram_groups
    WHERE owner_user_id = $1
    ORDER BY updated_at DESC
  `, [ownerUserId]);
  return rows;
}

/**
 * All active groups across every owner (no owner filter).
 * @returns {Array<{group_id: string, min_sol: number, min_mcap: number}>}
 */
async function getActiveTelegramGroups() {
  const { rows } = await getDb().query(`
    SELECT group_id, min_sol, min_mcap
    FROM telegram_groups
    WHERE is_active = 1
    ORDER BY group_id
  `);
  return rows;
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
  upsertTelegramGroup,
  registerTelegramGroup,
  activateTelegramGroup,
  deactivateTelegramGroup,
  deleteTelegramGroupPermanently,
  updateTelegramGroupThreshold,
  getTelegramGroupById,
  getTelegramGroupsByOwner,
  getActiveTelegramGroups,
  updateTelegramGroupUrl,
};
