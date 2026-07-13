const crypto = require('crypto');

const SESSION_COOKIE = 'clipbridge_session';

/** Constant-time string comparison so response timing can't leak the secret. */
function constantTimeEquals(expected, provided) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Authorized via either the `x-api-key` header (used by sync clients: Mac,
 * Windows, iOS Shortcut) or the HttpOnly session cookie (used by the browser
 * success/history page after a one-time /api/unlock). Never throws on
 * malformed input.
 */
function isAuthorized(req) {
  const expected = process.env.CLIPBRIDGE_API_KEY;
  if (!expected) {
    throw new Error('CLIPBRIDGE_API_KEY is not set on the server');
  }

  if (constantTimeEquals(expected, req.headers['x-api-key'])) return true;

  const cookieKey = req.cookies && req.cookies[SESSION_COOKIE];
  if (constantTimeEquals(expected, cookieKey)) return true;

  return false;
}

module.exports = { isAuthorized, constantTimeEquals, SESSION_COOKIE };
