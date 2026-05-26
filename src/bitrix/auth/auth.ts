import type { BitrixConnectionRow } from "../../storage/connections.js";
import { decryptString } from "../../common/crypto.js";
import { AppError } from "../../common/errors.js";

export type BitrixAuth =
  | { type: "webhook"; webhookUrl: string }
  | { type: "oauth"; portalUrl: string; accessToken: string };

export function getAuthForConnection(conn: BitrixConnectionRow, encryptionKeyBase64: string): BitrixAuth {
  if (conn.auth_type === "webhook") {
    if (!conn.webhook_url) throw new AppError("Connection has auth_type=webhook but webhook_url is null", "AUTH");
    return { type: "webhook", webhookUrl: conn.webhook_url };
  }
  if (!conn.oauth_access_token_enc) {
    throw new AppError("Connection has auth_type=oauth but oauth_access_token_enc is null", "AUTH");
  }
  const accessToken = decryptString(conn.oauth_access_token_enc, encryptionKeyBase64);
  return { type: "oauth", portalUrl: conn.portal_url, accessToken };
}

