import { setAuthTokenGetter } from "@workspace/api-client-react";

const TOKEN_KEY = "taxflow_api_token";

/**
 * P0-4 — attach the shared API bearer token (used when the backend gate is
 * enabled via API_AUTH_TOKEN) to every request. The token lives in
 * localStorage. An operator can bootstrap it once via a `?api_token=…` URL
 * param (captured, persisted, then stripped from the address bar) or via the
 * console: `localStorage.setItem("taxflow_api_token", "…")`.
 *
 * In demo mode (backend API_AUTH_TOKEN unset) this is harmless: no token is
 * stored, no Authorization header is sent, and the open API responds normally.
 * The primary production control is edge auth (Cloudflare Access); this is the
 * app-layer companion. A polished in-app login is a fast-follow.
 */
export function installApiAuth(): void {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("api_token");
    if (fromUrl) {
      localStorage.setItem(TOKEN_KEY, fromUrl);
      url.searchParams.delete("api_token");
      window.history.replaceState({}, "", url.toString());
    }
  } catch {
    // non-browser / malformed URL — ignore
  }
  setAuthTokenGetter(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });
}

export function setApiToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearApiToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
