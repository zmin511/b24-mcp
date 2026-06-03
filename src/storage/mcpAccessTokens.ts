import crypto from "node:crypto";
import type { DbPool } from "./db.js";

export type McpAccessTokenRow = {
  id: string;
  token_hash: string;
  label: string;
  bitrix_connection_id: string;
  bitrix_user_id: number | null;
  actor_name: string | null;
  active: boolean;
};

export function hashMcpAccessToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export async function findMcpAccessToken(pool: DbPool, token: string): Promise<McpAccessTokenRow | null> {
  const tokenHash = hashMcpAccessToken(token);
  const res = await pool.query(
    `select id, token_hash, label, bitrix_connection_id, bitrix_user_id, actor_name, active
     from mcp_access_tokens
     where token_hash = $1 and active = true`,
    [tokenHash]
  );

  const row = res.rows[0] ?? null;
  if (row) {
    await pool.query("update mcp_access_tokens set last_used_at = now() where id = $1", [row.id]);
  }
  return row;
}

export async function upsertMcpAccessToken(params: {
  pool: DbPool;
  id: string;
  token: string;
  label: string;
  bitrixConnectionId: string;
  bitrixUserId?: number | null;
  actorName?: string | null;
  active?: boolean;
}) {
  const tokenHash = hashMcpAccessToken(params.token);
  await params.pool.query(
    `insert into mcp_access_tokens
      (id, token_hash, label, bitrix_connection_id, bitrix_user_id, actor_name, active, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (id) do update set
       token_hash = excluded.token_hash,
       label = excluded.label,
       bitrix_connection_id = excluded.bitrix_connection_id,
       bitrix_user_id = excluded.bitrix_user_id,
       actor_name = excluded.actor_name,
       active = excluded.active,
       updated_at = now()`,
    [
      params.id,
      tokenHash,
      params.label,
      params.bitrixConnectionId,
      params.bitrixUserId ?? null,
      params.actorName ?? null,
      params.active ?? true
    ]
  );
}

