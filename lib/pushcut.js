// Best-effort push notification via Pushcut (https://pushcut.co) so the
// iPhone — which can't hold a persistent Pusher connection in the
// background — gets an instant alert when another device copies something.
// Entirely optional: no-ops if PUSHCUT_WEBHOOK_URL isn't set.
//
// Deliberately sends no body: dynamic title/text/input per Pushcut webhook
// call requires a Pro subscription. A bare trigger just fires whatever
// static notification is configured in the Pushcut app (title/text/tap
// action all set there), which works on the free tier. The triggered
// Shortcut fetches the latest entry itself via GET /api/clipboard.
async function notifyPushcut(entry) {
  const webhookUrl = process.env.PUSHCUT_WEBHOOK_URL;
  if (!webhookUrl) return;

  // Skip notifying when the iPhone itself was the source — it already has
  // the content, and notifying yourself about your own copy is just noise.
  if (entry.device.toLowerCase().includes('iphone')) return;

  const res = await fetch(webhookUrl, { method: 'POST' });

  if (!res.ok) {
    throw new Error('Pushcut webhook returned HTTP ' + res.status);
  }
}

module.exports = { notifyPushcut };
