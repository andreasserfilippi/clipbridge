// Central place for tunable limits so they aren't scattered as magic numbers.
module.exports = {
  MAX_HISTORY_ENTRIES: 200,
  MAX_CONTENT_BYTES: 4 * 1024 * 1024, // stay under Vercel's 4.5MB function body limit (Upstash allows up to 10MB, so Vercel is the real ceiling)
  RATE_LIMIT_WINDOW_SECONDS: 60,
  RATE_LIMIT_MAX_REQUESTS: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 60,
  ENTRIES_KEY: 'clipbridge:entries',
  SESSION_TOKEN_PREFIX: 'clipbridge:token:',
  SESSION_TOKEN_TTL_SECONDS: 120,
};
