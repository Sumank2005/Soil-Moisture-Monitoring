# SoilSense backend

Standalone Node.js + Express + Neon PostgreSQL project. The frontend folder is not needed to install, migrate or run this service.

```sh
cd backend
npm install
npm run db:migrate
npm run dev
```

The API listens on port 3001. Use `npm start` in production. This service does not build or serve the frontend.

The production API is **https://soilsense-gz6h.onrender.com**, and its frontend is **https://soilsense-ten-delta.vercel.app**. On Render, use Root Directory **backend**, Build Command **npm ci**, Start Command **npm start**, and health path **/api/health**. Set FRONTEND_ORIGIN to the Vercel origin and BACKEND_URL to the Render origin. Local HTTP values accidentally copied to production fall back to these public HTTPS origins; Render's own RENDER_EXTERNAL_URL takes precedence for device downloads. The known Vercel production origin is explicitly allowed by CORS. The Render runtime enables trust for one reverse-proxy hop.

Copy `.env.example` to `.env` for a new checkout, or configure the variables directly on the backend host. The existing local `.env` preserves your database, dashboard password, device token and session secret. The loader resolves this file relative to the backend folder, independently of the current working directory.

| Backend environment variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL connection URL |
| `DASHBOARD_PASSWORD` | Password entered on the dashboard |
| `SESSION_SECRET` | At least 32 random characters; signs dashboard sessions |
| `DEVICE_TOKEN` | At least 32 random characters; authenticates ESP32 uploads |
| `FRONTEND_ORIGIN` | Exact frontend origin, e.g. https://app.example.com |
| `BACKEND_URL` | Backend URL reachable by ESP32, e.g. https://api.example.com |
| `BACKEND_HOST` | Listen address, default 0.0.0.0 |
| `PORT` | API port, default 3001; hosting providers may supply this |
| `NODE_ENV` | production on your hosting platform |

For deployment: choose **backend** as the service root, run `npm ci`, run `npm run db:migrate` as a release/setup command, and start with `npm start`. No frontend build step is needed. Database queries use verified TLS. Configure HTTPS on the host. Set `TRUST_PROXY=1` only when exactly one trusted reverse proxy sits in front of this service.

Dashboard routes accept a signed Bearer session token, allowing frontend and API deployments on different domains. `/api/ingest` independently requires the ESP32 DEVICE_TOKEN. Requests from browser origins other than FRONTEND_ORIGIN are rejected. Local development also accepts localhost/127.0.0.1 aliases on port 5173.

`GET /api/health` verifies database connectivity and reports worker progress. `npm test` checks authentication, validation, queue failure handling, bounded concurrency, batch rollback and dashboard caching. `npm run test:db` checks durable enqueue and batch processing in temporary Neon tables inside a rolled-back transaction. No demo data is seeded.

## Upload queue and worker

The ESP endpoint and token stay unchanged. A successful upload is acknowledged with HTTP 200 only after its validated payload is committed to the Neon inbox (`soilsense_ingest_queue`) and its live device state is recorded. This uses one enqueue statement and one state upsert. The response includes `queued: true`. Duplicate boot/sequence pairs return `duplicate: true` without adding another inbox entry. The request no longer opens a transaction or runs retention cleanup.

`npm start` automatically starts a background Node worker thread alongside Express. No separate hosting service, Redis account or frontend configuration is required. The worker checks the inbox every five seconds, locks up to 100 entries with `FOR UPDATE SKIP LOCKED`, inserts the batch into readings, and removes completed inbox entries in one transaction. Multiple worker instances can claim different batches safely. A crash before commit rolls the batch back; unfinished entries survive restarts. Final-table uniqueness also makes replay idempotent.

The worker drains up to ten batches per cycle, yields between cycles, and backs off up to 60 seconds on database failure. The API and worker use at most five PostgreSQL connections combined per backend instance. Uploads retain the existing 30/minute per-IP rate limit; a separate 32-request in-flight cap returns HTTP 503 with Retry-After rather than accumulating an unbounded in-memory queue. No accepted samples are discarded or downsampled. Queueing smooths processing bursts; sustained traffic still requires database capacity for the durable inbox writes and retained readings.

Dashboard results are cached for 15 seconds per history window. Concurrent cache misses share one load, and failed loads are retried. Queued readings normally reach the dashboard within approximately 20 seconds (worker delay plus cache age). Seven-day retention cleanup runs every six hours in the worker, instead of on every upload. Cleanup can therefore retain up to six additional hours until the next run.

On startup the API idempotently creates the inbox table before accepting requests; `npm run db:migrate` also applies the queue migration. Graceful shutdown stops receiving requests, finishes the current worker transaction and closes both database pools. Worker crashes trigger a restart; health checks return HTTP 503 if the worker is not progressing.

## Online pump controls

Owner-authenticated `GET /api/control` reports live firmware capability, mode, faults and the latest command acknowledgement. Concurrent reads share a two-second cache. `POST /api/control` accepts exactly `{ "action": "on" | "off" | "auto" | "reset" }`, rate limited to 20/minute. It requires a capable device seen within 45 seconds. ON and Auto are rejected during sensor faults or timeout locks. OFF can replace a pending command; other commands wait for acknowledgement or expiry.

Commands are stored in a single-device durable mailbox, expire after 30 seconds and target the current boot ID. Upload responses carry the pending command in JSON and `X-SoilSense-Command-Id`, `X-SoilSense-Action`, `X-SoilSense-Expires-Ms` headers. Firmware applies commands on its local control loop and acknowledges the ID/result in a later upload. Queued means accepted by the server; only `applied` means confirmed by the ESP. A boot change expires pending commands. Duplicate delivery does not restart the motor timer or reset a later timeout.

Updated firmware is required once. Legacy firmware continues uploading normally and the UI explains why controls are unavailable. Reset clears the timeout latch into manual OFF rather than rebooting the ESP. The ten-second runtime limit and sensor protections remain active in all modes. Password sign-in is shared access to one station; no named user profile is implied.

For firmware configuration in the complete local repository, update BACKEND_URL and run `npm run firmware:configure` from this backend folder. This optional utility updates the root config.h, preserves existing Wi-Fi credentials, and synchronizes firmware/SoilSense_ESP32. It is not invoked by the backend runtime and is not needed for backend deployment.
