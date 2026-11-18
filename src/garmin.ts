/**
 * Minimal client for the Garmin Connect Personal API.
 *
 * Flow (see https://developer.garmin.com/gc-developer-program/personal/personal-api/):
 *   1. POST the personal API key to the token endpoint with `Authorization: ApiKey <key>`.
 *      The response body is a JWT bearer token, valid for up to 24 hours. There is no refresh token.
 *   2. Call the data endpoints with `Authorization: Bearer <token>`.
 *
 * Endpoint paths follow Garmin's official client: https://github.com/garmin/connect-personal-api-python
 */

export const DEFAULT_BASE_URL = "https://personal.connectapi.garmin.com";
export const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

/** Re-exchange the key when the cached token has less than this left. */
const REFRESH_WINDOW_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 30_000;

export class GarminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    body: string,
  ) {
    super(`Garmin API ${status} on ${path}: ${body.slice(0, 500)}`);
  }
}

/** Reads the `exp` claim (seconds) of a JWT without verifying it. */
export function jwtExpiryMs(token: string): number {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("Garmin token response is not a JWT");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (typeof payload.exp !== "number") throw new Error("Garmin token has no exp claim");
  return payload.exp * 1000;
}

type FetchFn = typeof fetch;

export class GarminClient {
  private token: { value: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (!apiKey) throw new Error("GARMIN_PERSONAL_API_KEY is not set");
  }

  private async bearer(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt - this.now() > REFRESH_WINDOW_MS) {
      return this.token.value;
    }
    // Share one in-flight exchange between concurrent tool calls.
    this.pending ??= (async () => {
      try {
        const res = await this.fetchFn(this.baseUrl + TOKEN_PATH, {
          method: "POST",
          headers: { Accept: "*/*", Authorization: `ApiKey ${this.apiKey}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = (await res.text()).trim();
        // Never echo the token endpoint's body: on success it is the bearer token.
        if (!res.ok) throw new GarminApiError(res.status, TOKEN_PATH, res.status === 401 ? "API key rejected or expired" : "token exchange failed");
        this.token = { value: body, expiresAt: jwtExpiryMs(body) };
        return body;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  /** GET a JSON endpoint. Retries once with a fresh token on 401. */
  async get(path: string, params?: Record<string, string | number | undefined>): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.bearer(attempt > 0);
      const res = await this.fetchFn(url, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401 && attempt === 0) continue;
      const text = await res.text();
      if (!res.ok) throw new GarminApiError(res.status, url.pathname, text);
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    throw new Error("unreachable");
  }
}
