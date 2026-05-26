-- 0001_init.sql
-- idempotent init for MVP

create extension if not exists pgcrypto;

create table if not exists bitrix_connections (
  id text primary key,
  portal_url text not null,
  auth_type text not null check (auth_type in ('webhook','oauth')),
  webhook_url text,
  oauth_access_token_enc text,
  oauth_refresh_token_enc text,
  oauth_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sync_jobs (
  id bigserial primary key,
  connection_id text not null references bitrix_connections(id) on delete cascade,
  job_type text not null,
  cursor_json jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, job_type)
);

create table if not exists users_cache (
  connection_id text not null references bitrix_connections(id) on delete cascade,
  user_id bigint not null,
  name text,
  email text,
  raw jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, user_id)
);

create table if not exists tasks (
  connection_id text not null references bitrix_connections(id) on delete cascade,
  task_id bigint not null,
  title text,
  description text,
  status integer,
  created_date timestamptz,
  changed_date timestamptz,
  status_changed_date timestamptz,
  closed_date timestamptz,
  deadline timestamptz,
  creator_id bigint,
  responsible_id bigint,
  group_id bigint,
  parent_id bigint,
  priority integer,
  tags text[],
  crm_links jsonb,
  chat_id text,
  comments_count integer,
  normalized jsonb not null,
  raw jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, task_id)
);
create index if not exists idx_tasks_changed_date on tasks (connection_id, changed_date desc);

create table if not exists task_snapshots (
  id bigserial primary key,
  connection_id text not null references bitrix_connections(id) on delete cascade,
  task_id bigint not null,
  captured_at timestamptz not null default now(),
  normalized jsonb not null,
  raw jsonb not null
);
create index if not exists idx_task_snapshots_task on task_snapshots (connection_id, task_id, captured_at desc);

create table if not exists task_messages (
  id bigserial primary key,
  connection_id text not null references bitrix_connections(id) on delete cascade,
  task_id bigint not null,
  source text not null check (source in ('chat','legacy')),
  message_id text not null,
  author_id bigint,
  created_at timestamptz,
  text text,
  raw jsonb not null
);
create unique index if not exists ux_task_messages on task_messages (connection_id, task_id, source, message_id);
create index if not exists idx_task_messages_created on task_messages (connection_id, task_id, created_at desc);

create table if not exists task_results (
  id bigserial primary key,
  connection_id text not null references bitrix_connections(id) on delete cascade,
  task_id bigint not null,
  result_id text not null,
  created_at timestamptz,
  created_by bigint,
  text text,
  raw jsonb not null
);
create unique index if not exists ux_task_results on task_results (connection_id, task_id, result_id);

create table if not exists task_checklists (
  id bigserial primary key,
  connection_id text not null references bitrix_connections(id) on delete cascade,
  task_id bigint not null,
  item_id bigint not null,
  title text,
  is_complete boolean,
  sort integer,
  raw jsonb not null,
  updated_at timestamptz not null default now(),
  unique (connection_id, task_id, item_id)
);

create table if not exists disk_objects (
  connection_id text not null references bitrix_connections(id) on delete cascade,
  object_id bigint not null,
  object_type text not null check (object_type in ('storage','folder','file')),
  parent_id bigint,
  name text,
  raw jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, object_type, object_id)
);

create table if not exists kb_sites (
  connection_id text not null references bitrix_connections(id) on delete cascade,
  site_id bigint not null,
  title text,
  raw jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, site_id)
);

create table if not exists kb_pages (
  connection_id text not null references bitrix_connections(id) on delete cascade,
  page_id bigint not null,
  site_id bigint,
  title text,
  raw jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, page_id)
);

create table if not exists bizproc_templates (
  connection_id text not null references bitrix_connections(id) on delete cascade,
  template_id bigint not null,
  name text,
  raw jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, template_id)
);

create table if not exists bizproc_instances (
  connection_id text not null references bitrix_connections(id) on delete cascade,
  instance_id text not null,
  template_id bigint,
  state text,
  raw jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, instance_id)
);

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  connection_id text,
  tool text not null,
  risky boolean not null default false,
  actor text,
  request jsonb,
  result jsonb
);
create index if not exists idx_audit_log_at on audit_log (at desc);

