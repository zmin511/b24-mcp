import type { DbPool } from "./db.js";

export async function writeAuditLog(params: {
  pool: DbPool;
  connectionId?: string;
  tool: string;
  risky: boolean;
  actor?: string;
  request: unknown;
  result: unknown;
}) {
  const { pool, connectionId, tool, risky, actor, request, result } = params;
  await pool.query(
    `insert into audit_log(connection_id, tool, risky, actor, request, result)
     values ($1,$2,$3,$4,$5,$6)`,
    [connectionId ?? null, tool, risky, actor ?? null, request, result]
  );
}

