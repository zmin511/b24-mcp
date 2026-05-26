import type { DbPool } from "./db.js";

export type BitrixConnectionRow = {
  id: string;
  portal_url: string;
  auth_type: "webhook" | "oauth";
  webhook_url: string | null;
  oauth_access_token_enc: string | null;
  oauth_refresh_token_enc: string | null;
  oauth_expires_at: Date | null;
};

export async function getConnectionById(pool: DbPool, id: string): Promise<BitrixConnectionRow | null> {
  const res = await pool.query(
    `select id, portal_url, auth_type, webhook_url, oauth_access_token_enc, oauth_refresh_token_enc, oauth_expires_at
     from bitrix_connections where id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function upsertConnection(
  pool: DbPool,
  row: Omit<BitrixConnectionRow, "oauth_expires_at"> & { oauth_expires_at: Date | null }
) {
  await pool.query(
    `insert into bitrix_connections
      (id, portal_url, auth_type, webhook_url, oauth_access_token_enc, oauth_refresh_token_enc, oauth_expires_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (id) do update set
       portal_url = excluded.portal_url,
       auth_type = excluded.auth_type,
       webhook_url = excluded.webhook_url,
       oauth_access_token_enc = excluded.oauth_access_token_enc,
       oauth_refresh_token_enc = excluded.oauth_refresh_token_enc,
       oauth_expires_at = excluded.oauth_expires_at,
       updated_at = now()`,
    [
      row.id,
      row.portal_url,
      row.auth_type,
      row.webhook_url,
      row.oauth_access_token_enc,
      row.oauth_refresh_token_enc,
      row.oauth_expires_at
    ]
  );
}

