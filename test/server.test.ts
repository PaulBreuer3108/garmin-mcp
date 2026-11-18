import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fakeJwt } from "./helpers.ts";

test("end to end: MCP client → server → fake Garmin", async (t) => {
  const seen: string[] = [];
  const garmin = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    if (req.url?.startsWith("/personalapitoken-service")) {
      res.end(fakeJwt(Math.floor(Date.now() / 1000) + 86400));
    } else {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ path: req.url }));
    }
  }).listen(0);
  await once(garmin, "listening");
  const gPort = (garmin.address() as { port: number }).port;
  const port = 3900 + Math.floor(Math.random() * 90);
  const secret = "s".repeat(32);
  const proc = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: { ...process.env, PORT: String(port), MCP_SECRET: secret, GARMIN_PERSONAL_API_KEY: "TESTKEY", GARMIN_PERSONAL_API_BASE_URL: `http://127.0.0.1:${gPort}` },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => {
    proc.kill();
    garmin.close();
  });
  await new Promise<void>((resolve) => proc.stdout!.on("data", (d) => String(d).includes("läuft") && resolve()));

  const wrong = await fetch(`http://127.0.0.1:${port}/mcp/nope`, { method: "POST" });
  assert.equal(wrong.status, 404);

  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/${secret}`)));
  const { tools } = await client.listTools();
  assert.ok(tools.length >= 10);
  assert.ok(tools.every((x) => x.annotations?.readOnlyHint === true));

  const r = (await client.callTool({ name: "garmin_hrv", arguments: { date: "2026-11-17" } })) as { content: { text: string }[] };
  assert.deepEqual(JSON.parse(r.content[0].text), { path: "/hrv-service/hrv/2026-11-17" });

  const bad = (await client.callTool({ name: "garmin_stress", arguments: { start_date: "2026-01-01", end_date: "2026-06-01" } })) as { isError?: boolean };
  assert.equal(bad.isError, true);

  assert.match(seen[0], /^POST \/personalapitoken-service.* ApiKey TESTKEY$/);
  assert.match(seen[1], /Bearer /);
  await client.close();
});
