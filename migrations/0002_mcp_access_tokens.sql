-- 0002_mcp_access_tokens.sql
-- Per-user MCP access tokens mapped to Bitrix24 connections.

create table if not exists mcp_access_tokens (
  id text primary key,
  token_hash text not null unique,
  label text not null,
  bitrix_connection_id text not null references bitrix_connections(id) on delete cascade,
  bitrix_user_id bigint,
  actor_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_mcp_access_tokens_connection
  on mcp_access_tokens (bitrix_connection_id);

create index if not exists idx_mcp_access_tokens_active
  on mcp_access_tokens (active);

