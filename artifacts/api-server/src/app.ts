import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
const app: Express = express();

// ── Trust Replit's reverse proxy so req.ip is the real client IP ─────
app.set("trust proxy", 1);

// ── Security headers (helmet) ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Telegram Mini App needs flexibility
  crossOriginEmbedderPolicy: false,
}));
app.disable("x-powered-by"); // Don't reveal server technology

// ── Compression ──────────────────────────────────────────────────────
app.use(compression());

// ── CORS — only Telegram-related origins ────────────────────────────
const ALLOWED_ORIGINS = [
  /^https:\/\/.*\.telegram\.org$/,
  /^https:\/\/.*\.tgwebapp\.net$/,
  /^https:\/\/.*\.replit\.dev$/,
  /^https:\/\/.*\.replit\.app$/,
  /^https:\/\/.*\.vercel\.app$/,
  /^https:\/\/.*\.vercel\.dev$/,
  /^http:\/\/localhost(:\d+)?$/,
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman in dev)
    if (!origin) return cb(null, true);
    const ok = ALLOWED_ORIGINS.some((r) => r.test(origin));
    cb(null, ok);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-telegram-init-data", "x-user-id"],
  exposedHeaders: ["X-Sticker-Format"],
  credentials: false,
}));

// ── Global rate limiter — protect all endpoints ──────────────────────
const globalLimiter = rateLimit({
  windowMs: 60_000,       // 1 minute window
  max: 120,               // max 120 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "طلبات كثيرة، حاول لاحقاً" },
  skip: () => process.env.NODE_ENV !== "production",
});
app.use(globalLimiter);

// ── Strict limiter for auth-sensitive endpoints ──────────────────────
export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "محاولات كثيرة، انتظر دقيقة" },
  skip: () => process.env.NODE_ENV !== "production",
});

// ── Request size limit ────────────────────────────────────────────────
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

// ── Logging (production only — reduces dev I/O overhead) ─────────────
if (process.env.NODE_ENV === "production") {
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );
}

// ── Routes ────────────────────────────────────────────────────────────
app.use("/api", router);

// ── 404 catch-all ─────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler — never leak stack traces ────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
