'use strict';

/**
 * Single place to require @solana/web3.js. Some Node / bundler setups return
 * `{ default: { PublicKey, ... } }` for `require()`, which makes destructuring
 * at the top level yield `PublicKey === undefined` and breaks `new PublicKey()`.
 */
const m = require('@solana/web3.js');
const root = typeof m.PublicKey === 'function' ? m : m && m.default;

if (!root || typeof root.PublicKey !== 'function' || typeof root.Connection !== 'function') {
  const top = m && typeof m === 'object' ? Object.keys(m).join(',') : String(m);
  throw new Error(
    `[@solana/web3.js] PublicKey/Connection tidak tersedia (exports: ${top}). ` +
      'Pasang dependensi dari folder apps/bot: rm -rf node_modules && npm install',
  );
}

module.exports = root;
