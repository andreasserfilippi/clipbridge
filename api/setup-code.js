const { isAuthorized } = require('../lib/auth');
const { checkRateLimit } = require('../lib/rateLimit');
const { applyCors } = require('../lib/cors');

// Bundles the account-level values every device needs (everything except
// the per-device name) so a device that's already set up can hand a new
// one a single paste instead of five separately copied fields. Never
// returns anything a caller couldn't already get by reading their own
// Vercel project's environment variables — this just saves the trip.
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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

  const { CLIPBRIDGE_API_KEY, PUSHER_KEY, PUSHER_CLUSTER, BLOB_READ_WRITE_TOKEN } = process.env;
  const missing = ['CLIPBRIDGE_API_KEY', 'PUSHER_KEY', 'PUSHER_CLUSTER', 'BLOB_READ_WRITE_TOKEN']
    .filter((name) => !process.env[name]);
  if (missing.length > 0) {
    res.status(500).json({ error: 'Server misconfigured: missing ' + missing.join(', ') });
    return;
  }

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = `${proto}://${req.headers.host}`;

  res.status(200).json({
    baseUrl,
    apiKey: CLIPBRIDGE_API_KEY,
    pusherKey: PUSHER_KEY,
    pusherCluster: PUSHER_CLUSTER,
    blobToken: BLOB_READ_WRITE_TOKEN,
  });
};
