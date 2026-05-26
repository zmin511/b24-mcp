import type { DbPool } from "./db.js";

export type SyncJobCursor = Record<string, unknown>;

export async function getSyncJob(pool: DbPool, connectionId: string, jobType: string) {
  const res = await pool.query(
    `select id, cursor_json, last_run_at from sync_jobs where connection_id=$1 and job_type=$2`,
    [connectionId, jobType]
  );
  return res.rows[0] ?? null;
}

export async function upsertSyncJob(pool: DbPool, connectionId: string, jobType: string, cursor: SyncJobCursor) {
  await pool.query(
    `insert into sync_jobs(connection_id, job_type, cursor_json, last_run_at, updated_at)
     values ($1,$2,$3, now(), now())
     on conflict(connection_id, job_type) do update set cursor_json=excluded.cursor_json, last_run_at=excluded.last_run_at, updated_at=now()`,
    [connectionId, jobType, cursor]
  );
}

