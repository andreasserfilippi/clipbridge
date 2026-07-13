const Pusher = require('pusher');

let client = null;

function getPusherClient() {
  if (client) return client;

  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
    throw new Error('Pusher environment variables are not fully set');
  }

  client = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
  });

  return client;
}

const CHANNEL = 'clipbridge';
const EVENT = 'new-clipboard-entry';

async function notifyNewEntry(entry) {
  const pusher = getPusherClient();
  await pusher.trigger(CHANNEL, EVENT, entry);
}

module.exports = { notifyNewEntry, CHANNEL, EVENT };
