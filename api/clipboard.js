const { isAuthorized } = require('../lib/auth');
const { checkRateLimit } = require('../lib/rateLimit');
const { addEntry, getLatest } = require('../lib/store');
const { notifyNewEntry } = require('../lib/pusher');
const { notifyPushcut } = require('../lib/pushcut');
const { getImageBuffer, uploadToBlob } = require('../lib/blob');
const { toJpeg } = require('../lib/imageConvert');
const { MAX_CONTENT_BYTES } = require('../lib/config');

const VALID_TYPES = new Set(['text', 'image']);

module.exports = async (req, res) => {
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

  if (req.method === 'POST') {
    await handlePost(req, res);
    return;
  }

  if (req.method === 'GET') {
    await handleGet(req, res);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'Method not allowed' });
};

async function handlePost(req, res) {
  const body = req.body || {};
  const { content, type, device } = body;

  if (typeof content !== 'string' || content.length === 0) {
    res.status(400).json({ error: '"content" is required and must be a non-empty string' });
    return;
  }
  if (!VALID_TYPES.has(type)) {
    res.status(400).json({ error: '"type" must be either "text" or "image"' });
    return;
  }
  if (typeof device !== 'string' || device.length === 0) {
    res.status(400).json({ error: '"device" is required and must be a non-empty string' });
    return;
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    res.status(413).json({ error: `"content" exceeds the ${MAX_CONTENT_BYTES}-byte limit` });
    return;
  }

  let finalContent = content;
  if (type === 'image') {
    try {
      const original = await getImageBuffer(content);
      const jpeg = await toJpeg(original);
      finalContent = await uploadToBlob(jpeg, 'clipboard-image.jpg');
    } catch (err) {
      res.status(422).json({ error: 'Could not process image: ' + err.message });
      return;
    }
  }

  const entry = await addEntry({ content: finalContent, type, device });

  // Entry is already saved at this point; notification failures are
  // surfaced as warnings rather than losing the write.
  const warnings = [];
  const results = await Promise.allSettled([notifyNewEntry(entry), notifyPushcut(entry)]);
  if (results[0].status === 'rejected') {
    warnings.push('Pusher push failed: ' + results[0].reason.message);
  }
  if (results[1].status === 'rejected') {
    warnings.push('Pushcut notification failed: ' + results[1].reason.message);
  }

  if (warnings.length > 0) {
    res.status(201).json({ entry, warning: warnings.join('; ') });
    return;
  }

  res.status(201).json({ entry });
}

async function handleGet(req, res) {
  const entry = await getLatest();
  res.status(200).json({ entry });
}
