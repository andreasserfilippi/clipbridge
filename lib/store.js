const { nanoid } = require('nanoid');
const { del } = require('@vercel/blob');
const { getRedis } = require('./redis');
const { MAX_HISTORY_ENTRIES, ENTRIES_KEY } = require('./config');

/**
 * Entries are stored newest-first in a single Redis list. @upstash/redis
 * auto-serializes/deserializes JS objects, so we push/read plain objects
 * rather than manually stringifying.
 */
async function addEntry({ content, type, device }) {
  const entry = {
    id: nanoid(),
    content,
    type,
    device,
    timestamp: Date.now(),
  };

  const redis = getRedis();
  await redis.lpush(ENTRIES_KEY, entry);

  // Whatever falls past the cap is about to be dropped from the list —
  // grab it first so any Blob image file it points to can be deleted too.
  // Otherwise the visible history stays capped at MAX_HISTORY_ENTRIES but
  // Blob storage itself grows forever, since nothing else ever removes it.
  const evicted = await redis.lrange(ENTRIES_KEY, MAX_HISTORY_ENTRIES, -1);
  await redis.ltrim(ENTRIES_KEY, 0, MAX_HISTORY_ENTRIES - 1);
  await deleteEvictedBlobs(evicted);

  return entry;
}

async function deleteEvictedBlobs(evicted) {
  const urls = evicted
    .filter((e) => e && e.type === 'image' && typeof e.content === 'string' && e.content.startsWith('http'))
    .map((e) => e.content);
  if (urls.length === 0) return;

  try {
    await del(urls, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch (err) {
    // A cleanup miss just leaves one orphaned file behind — not worth
    // failing the sync that triggered it over.
    console.error('Failed to delete evicted blob(s):', err.message);
  }
}

async function getLatest() {
  const redis = getRedis();
  const entry = await redis.lindex(ENTRIES_KEY, 0);
  return entry || null;
}

async function getHistory(limit = MAX_HISTORY_ENTRIES) {
  const capped = Math.min(limit, MAX_HISTORY_ENTRIES);
  const redis = getRedis();
  const entries = await redis.lrange(ENTRIES_KEY, 0, capped - 1);
  return entries || [];
}

module.exports = { addEntry, getLatest, getHistory };
