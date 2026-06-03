import type { Logger } from "../common/logger.js";
import type { DbPool } from "../storage/db.js";
import { getConnectionById, updateConnectionOAuthTokens, type BitrixConnectionRow } from "../storage/connections.js";
import { AppError } from "../common/errors.js";
import { getAuthForConnection } from "./auth/auth.js";
import { BitrixRestClient } from "./http/client.js";
import { detectCapabilities, type BitrixCapabilities } from "./capabilities/detect.js";
import { decryptString, encryptString } from "../common/crypto.js";
import { getBitrixTokenExpiresAt, refreshBitrixOAuthToken } from "./oauth/service.js";

async function refreshOAuthIfNeeded(params: {
  pool: DbPool;
  logger: Logger;
  conn: BitrixConnectionRow;
  encryptionKeyBase64: string;
  clientId: string;
  clientSecret: string;
}): Promise<BitrixConnectionRow> {
  const { conn } = params;
  if (conn.auth_type !== "oauth") return conn;
  if (!conn.oauth_refresh_token_enc) return conn;
  if (!params.clientId || !params.clientSecret) return conn;

  const expiresAt = conn.oauth_expires_at?.getTime() ?? 0;
  const shouldRefresh = !expiresAt || expiresAt < Date.now() + 5 * 60 * 1000;
  if (!shouldRefresh) return conn;

  const refreshToken = decryptString(conn.oauth_refresh_token_enc, params.encryptionKeyBase64);
  const refreshed = await refreshBitrixOAuthToken({
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    refreshToken
  });

  const nextAccessTokenEnc = encryptString(refreshed.access_token, params.encryptionKeyBase64);
  const nextRefreshTokenEnc = refreshed.refresh_token
    ? encryptString(refreshed.refresh_token, params.encryptionKeyBase64)
    : null;
  const nextExpiresAt = getBitrixTokenExpiresAt(refreshed);

  await updateConnectionOAuthTokens(params.pool, conn.id, {
    accessTokenEnc: nextAccessTokenEnc,
    refreshTokenEnc: nextRefreshTokenEnc,
    expiresAt: nextExpiresAt
  });

  params.logger.info({ connectionId: conn.id }, "bitrix_oauth_token_refreshed");

  return {
    ...conn,
    oauth_access_token_enc: nextAccessTokenEnc,
    oauth_refresh_token_enc: nextRefreshTokenEnc ?? conn.oauth_refresh_token_enc,
    oauth_expires_at: nextExpiresAt
  };
}

export async function createBitrixClientForConnection(params: {
  pool: DbPool;
  logger: Logger;
  connectionId: string;
  encryptionKeyBase64: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}): Promise<{ client: BitrixRestClient; capabilities: BitrixCapabilities }> {
  const foundConn = await getConnectionById(params.pool, params.connectionId);
  if (!foundConn) throw new AppError(`Bitrix connection '${params.connectionId}' not found`, "CONNECTION_NOT_FOUND", { status: 404 });

  const conn = await refreshOAuthIfNeeded({
    pool: params.pool,
    logger: params.logger,
    conn: foundConn,
    encryptionKeyBase64: params.encryptionKeyBase64,
    clientId: params.oauthClientId ?? process.env.BITRIX_OAUTH_CLIENT_ID ?? "",
    clientSecret: params.oauthClientSecret ?? process.env.BITRIX_OAUTH_CLIENT_SECRET ?? ""
  });
  const auth = getAuthForConnection(conn, params.encryptionKeyBase64);
  const client = new BitrixRestClient({ logger: params.logger, auth });
  const capabilities = await detectCapabilities(client);
  return { client, capabilities };
}
