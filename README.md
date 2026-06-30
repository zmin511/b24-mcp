# Bitrix24 MCP OAuth Server

## RU: Назначение

Bitrix24 MCP OAuth Server — это MCP-сервер для подключения ChatGPT/агентов к Bitrix24 через REST API.

Сервер поддерживает две модели подключения:

1. **Personal connector mode** — рекомендуемый режим для сотрудников.
2. **Legacy/service connector mode** — режим совместимости для сервисных пользователей и технических агентов.

Основная идея новой модели: можно опубликовать один общий MCP-коннектор, а каждый пользователь подключает его со своим личным `<MCP_ACCESS_TOKEN>` токеном. Запросы идут от того Bitrix OAuth-пользователя, чей токен был введён.

---

## RU: Рекомендуемый режим подключения

Для общего опубликованного коннектора используйте:

- MCP URL: `<MCP_BASE_URL>/mcp`
- Auth: `API key / custom header`
- Header: `x-api-key`
- Value: личный `<MCP_ACCESS_TOKEN>` токен пользователя

Логика работы:

- каждый сотрудник подключает один и тот же опубликованный коннектор;
- при подключении сотрудник вводит свой личный токен;
- сервер определяет владельца токена и выполняет запросы через соответствующее Bitrix OAuth-подключение;
- для технических сценариев можно использовать отдельный service connector.

Персональные токены нельзя публиковать в описаниях коннекторов, задачах, комментариях, GitHub, логах, скриншотах и общих инструкциях.

---

## RU: Legacy/service режим

Старый формат URL сохранён для совместимости:

- `<MCP_BASE_URL>/t/<token>/mcp`

Этот режим подходит для сервисных подключений:

- технический пользователь;
- сервисный аккаунт;
- общий агент, который осознанно работает от service-account.

Токены из legacy URL маскируются в логах:

- было: `/t/<token>/mcp`
- стало: `/t/[REDACTED]/mcp`

---

## RU: Возможности

Сервер включает:

- Bitrix24 REST API client;
- OAuth-хранилище Bitrix-подключений;
- персональные MCP access tokens;
- привязку MCP token к Bitrix OAuth connection;
- обновление `last_used_at` при использовании токена;
- отключение MCP token через `active=false`;
- PostgreSQL storage;
- audit log для write-операций;
- MCP tools для задач, пользователей, диска, заметок/knowledge base, bizproc, CRM и IM.

---

## RU: Управление MCP access tokens

Добавлены admin tools:

- `bitrix_mcp_access_token_list`
- `bitrix_mcp_access_token_revoke`
- `bitrix_mcp_access_token_upsert`

`bitrix_mcp_access_token_list` возвращает только безопасные поля:

- `id`
- `label`
- `actor_name`
- `bitrix_connection_id`
- `bitrix_user_id`
- `active`
- `created_at`
- `updated_at`
- `last_used_at`

Он не возвращает:

- plaintext token;
- `token_hash`;
- Bitrix OAuth access token;
- Bitrix OAuth refresh token.

---

## RU: Основные Bitrix task tools

Основной режим работы с задачами — стабильные атомарные tools:

- `bitrix_task_get`
- `bitrix_task_list`
- `bitrix_task_comments_get`
- `bitrix_task_comment_add`
- `bitrix_task_checklist_get`
- `bitrix_task_checklist_add`
- `bitrix_task_results_get`
- `bitrix_task_update`
- `bitrix_task_context_bulk_get`

`bitrix_task_context_bulk_get` используется как компактное чтение базовой информации по задачам. Комментарии, чек-листы и результаты лучше читать отдельными специализированными tools.

---

## RU: Быстрый старт

1. Скопировать env-файл:

   `cp .env.example .env`

2. Настроить переменные окружения.

3. Запустить PostgreSQL:

   `docker compose up -d db`

4. Выполнить миграции:

   `docker compose run --rm app npm run migrate:dev`

5. Запустить MCP HTTP server:

   `docker compose up -d app`

6. Проверить health endpoint:

   `GET http://localhost:7010/healthz`

---

## RU: Bitrix OAuth

Self-service Bitrix OAuth login доступен через OAuth start endpoint.

После успешной авторизации сервер создаёт:

- Bitrix OAuth connection;
- персональный MCP access token;
- страницу с инструкцией подключения через `<MCP_BASE_URL>/mcp`.

Подробности настройки Bitrix OAuth находятся в:

- `docs/BITRIX_OAUTH_SETUP.md`
- `docs/AUTH.md`

---

## RU: Безопасность

- Все write tools требуют `confirm=true`, если явно не включён dev-режим `ALLOW_UNCONFIRMED_WRITES=true`.
- Write tools пишут audit log без секретов.
- Персональные MCP tokens хранятся как SHA-256 hash.
- Plaintext token показывается пользователю только один раз после создания.
- Legacy path-token редактируется в логах.
- Локальные backup-файлы должны храниться в `_local_backups/` и не попадать в Git.

