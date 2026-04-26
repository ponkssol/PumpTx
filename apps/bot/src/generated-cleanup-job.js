'use strict';

const fs = require('fs/promises');
const path = require('path');
const log = require('./logger');

const TEN_MINUTES_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 23 * 60 * 60 * 1000;

/** @param {string} fileName */
function isGeneratedImage(fileName) {
  return /\.(png|jpe?g|webp|gif)$/i.test(String(fileName || ''));
}

/**
 * Deletes generated image files older than 23 hours.
 * @param {string} dir
 * @returns {Promise<{ checked: number, deleted: number }>}
 */
async function cleanupOldGeneratedFiles(dir) {
  const now = Date.now();
  let checked = 0;
  let deleted = 0;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') return { checked: 0, deleted: 0 };
    throw e;
  }

  for (const entry of entries) {
    if (!entry || !entry.isFile() || !isGeneratedImage(entry.name)) continue;
    checked += 1;
    const full = path.join(dir, entry.name);
    try {
      const stat = await fs.stat(full);
      if (now - stat.mtimeMs <= MAX_AGE_MS) continue;
      await fs.unlink(full);
      deleted += 1;
    } catch (e) {
      log.warn(`Generated cleanup skip ${entry.name}: ${e && e.message ? e.message : e}`);
    }
  }

  return { checked, deleted };
}

/**
 * Starts a background cleanup job:
 * - runs once immediately
 * - repeats every 10 minutes
 * @returns {() => void} stop function
 */
function startGeneratedCleanupJob() {
  const generatedDir = path.join(__dirname, '../public/generated');

  const run = async () => {
    try {
      const { checked, deleted } = await cleanupOldGeneratedFiles(generatedDir);
      if (deleted > 0) {
        log.info(`Generated cleanup: deleted ${deleted}/${checked} file(s) older than 23h`);
      }
    } catch (e) {
      log.warn(`Generated cleanup failed: ${e && e.message ? e.message : e}`);
    }
  };

  // Kick off once at startup, then continue on interval.
  run().catch(() => {});
  const timer = setInterval(() => {
    run().catch(() => {});
  }, TEN_MINUTES_MS);

  return () => clearInterval(timer);
}

module.exports = { startGeneratedCleanupJob };
