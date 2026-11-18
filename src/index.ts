import { timingSafeEqual, createHash } from "node:crypto";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { GarminClient, DEFAULT_BASE_URL } from "./garmin.js";
import { registerTools } from "./tools.js";

const apiKey = process.env.GARMIN_PERSONAL_API_KEY ?? "";
const secret = process.env.MCP_SECRET ?? "";
const port = Number(process.env.PORT ?? 3000);

if (!apiKey) {
  console.error("GARMIN_PERSONAL_API_KEY fehlt. Beim Hosting als Umgebungsvariable eintragen.");
  process.exit(1);
}
if (secret.length < 24) {
  console.error("MCP_SECRET fehlt oder ist kürzer als 24 Zeichen. Erzeugen z. B. mit: openssl rand -hex 32");
  process.exit(1);
}

const garmin = new GarminClient(apiKey, process.env.GARMIN_PERSONAL_API_BASE_URL || DEFAULT_BASE_URL);

const digest = (s: string) => createHash("sha256").update(s).digest();
const secretDigest = digest(secret);
function secretMatches(candidate: unknown): boolean {
  return typeof candidate === "string" && timingSafeEqual(digest(candidate), secretDigest);
}

// Bind to all interfaces: hosting platforms route traffic through their own proxy.
const app = createMcpExpressApp({ host: "0.0.0.0" });

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// The connector URL is https://<host>/mcp/<MCP_SECRET>. Wrong or missing secret → 404.
app.all("/mcp/:secret", async (req: Request, res: Response) => {
  if (!secretMatches(req.params.secret)) {
    res.status(404).end();
    return;
  }
  if (req.method !== "POST") {
    // Stateless server: no SSE stream for GET, no sessions to DELETE.
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
    return;
  }
  const server = new McpServer({ name: "garmin-personal", version: "0.1.0" });
  registerTools(server, garmin);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err instanceof Error ? err.message : err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
});

app.listen(port, () => {
  console.log(`garmin-mcp läuft auf Port ${port}`);
});