---

# EN: Bitrix24 MCP OAuth Server

## Purpose

Bitrix24 MCP OAuth Server connects ChatGPT/agents to Bitrix24 through the Bitrix24 REST API.

The server supports two connection models:

1. **Personal connector mode** — recommended for employees.
2. **Legacy/service connector mode** — compatibility mode for service users and technical agents.

The main model is: publish one shared MCP connector, and let every user connect it with their own personal `<MCP_ACCESS_TOKEN>` token. Requests are routed to the Bitrix OAuth connection that belongs to the token owner.

---

## Recommended personal connection mode

Use this setup for the shared published connector:

- MCP URL: `<MCP_BASE_URL>/mcp`
- Auth: `API key / custom header`
- Header: `x-api-key`
- Value: user's personal `<MCP_ACCESS_TOKEN>` token

Connection logic:

- every employee connects the same published connector;
- during connection, the employee enters their personal token;
- the server resolves the token owner and routes requests through the corresponding Bitrix OAuth connection;
- technical scenarios can use a dedicated service connector.

Personal tokens must not be published in connector descriptions, Bitrix tasks, comments, GitHub, logs, screenshots, or shared instructions.

---

## Legacy/service mode

The old URL format is still supported:

- `<MCP_BASE_URL>/t/<token>/mcp`

This mode is intended for service connectors:

- technical users;
- service accounts;
- shared agents that intentionally work through a service account.

Legacy URL tokens are redacted in logs:

- before: `/t/<token>/mcp`
- after: `/t/[REDACTED]/mcp`

---

## Features

The server includes:

- Bitrix24 REST API client;
- Bitrix OAuth connection storage;
- personal MCP access tokens;
- mapping MCP tokens to Bitrix OAuth connections;
- `last_used_at` tracking;
- MCP token revoke through `active=false`;
- PostgreSQL storage;
- audit log for write operations;
- MCP tools for tasks, users, disk, notes/knowledge base, bizproc, CRM, and IM.

---

## MCP access token management

Admin tools:

- `bitrix_mcp_access_token_list`
- `bitrix_mcp_access_token_revoke`
- `bitrix_mcp_access_token_upsert`

`bitrix_mcp_access_token_list` returns only non-secret metadata:

- `id`
- `label`
- `actor_name`
- `bitrix_connection_id`
- `bitrix_user_id`
- `active`
- `created_at`
- `updated_at`
- `last_used_at`

It does not return:

- plaintext token;
- `token_hash`;
- Bitrix OAuth access token;
- Bitrix OAuth refresh token.

---

## Main Bitrix task tools

The preferred task workflow uses stable atomic tools:

- `bitrix_task_get`
- `bitrix_task_list`
- `bitrix_task_comments_get`
- `bitrix_task_comment_add`
- `bitrix_task_checklist_get`
- `bitrix_task_checklist_add`
- `bitrix_task_results_get`
- `bitrix_task_update`
- `bitrix_task_context_bulk_get`

`bitrix_task_context_bulk_get` is a compact task context reader. Comments, checklist items, and task results should be fetched through their dedicated tools.

---

## Quick start

1. Copy env file:

   `cp .env.example .env`

2. Configure environment variables.

3. Start PostgreSQL:

   `docker compose up -d db`

4. Run migrations:

   `docker compose run --rm app npm run migrate:dev`

5. Start MCP HTTP server:

   `docker compose up -d app`

6. Check health endpoint:

   `GET http://localhost:7010/healthz`

---

## Bitrix OAuth

Self-service Bitrix OAuth login is available through the OAuth start endpoint.

After successful authorization, the server creates:

- Bitrix OAuth connection;
- personal MCP access token;
- connection instructions for `<MCP_BASE_URL>/mcp`.

See:

- `docs/BITRIX_OAUTH_SETUP.md`
- `docs/AUTH.md`

---

## Security

- All write tools require `confirm=true` unless dev mode `ALLOW_UNCONFIRMED_WRITES=true` is enabled.
- Write tools emit audit logs without secrets.
- Personal MCP tokens are stored as SHA-256 hashes.
- Plaintext token is shown only once after creation.
- Legacy path-token is redacted in logs.
- Local backup files should stay in `_local_backups/` and must not be committed.

---

## Development

- Tests: `npm test`
- Seed examples: `npm run seed:toolcalls`

---

## Known Bitrix24 caveats

- Task comments for the new task card are read from the task chat: `tasks.task.get -> chat.id -> im.dialog.messages.get`.
- Legacy fallback for old tasks: `task.commentitem.getlist`.
