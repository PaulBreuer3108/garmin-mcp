import { test } from "node:test";
import assert from "node:assert/strict";
import { GarminClient, TOKEN_PATH, jwtExpiryMs } from "../src/garmin.ts";
import { checkRange } from "../src/tools.ts";
import { fakeJwt } from "./helpers.ts";

test("jwtExpiryMs reads exp", () => {
  assert.equal(jwtExpiryMs(fakeJwt(1000)), 1_000_000);
});

test("exchanges key once, caches token, sends bearer", async () => {
  const calls: { url: string; auth: string }[] = [];
  const token = fakeJwt(Math.floor(Date.now() / 1000) + 86400);
  const fetchFn = (async (url: URL | string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string>).Authorization;
    calls.push({ url: String(url), auth });
    if (String(url).endsWith(TOKEN_PATH)) return new Response(token);
    return new Response(JSON.stringify({ ok: 1 }));
  }) as typeof fetch;
  const c = new GarminClient("KEY", "https://example.test", fetchFn);
  assert.deepEqual(await c.get("/a", { date: "2026-11-18" }), { ok: 1 });
  await c.get("/b");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].auth, "ApiKey KEY");
  assert.equal(calls[1].auth, `Bearer ${token}`);
  assert.equal(calls[1].url, "https://example.test/a?date=2026-11-18");
});

test("re-exchanges on 401 once", async () => {
  let tokens = 0;
  let dataCalls = 0;
  const fetchFn = (async (url: URL | string) => {
    if (String(url).endsWith(TOKEN_PATH)) {
      tokens++;
      return new Response(fakeJwt(Math.floor(Date.now() / 1000) + 86400));
    }
    dataCalls++;
    return dataCalls === 1 ? new Response("", { status: 401 }) : new Response("[]");
  }) as typeof fetch;
  const c = new GarminClient("KEY", "https://example.test", fetchFn);
  assert.deepEqual(await c.get("/x"), []);
  assert.equal(tokens, 2);
});

test("token error does not leak response body", async () => {
  const fetchFn = (async () => new Response("secret-ish body", { status: 401 })) as typeof fetch;
  const c = new GarminClient("KEY", "https://example.test", fetchFn);
  await assert.rejects(c.get("/x"), (e: Error) => !e.message.includes("secret-ish") && e.message.includes("401"));
});

test("checkRange limits", () => {
  checkRange("2026-11-01", "2026-12-01");
  assert.throws(() => checkRange("2026-11-01", "2026-12-02"));
  assert.throws(() => checkRange("2026-11-02", "2026-11-01"));
});
