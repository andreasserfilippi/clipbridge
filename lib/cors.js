// A request carrying a custom header (x-api-key, used by every sync client)
// always triggers a browser CORS preflight (OPTIONS) first, regardless of
// the actual method. Without this, every route answered OPTIONS the same
// way as any other unsupported method: 405. That's invisible to curl
// (which doesn't implement CORS at all) but silently breaks any real
// browser-based client hitting these routes cross-origin.
//
// Wildcard origin is safe here specifically because Allow-Credentials is
// never set: the x-api-key routes don't rely on cookies for auth, and the
// one route that does (the session cookie, set by /api/unlock) stays
// SameSite=Lax, so browsers won't attach it to a cross-site request even
// if the CORS headers would otherwise allow reading the response.
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { applyCors };
