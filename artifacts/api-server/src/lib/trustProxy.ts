/**
 * Resolve the Express `trust proxy` setting from the environment.
 *
 * Security context (2026-06-22 audit, T0.2 C4):
 *   `app.set("trust proxy", 1)` was HARD-CODED. On the current EC2 box there is
 *   NO reverse proxy in front of Node (the api-server serves traffic directly —
 *   see CLAUDE.md "no nginx"). With `trust proxy` truthy, Express derives
 *   `req.ip` from the client-supplied `X-Forwarded-For` header, so ANY client
 *   can spoof an arbitrary IP and defeat the per-IP rate limiter (rotate the
 *   forged IP every request → unlimited throughput). The secure default for a
 *   directly-exposed server is to NOT trust proxy headers and use the real TCP
 *   socket address (which a client cannot forge).
 *
 * Therefore: default to `false` (no proxy). Opt IN to proxy-header trust only
 * when a known terminator is actually in front of Node — set TRUST_PROXY to the
 * exact hop count once Cloudflare Access / an ALB / nginx is deployed (T0.1):
 *   - unset / "" / "false" / "0" / "off" / "no"  → false  (no proxy; secure)
 *   - "1", "2", …  (positive int)                → that many proxy hops
 *   - "true"                                     → trust all hops (DISCOURAGED;
 *                                                  only behind a trusted network
 *                                                  that strips inbound XFF)
 *   - anything else                              → false  (fail secure)
 *
 * Express accepts a boolean, a hop-count number, a subnet string, or a function
 * for `trust proxy`; we expose the two safe shapes (false | positive integer)
 * plus the explicit `true` escape hatch.
 */
export type TrustProxySetting = boolean | number;

export function resolveTrustProxy(raw: string | undefined | null): TrustProxySetting {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "" || v === "false" || v === "0" || v === "off" || v === "no") return false;
  if (v === "true") return true;
  // A positive integer = number of proxy hops to trust (XFF entries from the
  // right). Reject 0/negatives/floats/garbage → fail secure (false).
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 10) return n;
  }
  return false;
}
