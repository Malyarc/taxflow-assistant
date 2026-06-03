import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// P0-4 — application-layer authentication gate.
//
// The platform has no user/session model yet (multi-tenant auth = D15, deferred
// to the Haven fusion). Until then this shared-secret bearer gate is the app
// backstop that stops the API being world-readable. The PRIMARY production front
// door should be edge auth (Cloudflare Access / SSO) with the EC2 security group
// locked to the edge — see docs/compliance/runbook-tls-s3-secrets.md. Run BOTH
// for defense in depth.
//
// Behaviour:
//   - API_AUTH_TOKEN set   → every /api route (except the health check) requires
//                            `Authorization: Bearer <token>`; 401 otherwise.
//   - API_AUTH_TOKEN unset → OPEN (demo mode) + a loud one-time startup warning.
//                            NEVER run with real taxpayer PII in this state.
const API_AUTH_TOKEN = (process.env.API_AUTH_TOKEN ?? "").trim();

// Relative to the /api mount. Kept public so load balancers / uptime checks work.
const PUBLIC_PATHS = new Set<string>(["/healthz"]);

let warnedOpen = false;

/**
 * Constant-time bearer-token comparison. Returns false on any malformed input
 * and never short-circuits on length in a way that leaks timing (length is
 * compared first because timingSafeEqual throws on unequal-length buffers; the
 * token is high-entropy so length is not the secret).
 */
export function verifyBearer(authHeader: string | undefined | null, expected: string): boolean {
  if (!expected || !authHeader) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return false;
  const provided = Buffer.from(match[1], "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (provided.length !== expectedBuf.length) return false;
  return timingSafeEqual(provided, expectedBuf);
}

/** True when an auth token is configured (i.e. the gate is enforcing). */
export function authEnabled(): boolean {
  return API_AUTH_TOKEN.length > 0;
}

/** Express middleware enforcing the bearer gate on /api routes. */
export function requireApiAuth(req: Request, res: Response, next: NextFunction): void {
  if (!API_AUTH_TOKEN) {
    if (!warnedOpen) {
      warnedOpen = true;
      logger.warn(
        "SECURITY: API_AUTH_TOKEN is not set — the API is UNAUTHENTICATED (demo mode). " +
          "Any client who reaches this host can read and write every client record and " +
          "tax document. Do NOT expose real taxpayer PII in this state. Set API_AUTH_TOKEN " +
          "and/or put the origin behind edge auth (Cloudflare Access) before any real data (P0-4).",
      );
    }
    return next();
  }
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (verifyBearer(req.header("authorization"), API_AUTH_TOKEN)) return next();
  res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" });
}
