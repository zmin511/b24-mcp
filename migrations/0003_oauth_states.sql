-- 0003_oauth_states.sql
-- One-time OAuth state values for Bitrix24 self-service login.

create table if not exists oauth_states (
  state text primary key,
  provider text not null,
  portal_url text not null,
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists idx_oauth_states_expires_at
  on oauth_states (expires_at);

