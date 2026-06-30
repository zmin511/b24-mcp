import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./common/config.js";
import { createLogger } from "./common/logger.js";
import { createPool } from "./storage/db.js";
import { createMcpServer } from "./mcp/server.js";
import type { RequestAuth } from "./mcp/server.js";
import { runMigrations } from "./storage/migrate.js";
import { findMcpAccessToken } from "./storage/mcpAccessTokens.js";
import { createOAuthState, consumeOAuthState } from "./storage/oauthStates.js";
import { upsertConnection } from "./storage/connections.js";
import { upsertMcpAccessToken } from "./storage/mcpAccessTokens.js";
import { encryptString } from "./common/crypto.js";
import {
  buildBitrixAuthorizeUrl,
  exchangeBitrixOAuthCode,
  getBitrixTokenExpiresAt,
  getPortalUrlFromOAuth,
  randomUrlToken
} from "./bitrix/oauth/service.js";
import { BitrixRestClient } from "./bitrix/http/client.js";

type AuthedRequest = express.Request & { auth?: RequestAuth };

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function extractMcpToken(req: express.Request): { token?: string; source: string } {
  const pathTokenMatch = req.path.match(/^\/t\/([^/]+)\/mcp$/);
  if (pathTokenMatch?.[1]) {
    return { token: decodeURIComponent(pathTokenMatch[1]), source: "path-token" };
  }

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

function isMcpRequestPath(pathname: string): boolean {
  return pathname === "/mcp" || /^\/t\/[^/]+\/mcp$/.test(pathname);
}

function redactMcpPath(pathname: string): string {
  return pathname.replace(/^\/t\/[^/]+\/mcp$/, "/t/[REDACTED]/mcp");
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

function requireOAuthConfig(config: ReturnType<typeof loadConfig>) {
  const missing = [
    ["BITRIX_OAUTH_PORTAL_URL", config.BITRIX_OAUTH_PORTAL_URL],
    ["BITRIX_OAUTH_CLIENT_ID", config.BITRIX_OAUTH_CLIENT_ID],
    ["BITRIX_OAUTH_CLIENT_SECRET", config.BITRIX_OAUTH_CLIENT_SECRET],
    ["BITRIX_OAUTH_REDIRECT_URI", config.BITRIX_OAUTH_REDIRECT_URI],
    ["APP_ENCRYPTION_KEY_BASE64", config.APP_ENCRYPTION_KEY_BASE64]
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing OAuth config: ${missing.map(([name]) => name).join(", ")}`);
  }
}

function sanitizeIdPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function htmlResponse(title: string, body: string) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 760px; margin: 48px auto; padding: 0 20px; line-height: 1.5; }
    code, pre { background: #f4f4f5; border-radius: 6px; padding: 2px 6px; }
    pre { padding: 16px; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}


function getPublicBaseUrlFromRedirectUri(redirectUri: string): string {
  const url = new URL(redirectUri);
  url.pathname = url.pathname.replace(/\/oauth\/bitrix\/callback$/, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
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

  app.get("/oauth/bitrix/start", async (req, res) => {
    try {
      requireOAuthConfig(config);
      const state = randomUrlToken(24);
      const label = typeof req.query.label === "string" ? req.query.label : undefined;
      const portalUrl =
        typeof req.query.portal_url === "string" && req.query.portal_url
          ? req.query.portal_url
          : config.BITRIX_OAUTH_PORTAL_URL;

      await createOAuthState({
        pool,
        state,
        provider: "bitrix",
        portalUrl,
        label,
        ttlMinutes: 15
      });

      res.redirect(
        buildBitrixAuthorizeUrl({
          portalUrl,
          clientId: config.BITRIX_OAUTH_CLIENT_ID,
          redirectUri: config.BITRIX_OAUTH_REDIRECT_URI,
          state
        })
      );
    } catch (err) {
      logger.error({ err }, "bitrix_oauth_start_failed");
      res.status(500).send(htmlResponse("OAuth error", `<h1>OAuth error</h1><p>${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`));
    }
  });

  app.get("/oauth/bitrix/callback", async (req, res) => {
    try {
      requireOAuthConfig(config);
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !state) {
        res.status(400).send(htmlResponse("OAuth error", "<h1>OAuth error</h1><p>Missing code or state.</p>"));
        return;
      }

      const stateRow = await consumeOAuthState(pool, state, "bitrix");
      if (!stateRow) {
        res.status(400).send(htmlResponse("OAuth error", "<h1>OAuth error</h1><p>OAuth state is invalid, expired, or already used.</p>"));
        return;
      }

      const token = await exchangeBitrixOAuthCode({
        clientId: config.BITRIX_OAUTH_CLIENT_ID,
        clientSecret: config.BITRIX_OAUTH_CLIENT_SECRET,
        redirectUri: config.BITRIX_OAUTH_REDIRECT_URI,
        code
      });

      const portalUrl = getPortalUrlFromOAuth(token, stateRow.portal_url);
      const tempClient = new BitrixRestClient({
        logger,
        auth: { type: "oauth", portalUrl, accessToken: token.access_token }
      });

      let profile: any = null;
      try {
        const profileRes = await tempClient.call<any>("profile", {});
        profile = profileRes.result ?? profileRes;
      } catch (err) {
        logger.warn({ err }, "bitrix_oauth_profile_failed");
      }

      const bitrixUserId = Number(profile?.ID ?? profile?.id ?? token.user_id);
      const actorName =
        [profile?.NAME ?? profile?.name, profile?.LAST_NAME ?? profile?.lastName].filter(Boolean).join(" ").trim() ||
        stateRow.label ||
        `Bitrix user ${Number.isFinite(bitrixUserId) ? bitrixUserId : "unknown"}`;
      const connectionId = `oauth-${sanitizeIdPart(token.member_id ?? new URL(portalUrl).hostname)}-${Number.isFinite(bitrixUserId) ? bitrixUserId : randomUrlToken(6)}`;
      const mcpToken = `b24mcp_${randomUrlToken(32)}`;
      const mcpTokenId = `${connectionId}-gpt`;

      await upsertConnection(pool, {
        id: connectionId,
        portal_url: portalUrl,
        auth_type: "oauth",
        webhook_url: null,
        oauth_access_token_enc: encryptString(token.access_token, config.APP_ENCRYPTION_KEY_BASE64),
        oauth_refresh_token_enc: token.refresh_token ? encryptString(token.refresh_token, config.APP_ENCRYPTION_KEY_BASE64) : null,
        oauth_expires_at: getBitrixTokenExpiresAt(token)
      });

      await upsertMcpAccessToken({
        pool,
        id: mcpTokenId,
        token: mcpToken,
        label: stateRow.label ?? `${actorName} GPT connector`,
        actorName,
        bitrixConnectionId: connectionId,
        bitrixUserId: Number.isFinite(bitrixUserId) ? bitrixUserId : null,
        active: true
      });

      res.send(
        htmlResponse(
          "Bitrix OAuth connected",
          `<h1>Bitrix авторизация готова</h1>
<p>Подключение создано для: <strong>${escapeHtml(actorName)}</strong>.</p>

<h2>Рекомендуемый личный режим</h2>
<p>Используй общий MCP URL и свой персональный ключ. Так один опубликованный коннектор может быть общим, а каждый сотрудник работает от своей Bitrix-авторизации.</p>
<p><strong>MCP URL:</strong></p>
<pre>${escapeHtml(new URL("mcp", getPublicBaseUrlFromRedirectUri(config.BITRIX_OAUTH_REDIRECT_URI)).toString())}</pre>
<p><strong>Authorization Bearer token:</strong></p>
<pre>${escapeHtml(mcpToken)}</pre>

<h2>Важно</h2>
<ul>
  <li>Этот token персональный. Не публикуй его в задачах, комментариях, описаниях коннекторов и общих инструкциях.</li>
  <li>Кто знает этот token, тот может использовать Bitrix MCP от имени: <strong>${escapeHtml(actorName)}</strong>.</li>
  <li>Сервер показывает token только один раз. Сохрани его в настройках личного коннектора.</li>
</ul>

<h2>Legacy/service режим</h2>
<p>Старый формат URL с token в пути оставлен только для совместимости и сервисных коннекторов вроде service user:</p>
<pre>${escapeHtml(new URL(`t/${mcpToken}/mcp`, getPublicBaseUrlFromRedirectUri(config.BITRIX_OAUTH_REDIRECT_URI)).toString())}</pre>`
        )
      );
    } catch (err) {
      logger.error({ err }, "bitrix_oauth_callback_failed");
      res.status(500).send(htmlResponse("OAuth error", `<h1>OAuth error</h1><p>${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`));
    }
  });

  app.use(async (req, res, next) => {
    const rpcMethod = req.body?.method;
    const discovery = isDiscoveryRequest(req);

    if (req.path === "/healthz") {
      return next();
    }

    if (isMcpRequestPath(req.path) && ["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      logger.info(
        {
          method: req.method,
          path: redactMcpPath(req.path),
          rpcMethod,
          authSkippedForDiscovery: true
        },
        "MCP auth bypass/discovery"
      );
      return next();
    }

    if (discovery) {
      logger.info(
        {
          method: req.method,
          path: redactMcpPath(req.path),
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
        path: redactMcpPath(req.path),
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

  app.all(/^\/(?:t\/[^/]+\/)?mcp$/, async (req, res) => {
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
