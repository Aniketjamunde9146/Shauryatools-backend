# Shaurya Tools — Backend

Express 5 API that proxies AI requests to Groq. Keeps your API key off the browser.

## Run
```bash
cp .env.example .env.local     # add GROQ_API_KEY and FRONTEND_URL
npm install
npm run dev                    # http://localhost:5000
npm test                       # mocks Groq, covers all 47 AI tools + landing stream
```

## Endpoints
- `GET /` and `GET /health` — status
- `POST /api/ai` — body `{ "tool": "hashtag", "input": "..." }` → `{ success, data }`
- `POST /api/ai/landing` — streams generated HTML (SSE)

Set `FRONTEND_URL` to your deployed frontend so CORS allows it.

## Keeping the server awake (always on)
Free hosts such as Render sleep after about 15 minutes without requests. Two free layers prevent that:
1. **Self-ping (automatic):** the server pings its own `/health` every 10 minutes. On Render this is detected
   from `RENDER_EXTERNAL_URL`, so nothing needs configuring. Elsewhere, set `KEEP_ALIVE_URL` to your public backend URL.
   Logs show `keep-alive ok` every 10 minutes.
2. **GitHub Actions backup:** `.github/workflows/keep-alive.yml` pings `/health` from outside every 10 minutes.
   Add a repository secret named `BACKEND_URL` with your backend URL (no trailing slash). Works if the server
   ever stops self-pinging.

`GET /health` is a small JSON response, never calls Groq, is never cached, and is not rate limited.
The frontend also pings it once when a visitor lands, so the first click is fast.
