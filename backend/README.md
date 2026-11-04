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

`GET /api/health` verifies database connectivity. `npm test` checks auth, cookie-independent Bearer sessions, CORS, telemetry validation, config downloads and payload limits. `npm run test:db` checks real Neon storage in an isolated, rolled-back transaction. No demo data is seeded.

For firmware configuration in the complete local repository, update BACKEND_URL and run `npm run firmware:configure` from this backend folder. This optional utility updates the root config.h, preserves existing Wi-Fi credentials, and synchronizes firmware/SoilSense_ESP32. It is not invoked by the backend runtime and is not needed for backend deployment.
