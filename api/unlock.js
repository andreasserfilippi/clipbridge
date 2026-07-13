const { constantTimeEquals, SESSION_COOKIE } = require('../lib/auth');
const { checkRateLimit } = require('../lib/rateLimit');
const { getRedis } = require('../lib/redis');
const { SESSION_TOKEN_PREFIX } = require('../lib/config');

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function setSessionCookie(res, apiKey) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${apiKey}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; HttpOnly; Secure; SameSite=Lax`
  );
}

// One-time browser login: exchanges either (a) the API key typed once into a
// masked field, or (b) a short-lived single-use token minted by a sync
// client via /api/session-token, for an HttpOnly session cookie. Either way
// the durable key never has to travel through a URL.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rateLimit = await checkRateLimit(req);
  if (!rateLimit.allowed) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  const expected = process.env.CLIPBRIDGE_API_KEY;
  if (!expected) {
    res.status(500).json({ error: 'Server misconfigured: CLIPBRIDGE_API_KEY is not set' });
    return;
  }

  const { apiKey, token } = req.body || {};

  if (typeof token === 'string' && token.length > 0) {
    const redis = getRedis();
    const key = SESSION_TOKEN_PREFIX + token;
    const existed = await redis.getdel(key);
    if (!existed) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    setSessionCookie(res, expected);
    res.status(200).json({ ok: true });
    return;
  }

  if (!constantTimeEquals(expected, apiKey)) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  setSessionCookie(res, apiKey);
  res.status(200).json({ ok: true });
};
