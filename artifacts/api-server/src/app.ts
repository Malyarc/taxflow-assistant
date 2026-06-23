import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { resolveTrustProxy } from "./lib/trustProxy";

const app: Express = express();

// `trust proxy` controls whether Express derives req.ip (used by the rate
// limiter) from the client-supplied X-Forwarded-For header. SECURE DEFAULT is
// `false` — the current box is directly exposed (no nginx/ALB), so trusting XFF
// would let any client spoof their IP and bypass per-IP rate limiting. Opt in by
// setting TRUST_PROXY to the real hop count once a terminator (Cloudflare Access
// / ALB) is deployed (T0.1). See lib/trustProxy.ts for the full rationale.
const trustProxy = resolveTrustProxy(process.env.TRUST_PROXY);
app.set("trust proxy", trustProxy);
if (trustProxy === true) {
  logger.warn(
    "SECURITY: TRUST_PROXY=true trusts ALL X-Forwarded-For hops — only safe behind a network that strips inbound XFF. Prefer an explicit hop count.",
  );
}

// Don't leak framework version.
app.disable("x-powered-by");

// Security headers. CSP allows 'unsafe-inline' for Vite-built React (the
// bundle uses inline style attributes); tighten when we have a nonce
// strategy. data:/blob: for `img-src` is needed by BoundedDocumentViewer
// (PDF.js renders pages to blob URLs). fonts.googleapis.com /
// fonts.gstatic.com are whitelisted for the Inter web font referenced
// from index.html.
//
// Two HTTPS-only behaviours are DISABLED on HTTP-only deployments:
//   - HSTS: tells browsers to refuse HTTP for a year (cached client-side).
//   - upgrade-insecure-requests CSP directive: auto-upgrades sub-resource
//     URLs from http→https when the page is loaded over HTTP. With no TLS
//     terminator (port 443 closed), the upgrade fails silently and the JS
//     bundle never loads → blank page.
//
// Both re-enable once a TLS terminator (ALB / CloudFront / nginx +
// certbot) is in place and port 443 actually responds:
//   - `hsts: { maxAge: ..., includeSubDomains: true, preload: true }`
//   - remove the `upgradeInsecureRequests: null` override (Helmet's
//     default re-includes it).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        // Allow Google Fonts stylesheet (index.html loads Inter from
        // fonts.googleapis.com). Future: self-host the font and drop these.
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        // Override Helmet's default — see HTTP-only note above.
        upgradeInsecureRequests: null,
      },
    },
    hsts: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS allowlist (deep-audit security finding). Secure-by-default: cross-origin
// is locked down UNLESS an explicit allowlist is configured. The wide-open
// reflect-any-origin mode now requires an explicit opt-in flag (CORS_ALLOW_ALL=
// true) rather than keying off `NODE_ENV !== production` — the prod box ships
// with NODE_ENV unset, which previously left it silently reflecting arbitrary
// origins with credentials. Set CORS_ALLOW_ALL=true only for local dev that
// needs cross-origin (e.g. a Vite dev server on a different port).
// Configure ALLOWED_ORIGINS as a comma-separated list, e.g.
//   ALLOWED_ORIGINS=https://app.taxflow.example,https://staging.taxflow.example
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const corsAllowAll = allowedOrigins.length === 0 && process.env.CORS_ALLOW_ALL === "true";
app.use(
  cors({
    origin: corsAllowAll
      ? true // explicit dev opt-in: reflect request origin
      : (origin, callback) => {
          // No Origin header → same-origin GET/HEAD, curl, or server-to-server:
          // allow (not subject to CORS anyway).
          if (!origin) return callback(null, true);
          if (allowedOrigins.includes(origin)) return callback(null, true);
          // Disallowed cross-origin: omit the Access-Control-Allow-Origin header
          // (the browser then blocks the cross-origin read) but do NOT raise an
          // error. Erroring would 500 same-origin POST/PUT/DELETE too (those
          // carry an Origin header), breaking the same-origin SPA the API serves.
          return callback(null, false);
        },
    credentials: true,
  }),
);

// Global rate limit (deep-audit security finding). 200 req / minute / IP
// covers normal CPA workflows (typical session has < 50 req/min). Heavier
// endpoints can install their own stricter limiter.
const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 200),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Skip the limiter entirely in NODE_ENV=test so test suites can rip
  // through endpoints in parallel without 429s.
  skip: () => process.env.NODE_ENV === "test",
});
app.use(globalLimiter);

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.use("/api", router);

// In production, serve the built React app from the same Express process.
// Set STATIC_DIR to override (defaults to ../tax-app/dist/public when present).
const staticDir = process.env.STATIC_DIR
  ?? path.resolve(process.cwd(), "../tax-app/dist/public");

if (fs.existsSync(staticDir)) {
  logger.info({ staticDir }, "Serving static frontend");
  app.use(express.static(staticDir));
  // SPA fallback: any non-/api GET that didn't match a static file → index.html
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

// Terminal error handler (must be registered LAST, after all routes + static).
// Express 5 auto-forwards rejected async route handlers here; without it,
// Express's default finalhandler returns a non-JSON HTML 500 that breaks the
// uniform { error } JSON contract the frontend's custom-fetch parses. Logs the
// error server-side (Pino) and returns a generic message — no stack or
// internals leaked to the client.
app.use(
  (err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error({ err, method: req.method, url: req.url?.split("?")[0] }, "Unhandled request error");
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
