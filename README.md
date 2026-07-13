# ClipBridge

Cross-device clipboard sync. Copy on one device, send it on purpose, paste on another — iPhone, Windows today, Mac coming.

This repo has two parts: a Vercel backend (API + Redis + Pusher) that stores clipboard entries (text and images), converts every image to JPEG server-side for universal viewability, and pushes real-time notifications when new content arrives; and [`desktop-app`](desktop-app), an Electron client (Windows now, Mac planned — same codebase) with a small always-on-top floating button. The iOS side is a Shortcut plus a hosted [history page](#success--history-page) for the browser-facing bits.

## How it works

Sending is always a deliberate action, never automatic — copying something doesn't upload it by itself, on any platform. You explicitly send it (tap a button on iOS, click the floating button on desktop), which is what keeps normal day-to-day copying from flooding every device with noise.

1. A client `POST`s clipboard content (text, or a Blob URL for images) to `/api/clipboard`, authenticated with a shared secret API key.
2. The backend stores the entry in Redis (via Vercel's Upstash Marketplace integration, keeping the last 200 entries — see [Image storage](#image-storage) for what happens to older entries) and fires a Pusher event on a shared channel.
3. Other connected clients receive that Pusher event in real time and update immediately — no polling, anywhere, for receiving updates.
4. `GET /api/clipboard/history` returns the full recent history for clients that want to show a list.

Every request (`POST` and both `GET`s) requires the `x-api-key` header. There is no unauthenticated read path.

## Deploy your own instance

Each user runs their own instance with their own API key, KV store, and Pusher account — nothing is shared between deployments.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repo-url=https%3A%2F%2Fgithub.com%2Fandreasserfilippi%2Fclipbridge&env=CLIPBRIDGE_API_KEY,PUSHER_APP_ID,PUSHER_KEY,PUSHER_SECRET,PUSHER_CLUSTER&envDescription=Required%20environment%20variables%20for%20ClipBridge&envLink=https%3A%2F%2Fgithub.com%2Fandreasserfilippi%2Fclipbridge%2Fblob%2Fmaster%2F.env.example&stores=%5B%7B%22type%22%3A%22kv%22%7D%2C%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22public%22%7D%5D)

The button will:
- Fork/clone this repo into a new Vercel project
- Prompt you to create and attach a **Redis** store (Upstash, via Vercel Marketplace) — this auto-injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`, you don't set those by hand
- Prompt you to create a **public Blob** store — auto-injects `BLOB_READ_WRITE_TOKEN`, used for image uploads
- Prompt you for the remaining environment variables listed below (Pushcut is optional and not prompted for — add `PUSHCUT_WEBHOOK_URL` manually later if you want iPhone push notifications)

### Manual setup

```bash
npm install
vercel login
vercel link
vercel env pull .env   # after you've set env vars in the dashboard, for local dev
```

## Environment variables

See [.env.example](.env.example) for the full list. Summary:

| Variable | Where to get it |
|---|---|
| `CLIPBRIDGE_API_KEY` | Generate yourself: `openssl rand -hex 32`. This is the shared secret every client must send. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Vercel dashboard → your project → **Storage** → **Marketplace Database Providers** → **Upstash** → **Redis**. Auto-injected once connected. |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | Free at [dashboard.pusher.com](https://dashboard.pusher.com/) → **Channels** → **Create app**. Values are on the app's "App Keys" tab. |
| `RATE_LIMIT_MAX_REQUESTS` | Optional. Max requests per client IP per 60s window. Defaults to 60. |
| `PUSHCUT_WEBHOOK_URL` | Optional. Powers iPhone push notifications — see [Push notifications to iPhone](#push-notifications-to-iphone) below. |

**Never commit a real `.env` file** — it's excluded via `.gitignore`.

## API reference

All requests require an `x-api-key` header matching `CLIPBRIDGE_API_KEY`.

### `POST /api/clipboard`

Save a new clipboard entry and notify other devices.

```bash
curl -X POST https://your-deployment.vercel.app/api/clipboard \
  -H "x-api-key: $CLIPBRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "hello from curl", "type": "text", "device": "Test Script"}'
```

Body fields:
- `content` (string, required) — text, a Vercel Blob URL (large images, recommended), or a small base64-encoded image
- `type` (string, required) — `"text"` or `"image"`
- `device` (string, required) — human-readable source device name

Response `201`:
```json
{ "entry": { "id": "...", "content": "hello from curl", "type": "text", "device": "Test Script", "timestamp": 1731000000000 } }
```

### `GET /api/clipboard`

Returns the most recent entry.

```bash
curl https://your-deployment.vercel.app/api/clipboard -H "x-api-key: $CLIPBRIDGE_API_KEY"
```

### `GET /api/clipboard/history`

Returns the full history (up to 200 entries, newest first). Accepts an optional `?limit=N` query param.

```bash
curl https://your-deployment.vercel.app/api/clipboard/history -H "x-api-key: $CLIPBRIDGE_API_KEY"
```

## Image storage

Vercel serverless functions cap request bodies at 4.5MB, and inline base64 (33% bigger than the original file) eats into that fast — a typical phone photo can blow past it. To avoid that ceiling, images are uploaded **directly from the client to Vercel Blob storage**, bypassing the API function entirely for the actual file transfer:

1. The client PUTs the raw image bytes straight to `https://blob.vercel-storage.com/<filename>` with header `Authorization: Bearer $BLOB_READ_WRITE_TOKEN` (the same token from your env vars — sync clients need this value directly, same trust model as the API key). Response is JSON: `{ "url": "https://....public.blob.vercel-storage.com/...", ... }`.
2. The client then calls `POST /api/clipboard` as normal, but with `content` set to that returned `url` instead of raw base64.
3. The backend fetches that original upload, converts it to JPEG server-side (`lib/imageConvert.js`, using `sharp` for most formats and `heic-convert` for HEIC/HEIF specifically, since patent licensing keeps HEIC decoding out of sharp's prebuilt binaries), re-uploads the JPEG to Blob, and stores *that* URL as the entry's `content`.
4. `GET /api/clipboard` and every client (iOS, Windows, Mac later) just fetch/render that URL directly — always a JPEG, regardless of what format the original client captured (HEIC, PNG, WebP, whatever). No per-client format handling needed anywhere downstream.

Small inline base64 images (as sent by earlier versions of this project) are also normalized through the same conversion step. `api/clipboard.js`'s `maxDuration` is raised to 30s (`vercel.json`) to give the fetch-convert-reupload round trip room to run.

### Storage never grows unbounded

History is capped at 200 entries (`MAX_HISTORY_ENTRIES` in `lib/config.js`) — every write trims the Redis list back down with `LTRIM`. Whatever falls off the end also has its Blob file deleted in that same request (`lib/store.js`), so Blob storage stays bounded too, not just the visible list. Without that second step, old images would keep accumulating in Blob storage forever even after they'd scrolled out of everyone's history.

## Real-time updates

Clients subscribe to the Pusher channel `clipbridge` and listen for the `new-clipboard-entry` event, whose payload is the same entry object returned by the API. This lets connected apps update instantly instead of polling.

## Security notes

- The API key is compared using a constant-time check (`crypto.timingSafeEqual`) to avoid timing attacks.
- All three endpoints require the API key — Vercel KV itself is never exposed directly to clients.
- Basic IP-based rate limiting (default: 60 requests/minute) protects against abuse if a key ever leaks.
- No resource (KV store, Pusher app, API key) is shared across deployments — every user provisions their own.

## Project structure

```
/api
  clipboard.js            POST (save + notify) and GET (latest) for /api/clipboard
  /clipboard
    history.js             GET /api/clipboard/history
  unlock.js                 POST /api/unlock — API key or one-time token -> session cookie
  session-token.js          POST /api/session-token — mints a short-lived one-time token
/lib
  auth.js                  API key verification
  blob.js                   Vercel Blob upload/fetch helpers
  config.js                Tunable constants
  imageConvert.js            Normalizes any image format to JPEG
  pusher.js                Pusher client + event trigger
  pushcut.js                 Optional iPhone push notification trigger
  rateLimit.js              Redis-backed fixed-window rate limiter
  redis.js                  Shared Upstash Redis client
  store.js                  Redis read/write helpers for clipboard entries
/public
  index.html                Success + history page opened by the iOS Shortcut
/desktop-app                Electron client (Windows now, Mac planned) — see below
  /src
    main.js                  Main process: floating overlay + hidden setup/background window
    preload.js, renderer.js   The hidden background window — holds config, Pusher, uploads
    floating-preload.js, floating-renderer.js, floating.html   The floating button + history panel
    index.html                First-run setup form
```

## Success + history page

`GET /` serves a static page (`public/index.html`) showing a success banner and a scrollable, tap-to-copy history list. `/api/clipboard` and `/api/clipboard/history` accept either the `x-api-key` header (used by sync clients) or an `HttpOnly` session cookie (used by this page).

There are two ways to establish that session cookie, both via `POST /api/unlock`:

1. **Manual** — visit the page with no session yet and you're shown an "Unlock" form; type your API key once (masked, like a password field) and it's exchanged for the cookie (1 year).
2. **Automatic (recommended for the iOS Shortcut)** — a sync client that already holds the key calls `POST /api/session-token` (header-authenticated) to mint a short-lived (120s), single-use token. It opens the success page with `?token=...` instead of the raw key. The page immediately strips the token from the address bar and exchanges it for the same session cookie in the background — no typing, and the durable key never travels through a URL at all.

The page also works as a home-screen web app (Safari → Share → Add to Home Screen) — it declares the `apple-mobile-web-app-*` meta tags for a chrome-free, full-screen icon. That standalone mode has no Safari reload button and no native pull-to-refresh gesture, so both are reimplemented on the page itself: a refresh button in the header, and a real pull-down-to-refresh gesture.

## Push notifications to iPhone

iOS can't keep a Pusher WebSocket connection alive in the background the way the Windows app can, so real-time push to an iPhone goes through [Pushcut](https://pushcut.co) instead — a free app that turns a webhook call into a real push notification, which can run a Shortcut when tapped.

1. Install Pushcut from the App Store and open it.
2. Create a **Notification** (Notifications tab → **+**) with a **static** title/text (e.g. "New clipboard item — tap to copy"). Set its tap action to **Run Shortcut**, pointing at a Shortcut that fetches the latest entry (`GET /api/clipboard` with your `x-api-key` header), branches on `entry.type`, and runs **Copy to Clipboard** (decoding base64 first for images).
3. Copy that notification's webhook URL (shown in its settings) and set it as `PUSHCUT_WEBHOOK_URL` in your Vercel project's environment variables.
4. Every `POST /api/clipboard` from a non-iPhone device now fires that notification with a bare, bodyless POST. Entries whose `device` field contains "iphone" (case-insensitive) are skipped, so you don't get notified about your own copies.

Keep the title/text static and don't try to pass per-call data through the webhook — Pushcut's free tier only allows a fixed notification triggered by a bare POST; dynamic titles/text/input per call require a Pro subscription. Having the Shortcut pull the latest entry itself via `GET /api/clipboard` avoids needing that.

This is entirely optional — leave `PUSHCUT_WEBHOOK_URL` unset and the backend just skips this step silently.

## Desktop app (Windows now, Mac planned)

Lives in [`desktop-app`](desktop-app), an Electron client. Run it with:

```bash
cd desktop-app
npm install
npm start
```

First launch shows a small setup window asking for the same values as the iOS Shortcut (backend URL, API key, Pusher key/cluster, Blob token, device name). Once saved, that window hides permanently — it just keeps the config, the Pusher connection, and history in sync in the background from then on. The entire visible UI is a small floating button:

- **Click** it to send whatever's currently on your clipboard — same one-tap model as the iOS Shortcut, nothing syncs on its own.
- **Right-click, or the small handle on its edge**, expands it into a compact history panel — tap any entry to copy it back to your clipboard.
- **Drag** the button (or, once expanded, the panel's header bar) anywhere on screen. Each remembers its own position independently and survives restarts.
- Launches at Windows login by default (toggle from the tray menu), and stays running in the tray when the window is "closed."

There's no clipboard-change watcher at all — a click just reads whatever's on the clipboard at that instant (`clipboard.readText()` / `clipboard.readImage()`, Electron's cross-platform API) and sends it. That's what earlier versions of this app got wrong: auto-syncing on every clipboard change sounds convenient until it means every password manager fill and every dictation tool's paste-via-clipboard trick also gets broadcast to every device. Manual-only, matching the iOS Shortcuts, fixed that. Receiving updates from other devices is the same Pusher push used everywhere else in this project — no polling there either.

Not built yet: Mac should mostly be a packaging exercise on the same Electron codebase, not a rewrite — the manual-click model means there's no platform-specific clipboard-watching problem to solve (that would only matter for an auto-sync design, which this deliberately isn't). Neither installers (Windows or Mac) nor a one-click Vercel deploy for non-technical users exist yet either — see [Roadmap](#roadmap).

## Roadmap

- [x] Vercel backend (API + KV + Pusher)
- [x] iOS Shortcut + hosted Safari history page
- [x] Windows background app
- [ ] Mac background app
- [ ] Packaged installers (Windows, Mac) instead of running from source
- [ ] Downloadable iOS Shortcuts with a guided API-key setup prompt
