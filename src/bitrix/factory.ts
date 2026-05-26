import type { Logger } from "../common/logger.js";
import type { DbPool } from "../storage/db.js";
import { getConnectionById } from "../storage/connections.js";
import { AppError } from "../common/errors.js";
import { getAuthForConnection } from "./auth/auth.js";
import { BitrixRestClient } from "./http/client.js";
import { detectCapabilities, type BitrixCapabilities } from "./capabilities/detect.js";

export async function createBitrixClientForConnection(params: {
  pool: DbPool;
  logger: Logger;
  connectionId: string;
  encryptionKeyBase64: string;
}): Promise<{ client: BitrixRestClient; capabilities: BitrixCapabilities }> {
  const conn = await getConnectionById(params.pool, params.connectionId);
  if (!conn) throw new AppError(`Bitrix connection '${params.connectionId}' not found`, "CONNECTION_NOT_FOUND", { status: 404 });

  const auth = getAuthForConnection(conn, params.encryptionKeyBase64);
  const client = new BitrixRestClient({ logger: params.logger, auth });
  const capabilities = await detectCapabilities(client);
  return { client, capabilities };
}

