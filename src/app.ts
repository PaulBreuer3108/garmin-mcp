import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { GarminClient } from "./garmin.js";
import { buildDashboard, type Dashboard } from "./dashboard.js";

/**
 * The progress web app (PWA) under /app. The page itself is static and holds no data.
 * The data endpoint needs a session cookie, which you get by entering APP_PASSWORD once.
 * The Garmin key never leaves the server.
 */

const COOKIE = "app_session";
const SESSION_DAYS = 180;
/** Serve cached data for this long unless the refresh button is pressed. */
const CACHE_MS = 30 * 60 * 1000;
/** Even a forced refresh waits this long between Garmin fetches. */
const MIN_REFRESH_MS = 20 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const digest = (s: string) => createHash("sha256").update(s).digest();

export interface AppOptions {
  password: string;
  /** Extra secret mixed into the cookie signature (MCP_SECRET), so the cookie can't be forged from the password alone. */
  signingSecret: string;
  now?: () => number;
}

export function registerApp(app: Express, garmin: GarminClient, opts: AppOptions): void {
  const now = opts.now ?? Date.now;
  const passwordDigest = digest(opts.password);
  // Changing APP_PASSWORD (or MCP_SECRET) logs out every device.
  const key = createHmac("sha256", opts.signingSecret).update("app-session:" + opts.password).digest();
  const sign = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

  const makeCookie = () => {
    const exp = now() + SESSION_DAYS * 86_400_000;
    return `${exp}.${sign(String(exp))}`;
  };
  const validCookie = (v: string | undefined) => {
    if (!v) return false;
    const [exp, sig] = v.split(".");
    if (!exp || !sig || Number(exp) < now()) return false;
    const expected = Buffer.from(sign(exp));
    const got = Buffer.from(sig);
    return expected.length === got.length && timingSafeEqual(expected, got);
  };
  const readCookie = (req: Request) =>
    (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .find(([k]) => k === COOKIE)?.[1];

  const requireSession = (req: Request, res: Response, next: NextFunction) => {
    if (validCookie(readCookie(req))) return next();
    res.status(401).json({ error: "login" });
  };

  let fails: number[] = [];

  let cache: { data: Dashboard; at: number } | null = null;
  let inflight: Promise<Dashboard> | null = null;
  const load = () =>
    (inflight ??= buildDashboard(garmin, new Date(now()))
      .then((data) => {
        cache = { data, at: now() };
        return data;
      })
      .finally(() => {
        inflight = null;
      }));

  const api = express.Router();
  api.use(express.json({ limit: "2kb" }));
  api.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  api.post("/login", (req, res) => {
    fails = fails.filter((t) => now() - t < LOGIN_WINDOW_MS);
    if (fails.length >= LOGIN_MAX_FAILS) {
      res.status(429).json({ error: "Zu viele Versuche. Bitte in 15 Minuten erneut probieren." });
      return;
    }
    const pw = (req.body as { password?: unknown } | undefined)?.password;
    if (typeof pw !== "string" || !timingSafeEqual(digest(pw), passwordDigest)) {
      fails.push(now());
      res.status(401).json({ error: "Falsches Passwort" });
      return;
    }
    res.cookie(COOKIE, makeCookie(), {
      httpOnly: true,
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
      sameSite: "strict",
      path: "/app",
      maxAge: SESSION_DAYS * 86_400_000,
    });
    res.json({ ok: true });
  });

  api.post("/logout", (_req, res) => {
    res.clearCookie(COOKIE, { path: "/app" });
    res.json({ ok: true });
  });

  api.get("/dashboard", requireSession, async (req, res) => {
    const force = req.query.refresh === "1";
    try {
      const age = cache ? now() - cache.at : Infinity;
      const fresh = force ? age < MIN_REFRESH_MS : age < CACHE_MS;
      const data = cache && fresh ? cache.data : await load();
      res.json(data);
    } catch (err) {
      console.error("Dashboard fetch failed:", err instanceof Error ? err.message : err);
      res.status(502).json({ error: "Garmin ist gerade nicht erreichbar.", stale: cache?.data ?? null });
    }
  });

  app.use("/app/api", api);
  app.get("/app", (req, res, next) => (req.path.endsWith("/") ? next() : res.redirect(301, "/app/")));
  app.use("/app", express.static(publicDir, { index: "index.html", maxAge: 0 }));
  app.get("/", (_req, res) => res.redirect("/app/"));
}
