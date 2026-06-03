import type { DbPool } from "./db.js";

export type OAuthStateRow = {
  state: string;
  provider: string;
  portal_url: string;
  label: string | null;
  expires_at: Date;
  consumed_at: Date | null;
};

export async function createOAuthState(params: {
  pool: DbPool;
  state: string;
  provider: string;
  portalUrl: string;
  label?: string;
  ttlMinutes?: number;
}) {
  const ttlMinutes = params.ttlMinutes ?? 15;
  await params.pool.query(
    `insert into oauth_states(state, provider, portal_url, label, expires_at)
     values ($1,$2,$3,$4, now() + ($5::text || ' minutes')::interval)`,
    [params.state, params.provider, params.portalUrl, params.label ?? null, ttlMinutes]
  );
}

export async function consumeOAuthState(pool: DbPool, state: string, provider: string): Promise<OAuthStateRow | null> {
  const res = await pool.query(
    `update oauth_states
     set consumed_at = now()
     where state = $1
       and provider = $2
       and consumed_at is null
       and expires_at > now()
     returning state, provider, portal_url, label, expires_at, consumed_at`,
    [state, provider]
  );
  return res.rows[0] ?? null;
}

