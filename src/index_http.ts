import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./common/config.js";
import { createLogger } from "./common/logger.js";
import { createPool } from "./storage/db.js";
import { createMcpServer } from "./mcp/server.js";
import { runMigrations } from "./storage/migrate.js";

type AuthedRequest = express.Request & { auth?: { token?: string } };

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const pool = createPool(config.DATABASE_URL);

  await runMigrations();

  const { server } = createMcpServer({ config, logger, pool });

  if (!config.MCP_HTTP_ENABLED) {
    throw new Error("MCP_HTTP_ENABLED=false; nothing to do in index_http");
  }

  const app = createMcpExpressApp({ host: config.MCP_HTTP_HOST });

  // Optional bearer auth
  app.use((req, res, next) => {
    if (!config.MCP_AUTH_TOKEN) return next();
    const h = req.headers.authorization ?? "";
    const m = /^Bearer\\s+(.+)$/i.exec(h);
    if (!m || m[1] !== config.MCP_AUTH_TOKEN) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    (req as AuthedRequest).auth = { token: "ok" };
    next();
  });

  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  const transport = new StreamableHTTPServerTransport({
    // Stateless mode: no server-side sessions required for MVP.
    sessionIdGenerator: undefined
  });

  await server.connect(transport as any);

  app.post("/mcp", async (req, res) => {
    await transport.handleRequest(req as any, res as any, req.body);
  });
  app.get("/mcp", async (req, res) => {
    await transport.handleRequest(req as any, res as any);
  });

  app.listen(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST, () => {
    logger.info(
      { host: config.MCP_HTTP_HOST, port: config.MCP_HTTP_PORT },
      "MCP server started (streamable HTTP) on /mcp"
    );
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

