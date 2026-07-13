const { getRedis } = require('./redis');
const { RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS } = require('./config');

/**
 * Fixed-window rate limiter backed by KV, keyed by client IP.
 * Protects the API if the shared secret ever leaks — a caller is capped
 * at RATE_LIMIT_MAX_REQUESTS per RATE_LIMIT_WINDOW_SECONDS regardless of
 * whether they have a valid key.
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

async function checkRateLimit(req) {
  const ip = getClientIp(req);
  const windowId = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS);
  const key = `clipbridge:ratelimit:${ip}:${windowId}`;

  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }

  return {
    allowed: count <= RATE_LIMIT_MAX_REQUESTS,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - count),
    limit: RATE_LIMIT_MAX_REQUESTS,
  };
}

module.exports = { checkRateLimit };
