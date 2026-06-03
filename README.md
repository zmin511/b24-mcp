# Bitrix24 MCP Server (MVP)

Production-ready MVP MCP server for Bitrix24 with:
- Official Bitrix24 REST API client (rate limit + retry, pagination helpers)
- Abstract auth (Incoming Webhook now; OAuth storage scaffolded)
- Polling sync jobs (no inbound callbacks required)
- Local PostgreSQL reporting DB (tasks, messages, snapshots, audit log)
- MCP tools for tasks, disk, knowledge base (landing), bizproc

## What you get first (per spec)
- Architectural plan: `docs/ARCHITECTURE.md`
- REST method map: `docs/REST_METHODS.md`
- SQL schema (tables + indexes): `docs/SCHEMA.sql`
- Project structure: `docs/STRUCTURE.md`

## Quick start (docker-compose)
1. Copy env:
   - `cp .env.example .env`
2. Start Postgres:
   - `docker compose up -d db`
3. Run migrations:
   - `docker compose run --rm app npm run migrate:dev`
4. Run MCP server (HTTP on `/mcp`):
   - `docker compose up -d app`
   - Health check: `GET http://localhost:7010/healthz`

## Bitrix connections
This MVP stores connections in Postgres (`bitrix_connections`). Add one connection with a webhook:
- Tool: `bitrix_connection_upsert` (requires `confirm=true`)
- Per-user MCP tokens can be mapped to personal Bitrix connections; see `docs/AUTH.md`.
- Self-service Bitrix OAuth login is available; see `docs/BITRIX_OAUTH_SETUP.md`.

## Deploy on Ubuntu (example: your-mcp-domain.example.com)
- Run with docker-compose, expose port `7010` to localhost only, then proxy via Nginx/Caddy to `https://your-mcp-domain.example.com/b24/mcp`
- Set `MCP_AUTH_TOKEN` and require `Authorization: Bearer ...` from your GPT agent client.

## Safety
- All write tools require `confirm=true` (or set `ALLOW_UNCONFIRMED_WRITES=true` for dev only).
- Every write tool emits `audit_log` record (no secrets).

## Development
- Tests: `npm test`
- Seed examples: `npm run seed:toolcalls`

## Known Bitrix24 caveats (implemented)
- Task comments for the **new** task card are read from the task chat: `tasks.task.get -> chat.id -> im.dialog.messages.get`
- Legacy fallback for old tasks: `task.commentitem.getlist` (deprecated)
