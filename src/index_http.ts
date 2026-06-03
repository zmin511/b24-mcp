import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./common/config.js";
import { createLogger } from "./common/logger.js";
import { createPool } from "./storage/db.js";
import { createMcpServer } from "./mcp/server.js";
import type { RequestAuth } from "./mcp/server.js";
import { runMigrations } from "./storage/migrate.js";
import { findMcpAccessToken } from "./storage/mcpAccessTokens.js";

type AuthedRequest = express.Request & { auth?: RequestAuth };

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function extractMcpToken(req: express.Request): { token?: string; source: string } {
  const authorization = getHeaderValue(req.headers.authorization);

  if (authorization) {
    const trimmed = authorization.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      return { token: trimmed.slice(7).trim(), source: "authorization" };
    }
    return { token: trimmed, source: "authorization" };
  }

  const headerCandidates: Array<[string, string | undefined]> = [
    ["x-api-key", getHeaderValue(req.headers["x-api-key"])],
    ["api-key", getHeaderValue(req.headers["api-key"])],
    ["apikey", getHeaderValue(req.headers["apikey"])],
    ["openai-api-key", getHeaderValue(req.headers["openai-api-key"])],
    ["x-mcp-token", getHeaderValue(req.headers["x-mcp-token"])]
  ];

  for (const [source, value] of headerCandidates) {
    const token = value?.trim();
    if (token) return { token, source };
  }

  return { source: "none" };
}

function isDiscoveryRequest(req: express.Request): boolean {
  const rpcMethod = req.body?.method;
  return (
    req.method === "POST" &&
    (
      rpcMethod === "initialize" ||
      rpcMethod === "tools/list" ||
      rpcMethod === "resources/list" ||
      rpcMethod === "ping" ||
      rpcMethod === "notifications/initialized"
    )
  );
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const pool = createPool(config.DATABASE_URL);

  await runMigrations();

  if (!config.MCP_HTTP_ENABLED) {
    throw new Error("MCP_HTTP_ENABLED=false; nothing to do in index_http");
  }

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.use(async (req, res, next) => {
    const rpcMethod = req.body?.method;
    const discovery = isDiscoveryRequest(req);

    if (req.path === "/healthz") {
      return next();
    }

    if (discovery) {
      logger.info(
        {
          method: req.method,
          path: req.path,
          rpcMethod,
          authSkippedForDiscovery: true
        },
        "MCP auth bypass/discovery"
      );
      return next();
    }

    const { token: providedToken, source: tokenSource } = extractMcpToken(req);

    logger.info(
      {
        method: req.method,
        path: req.path,
        rpcMethod,
        tokenSource,
        providedTokenLength: providedToken?.length ?? 0,
        hasAuthorization: Boolean(req.headers.authorization),
        hasXApiKey: Boolean(req.headers["x-api-key"]),
        hasApiKey: Boolean(req.headers["api-key"]),
        hasOpenaiApiKey: Boolean(req.headers["openai-api-key"]),
        hasXMcpToken: Boolean(req.headers["x-mcp-token"])
      },
      "MCP auth debug"
    );

    try {
      if (providedToken && config.MCP_AUTH_TOKEN && providedToken === config.MCP_AUTH_TOKEN) {
        (req as AuthedRequest).auth = { kind: "admin", tokenSource, actor: "admin-token" };
        return next();
      }

      if (providedToken) {
        const tokenRow = await findMcpAccessToken(pool, providedToken);
        if (tokenRow) {
          (req as AuthedRequest).auth = {
            kind: "user",
            tokenSource,
            connectionId: tokenRow.bitrix_connection_id,
            actor: tokenRow.actor_name ?? tokenRow.label,
            accessTokenId: tokenRow.id,
            bitrixUserId: tokenRow.bitrix_user_id ?? undefined
          };
          return next();
        }
      }

      res.status(401).json({ error: "unauthorized" });
      return;
    } catch (err) {
      logger.error({ err }, "MCP auth failed");
      res.status(500).json({ error: "auth_failed" });
      return;
    }
  });

  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  app.all("/mcp", async (req, res) => {
    try {
      const { server } = createMcpServer({ config, logger, pool, requestAuth: (req as AuthedRequest).auth });

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });

      await server.connect(transport as any);

      if (req.method === "GET") {
        await transport.handleRequest(req as any, res as any);
        return;
      }

      await transport.handleRequest(req as any, res as any, req.body);
    } catch (err) {
      logger.error({ err }, "MCP /mcp failed");
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "MCP /mcp failed", message: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  app.listen(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST, () => {
    logger.info(
      { host: config.MCP_HTTP_HOST, port: config.MCP_HTTP_PORT },
      "MCP server started (streamable HTTP) on /mcp"
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
