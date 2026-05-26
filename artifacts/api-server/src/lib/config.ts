/**
 * Process-wide server config, parsed once at startup from environment
 * variables. Keep this module tiny — only env-driven flags belong here.
 *
 * For per-request / per-firm overrides, layer those on top via Express
 * middleware (e.g., once Phase D15 multi-tenancy lands and gates Pro
 * tier on a per-firm column).
 */

/**
 * Parse a boolean-ish env var. Accepts: "true" / "1" / "yes" → true;
 * "false" / "0" / "no" → false. Case-insensitive. Anything else (including
 * undefined) falls back to `defaultValue`.
 */
function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return defaultValue;
}

export const config = {
  /**
   * Phase G5 feature flag. When false, all planning-tier endpoints
   * respond with HTTP 402 Payment Required and the frontend hides the
   * Planning tab + dashboard widget. Default true preserves the
   * pre-G5 behavior — toggle to false ahead of pricing rollout.
   */
  proTierEnabled: parseBoolEnv(process.env.PRO_TIER_ENABLED, true),
};

export type ServerConfig = typeof config;
