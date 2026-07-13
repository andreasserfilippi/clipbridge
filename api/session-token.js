const { nanoid } = require('nanoid');
const { isAuthorized } = require('../lib/auth');
const { checkRateLimit } = require('../lib/rateLimit');
const { getRedis } = require('../lib/redis');
const { SESSION_TOKEN_PREFIX, SESSION_TOKEN_TTL_SECONDS } = require('../lib/config');

// Called by sync clients (e.g. the iOS Shortcut, using its cached x-api-key)
// to get a short-lived, single-use token safe to put in a URL. The Safari
// success page exchanges it via /api/unlock for the real session cookie —
// the durable API key itself never has to travel through a URL.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let authorized;
  try {
    authorized = isAuthorized(req);
  } catch (err) {
    res.status(500).json({ error: 'Server misconfigured: ' + err.message });
    return;
  }
  if (!authorized) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const rateLimit = await checkRateLimit(req);
  if (!rateLimit.allowed) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  const token = nanoid(32);
  const redis = getRedis();
  await redis.set(SESSION_TOKEN_PREFIX + token, '1', { ex: SESSION_TOKEN_TTL_SECONDS });

  res.status(201).json({ token, expiresInSeconds: SESSION_TOKEN_TTL_SECONDS });
};
