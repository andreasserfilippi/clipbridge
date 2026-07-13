const { Redis } = require('@upstash/redis');

let client = null;

// Reads KV_REST_API_URL / KV_REST_API_TOKEN, injected automatically when a
// Redis store (Upstash, via Vercel Marketplace) is connected to the project.
function getRedis() {
  if (!client) {
    client = Redis.fromEnv();
  }
  return client;
}

module.exports = { getRedis };
