# SoilSense frontend

Standalone React + TypeScript + Vite project. It installs, builds and deploys without the backend source folder.

```sh
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173 or http://localhost:5173. Start the API separately. For a fresh checkout, copy `.env.example` to `.env.local`.

| Frontend environment variable | Example |
| --- | --- |
| `VITE_API_URL` | `http://localhost:3001` or `https://api.example.com` |

Use only the backend origin, without `/api` at the end. This variable is public and is embedded at build time. Never put database credentials or device/password secrets here.

For deployment: set VITE_API_URL in the frontend hosting environment, use `npm ci` and `npm run build`, and publish **frontend/dist** (or just **dist** when the hosting root is frontend). Configure SPA fallback to index.html. Set backend FRONTEND_ORIGIN to this frontend origin. There is no API proxy or shared runtime configuration.

Dashboard sign-in uses a signed session token in tab-local sessionStorage and sends it in the Authorization header. It does not depend on cookies being shared between domains or between localhost and 127.0.0.1. Closing the tab ends that local session. Device config downloads also use the authenticated API client.
