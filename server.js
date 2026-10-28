import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import aiRoute from "./routes/ai.js";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const STARTED_AT = Date.now();

const app = express();
app.disable("x-powered-by");
// Behind Render/Vercel/Nginx: use the real client IP (needed for per-user rate limiting).
app.set("trust proxy", 1);
app.use(helmet());

/* =========================
   CORS Configuration
========================= */

// Browsers send origins without a trailing slash, so strip one from FRONTEND_URL if present.
const frontendOrigin = process.env.FRONTEND_URL?.trim().replace(/\/+$/, "");

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "https://shauryatools.vercel.app",
      frontendOrigin,
    ].filter(Boolean),
    methods: ["GET", "POST", "OPTIONS"],
  })
);

/* =========================
   Health Route (fast, no AI call, never cached)
   Hit by the frontend on page load to wake a sleeping server.
   Registered before the rate limiter so wake-up pings never get blocked.
========================= */

app.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({
    success: true,
    status: "ok",
    uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
  });
});

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Shaurya Tools Backend Running 🚀",
  });
});

/* =========================
   Middlewares
========================= */

app.use(express.json({ limit: "32kb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health" || req.path === "/",
  handler: (req, res) => {
    res.setHeader("Retry-After", "900");
    return res.status(429).json({
      success: false,
      error: "Too many requests. Please try again later.",
    });
  },
});

app.use(limiter);

/* =========================
   API Routes
========================= */

app.use("/api/ai", aiRoute);

/* =========================
   404 Handler
========================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found"
  });
});

/* =========================
   Global Error Handler
========================= */

app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err.message);

  const status = err.type === "entity.parse.failed" || err.type === "entity.too.large"
    ? 400
    : 500;

  res.status(status).json({
    success: false,
    error: status === 400
      ? "Invalid JSON request body"
      : "We're investing in our servers right now. Please try again after some time.",
  });
});

/* =========================
   Keep-alive (always on)
   Free hosts such as Render stop a service after ~15 minutes without incoming requests.
   The server pings its own /health route every 10 minutes, which counts as traffic and keeps it awake.
   On Render this URL is detected automatically (RENDER_EXTERNAL_URL). Elsewhere, set KEEP_ALIVE_URL.
   Set KEEP_ALIVE=off only for local development.
========================= */

function keepAliveTarget() {
  const explicit = process.env.KEEP_ALIVE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "") + "/health";
  const external = process.env.RENDER_EXTERNAL_URL?.trim();
  if (external) return external.replace(/\/+$/, "") + "/health";
  return "";
}

function startKeepAlive(url) {
  const everyMs = 10 * 60 * 1000;
  const ping = async () => {
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60000) });
      console.log(`keep-alive ${res.ok ? "ok" : "http " + res.status} ${new Date().toISOString()}`);
    } catch (error) {
      console.log(`keep-alive failed: ${error.message}`);
    }
  };
  setInterval(ping, everyMs);
  console.log(`🔁 Keep-alive: pinging ${url} every 10 minutes`);
}

/* =========================
   Server Start
========================= */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  const target = keepAliveTarget();
  if (process.env.KEEP_ALIVE === "off") console.log("Keep-alive disabled (KEEP_ALIVE=off)");
  else if (target) startKeepAlive(target);
  else console.log("⚠️ Keep-alive has no target. Set KEEP_ALIVE_URL, or rely on the GitHub Actions workflow.");
});
