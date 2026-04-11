import path from 'path';
import Database from 'better-sqlite3';

export interface Transaction {
  id: number;
  signature: string;
  token_mint: string;
  token_symbol: string;
  token_name: string;
  buyer_wallet: string;
  sol_spent: number;
  token_amount: number;
  market_cap_usd: number;
  timestamp: string;
  pump_fun_url: string;
  solscan_url: string;
  image_path: string | null;
  image_url: string | null;
  tweet_posted: number;
  telegram_sent: number;
  created_at: string;
}

export interface StatsRow {
  id: number;
  total_transactions: number;
  total_sol_volume: number;
  last_updated: string | null;
}

const DB_PATH = path.resolve(process.cwd(), '..', '..', 'pumptx.db');

function open(): Database.Database {
  return new Database(DB_PATH);
}

/** Returns latest transactions (default 50). */
export function getAllTx(limit = 50): Transaction[] {
  const db = open();
  try {
    return db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT ?').all(limit) as Transaction[];
  } finally {
    db.close();
  }
}

/** Returns one transaction by signature or undefined. */
export function getTxBySignature(signature: string): Transaction | undefined {
  const db = open();
  try {
    return db.prepare('SELECT * FROM transactions WHERE signature = ?').get(signature) as
      | Transaction
      | undefined;
  } finally {
    db.close();
  }
}

/** Returns aggregated stats row. */
export function getStats(): StatsRow | undefined {
  const db = open();
  try {
    return db.prepare('SELECT * FROM stats WHERE id = 1').get() as StatsRow | undefined;
  } finally {
    db.close();
  }
}
