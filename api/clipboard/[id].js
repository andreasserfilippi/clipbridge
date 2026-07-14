const { isAuthorized } = require('../../lib/auth');
const { checkRateLimit } = require('../../lib/rateLimit');
const { deleteEntry } = require('../../lib/store');
const { notifyEntryDeleted } = require('../../lib/pusher');
const { applyCors } = require('../../lib/cors');

// Deletes a single entry everywhere at once: Redis (and its Blob file, if
// it was an image), then a Pusher event so every other connected client
// removes it from their own displayed history immediately too, the same
// real-time model as a new entry arriving.
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
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

  const { id } = req.query;
  if (typeof id !== 'string' || id.length === 0) {
    res.status(400).json({ error: '"id" is required' });
    return;
  }

  const deleted = await deleteEntry(id);
  if (!deleted) {
    res.status(404).json({ error: 'No entry with that id' });
    return;
  }

  try {
    await notifyEntryDeleted(id);
  } catch (err) {
    // Same tradeoff as the POST route's notification failures: the delete
    // already succeeded, so surface this as a warning rather than an error.
    res.status(200).json({ deleted: true, warning: 'Pusher push failed: ' + err.message });
    return;
  }

  res.status(200).json({ deleted: true });
};
