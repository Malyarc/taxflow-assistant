/**
 * HTTP security helpers.
 *
 * Centralizes response-header sanitization to prevent reflected XSS /
 * response-splitting / MIME-sniff exploits at file-download endpoints.
 *
 * Why this exists (2026-05-23 security audit):
 *   - `Content-Disposition: ... filename="${userControlled}"` was being set
 *     across 6 routes with no sanitization. A filename containing `"`,
 *     newlines, or shell-meta could break out of the header or trigger
 *     MIME-sniff renders in older browsers.
 *   - The file-content stream lacked `X-Content-Type-Options: nosniff`,
 *     so a `.pdf`-extension-named upload containing HTML could render in
 *     the app origin.
 *
 * Public surface:
 *   - safeFileName(name, ext?) — strip everything but [A-Za-z0-9._-],
 *     clamp to 100 chars, ensure a safe extension fallback.
 *   - setSecureDownloadHeaders(res, { fileName, contentType, disposition,
 *     length? }) — single call that sets Content-Type, Content-Disposition
 *     with the sanitized name, X-Content-Type-Options: nosniff, and
 *     optionally Content-Length.
 */

import type { Response } from "express";

const SAFE_NAME_PATTERN = /[^A-Za-z0-9._-]+/g;
const MAX_FILENAME_LEN = 100;

/**
 * Strip everything but [A-Za-z0-9._-], collapse runs to a single dash,
 * clamp total length, and fall back to `download<ext>` for empty results.
 */
export function safeFileName(name: string, fallbackExt = ""): string {
  if (typeof name !== "string") name = String(name);
  // Collapse path separators + non-safe runs to single dashes.
  const stripped = name.replace(SAFE_NAME_PATTERN, "-").replace(/^-+|-+$/g, "");
  const clamped = stripped.slice(0, MAX_FILENAME_LEN);
  if (clamped.length === 0) {
    const ext = fallbackExt.replace(/[^A-Za-z0-9.]+/g, "");
    return `download${ext ? (ext.startsWith(".") ? ext : `.${ext}`) : ""}`;
  }
  return clamped;
}

/**
 * Set Content-Type + sanitized Content-Disposition + nosniff in one call.
 * Pass `disposition: "inline"` for previewable content (PDFs, images),
 * `"attachment"` for download triggers (CSVs, exports).
 */
export function setSecureDownloadHeaders(
  res: Response,
  opts: {
    fileName: string;
    contentType: string;
    disposition: "inline" | "attachment";
    length?: number;
    fallbackExt?: string;
  },
): void {
  const safe = safeFileName(opts.fileName, opts.fallbackExt);
  res.setHeader("Content-Type", opts.contentType);
  res.setHeader("Content-Disposition", `${opts.disposition}; filename="${safe}"`);
  // Defense against MIME-sniffing renders (esp. for user-uploaded files).
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (opts.length != null) {
    res.setHeader("Content-Length", String(opts.length));
  }
}

/**
 * Forbid storing a response in any browser or shared (proxy) cache. Apply to
 * JSON endpoints that return decrypted PII — SSN/TIN, or the AI-extraction
 * payload — so the sensitive body is never written to a cache on disk
 * (2026-06-22 audit, T0.2 C2). Complements the existing `no-store` on the
 * file-content stream.
 */
export function setNoStorePii(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
}
