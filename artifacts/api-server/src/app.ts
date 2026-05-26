import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the first proxy in front of us (load balancer / nginx / Vercel /
// CloudFront). Required for express-rate-limit to use the real client IP
// from X-Forwarded-For rather than the proxy's IP. Adjust `1` if there
// are more hops (e.g., set to 2 if behind two proxies).
app.set("trust proxy", 1);

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
// CORS allowlist (deep-audit security finding). Defaults to no cross-origin
// in production; in dev (when ALLOWED_ORIGINS unset and NODE_ENV !== production)
// we allow all so local Vite proxy + Storybook style workflows work.
// Configure ALLOWED_ORIGINS as a comma-separated list, e.g.
//   ALLOWED_ORIGINS=https://app.taxflow.example,https://staging.taxflow.example
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const corsAllowAll = allowedOrigins.length === 0 && process.env.NODE_ENV !== "production";
app.use(
  cors({
    origin: corsAllowAll
      ? true // dev / unset: reflect request origin
      : (origin, callback) => {
          // No origin → same-origin or curl: allow (already not subject to CORS).
          if (!origin) return callback(null, true);
          if (allowedOrigins.includes(origin)) return callback(null, true);
          return callback(new Error("Origin not allowed by CORS"));
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

export default app;
