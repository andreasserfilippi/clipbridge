const { isAuthorized } = require('../../lib/auth');
const { checkRateLimit } = require('../../lib/rateLimit');
const { getHistory } = require('../../lib/store');
const { MAX_HISTORY_ENTRIES } = require('../../lib/config');

module.exports = async (req, res) => {
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
  res.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
  res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
  if (!rateLimit.allowed) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  const requestedLimit = Number(req.query.limit) || MAX_HISTORY_ENTRIES;
  const entries = await getHistory(requestedLimit);
  res.status(200).json({ entries, count: entries.length });
};
