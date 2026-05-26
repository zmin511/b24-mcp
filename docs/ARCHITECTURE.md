# Architecture plan

## Constraints
- Server can call Bitrix24 REST API.
- Bitrix24 may be unable to send inbound webhooks/callbacks → core design uses polling sync jobs.
- Event subscriptions are optional and not required for correctness.
- Multi-portal support: many Bitrix connections stored in DB.
- All write actions: `confirm=true` + audit log.

## Layers
1. **MCP layer** (`src/mcp`): tool schemas + routing + safety gates.
2. **Modules** (`src/modules/*`): domain services that implement tools.
3. **Bitrix adapter** (`src/bitrix/*`):
   - `auth/`: webhook + oauth (abstracted)
   - `http/`: REST client with retry/rate-limit/pagination
   - `capabilities/`: startup checks (`methods`) + per-connection flags
4. **Storage** (`src/storage`): Postgres pool + migrations + repositories.
5. **Jobs** (`src/jobs`): polling sync and incremental hydration.
6. **Common** (`src/common`): config, logging, crypto, errors, audit helpers.

## Sync model
- `sync_jobs`: stores job state per connection and job type.
- Incremental sync:
  - list tasks by `changedDate` (or comparable field) since last cursor
  - hydrate each task via `tasks.task.get`
  - if `chat.id` exists → fetch messages via `im.dialog.messages.get`
  - persist to:
    - `tasks` (current snapshot)
    - `task_snapshots` (history)
    - `task_messages` (normalized unified model)

## Audit & safety
- MCP tool wrapper checks:
  - `confirm=true` required for tool marked `risky`
  - deny unconfirmed writes unless `ALLOW_UNCONFIRMED_WRITES=true`
- Each write emits `audit_log` with:
  - tool name
  - connection id
  - actor (from MCP request metadata if present)
  - request summary (redacted)
  - response summary

