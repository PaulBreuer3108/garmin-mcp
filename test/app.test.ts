import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fakeJwt } from "./helpers.ts";

test("progress app: login, dashboard, refresh", async (t) => {
  const seen: string[] = [];
  const garmin = createServer((req, res) => {
    seen.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/personalapitoken-service")) return res.end(fakeJwt(Math.floor(Date.now() / 1000) + 86400));
    if (req.url?.startsWith("/activitylist-service")) {
      const today = new Date().toISOString().slice(0, 10);
      return res.end(JSON.stringify(req.url.includes("start=0") ? [
        { activityId: 7, activityName: "Testlauf", startTimeLocal: `${today} 07:00:00`, activityType: { typeKey: "running" }, duration: 1800, distance: 5000 },
      ] : []));
    }
    if (req.url?.startsWith("/hrv-service")) return res.end(JSON.stringify({ hrvSummaries: [{ calendarDate: "2026-11-17", lastNightAvg: 70, status: "BALANCED" }] }));
    if (req.url?.startsWith("/usersummary-service")) return res.end(JSON.stringify({ data: [{ calendarDate: "2026-11-17", heartRate: { restingValue: 46 } }] }));
    res.end("null");
  }).listen(0);
  await once(garmin, "listening");
  const gPort = (garmin.address() as { port: number }).port;
  const port = 3800 + Math.floor(Math.random() * 90);
  const proc = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: { ...process.env, PORT: String(port), MCP_SECRET: "s".repeat(32), APP_PASSWORD: "richtig-gut", GARMIN_PERSONAL_API_KEY: "TESTKEY", GARMIN_PERSONAL_API_BASE_URL: `http://127.0.0.1:${gPort}` },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => {
    proc.kill();
    garmin.close();
  });
  await new Promise<void>((resolve) => proc.stdout!.on("data", (d) => String(d).includes("läuft") && resolve()));
  const base = `http://127.0.0.1:${port}/app`;

  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Road to Maastricht/);
  assert.doesNotMatch(html, /TESTKEY/);

  assert.equal((await fetch(base + "/api/dashboard")).status, 401);
  const wrong = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "falsch" }) });
  assert.equal(wrong.status, 401);
  assert.equal((await fetch(base + "/api/dashboard", { headers: { cookie: "app_session=123.abc" } })).status, 401);

  const ok = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "richtig-gut" }) });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("set-cookie")!.split(";")[0];
  assert.match(ok.headers.get("set-cookie")!, /HttpOnly/i);

  const dash = await fetch(base + "/api/dashboard", { headers: { cookie } });
  assert.equal(dash.status, 200);
  const body = await dash.text();
  assert.doesNotMatch(body, /TESTKEY/);
  const d = JSON.parse(body);
  assert.equal(d.plan.length, 41);
  assert.equal(d.recent[0].name, "Testlauf");
  assert.ok(d.days.some((x: { hrv: number }) => x.hrv === 70));

  const fetchesBefore = seen.filter((u) => u.startsWith("/activitylist")).length;
  await fetch(base + "/api/dashboard", { headers: { cookie } });
  assert.equal(seen.filter((u) => u.startsWith("/activitylist")).length, fetchesBefore, "second load comes from the cache");
});
