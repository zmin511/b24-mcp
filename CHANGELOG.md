# Changelog

## v0.2.0 — Bitrix Note 2.0 read/write tools

### RU: Добавлено

- Добавлена стабильная поддержка чтения Bitrix Note 2.0.
- Добавлен tool `bitrix_note_collection_list`.
- Добавлен tool `bitrix_note_collection_get`.
- Добавлен tool `bitrix_note_document_tree`.
- Добавлен tool `bitrix_note_document_get`.
- Добавлен tool `bitrix_note_document_search`.
- Добавлен tool `bitrix_note_document_create`.
- Добавлен tool `bitrix_note_document_update`.
- Добавлен tool `bitrix_note_document_delete`.
- Добавлен диагностический tool `bitrix_rest_v3_note_method_probe`.
- Для Note write tools добавлен безопасный режим `dry_run=true` по умолчанию.
- Для реальных write-операций требуется `confirm=true`.
- Для удаления дополнительно требуется `confirm_delete_text=DELETE`.

### RU: Подтверждённые Bitrix REST v3 методы

- `note.document.add`
- `note.document.update`
- `note.document.delete`

### RU: Проверено

- Создание документа Note 2.0.
- Обновление title и markdown.
- Чтение документа после обновления.
- Удаление документа.
- Dry-run create/update/delete без отправки запроса в Bitrix.
- Confirm-защита для реальной записи.
- Дополнительная DELETE-защита для удаления.

### RU: Безопасность

- Personal MCP access tokens используются через header `x-api-key`.
- Legacy path-token URL маскируется в логах.
- MCP tokens хранятся как SHA-256 hash.
- Plaintext token показывается только один раз.
- Admin token list tool не возвращает секреты.
- Write tools пишут audit log без секретов.

### RU: Не включено

- Write tools для старой `/kb/` не включены в стабильный релиз.
- Видимая база `/knowledge/baza_znaniy_medsesstry/` не развивается и не входит в релиз.
- Интеграция через внутренний browser AJAX `type=KNOWLEDGE` не используется.

---

## v0.1.0 — Base Bitrix24 MCP OAuth server

### RU: Базовая функциональность

- Bitrix24 OAuth connection storage.
- MCP HTTP endpoint.
- Personal MCP token mode.
- Legacy/service connector mode.
- Basic Bitrix task tools.
- Basic Bitrix REST tools.
- PostgreSQL storage.
- Docker-based deployment.

---

# EN

## v0.2.0 — Bitrix Note 2.0 read/write tools

### Added

- Added stable Bitrix Note 2.0 read support.
- Added `bitrix_note_collection_list`.
- Added `bitrix_note_collection_get`.
- Added `bitrix_note_document_tree`.
- Added `bitrix_note_document_get`.
- Added `bitrix_note_document_search`.
- Added `bitrix_note_document_create`.
- Added `bitrix_note_document_update`.
- Added `bitrix_note_document_delete`.
- Added diagnostic `bitrix_rest_v3_note_method_probe`.
- Added default `dry_run=true` protection for Note write tools.
- Real write operations require `confirm=true`.
- Delete operations additionally require `confirm_delete_text=DELETE`.

### Confirmed Bitrix REST v3 methods

- `note.document.add`
- `note.document.update`
- `note.document.delete`

### Validated

- Note 2.0 document creation.
- Title and markdown update.
- Reading the document after update.
- Document deletion.
- Dry-run create/update/delete without sending a request to Bitrix.
- Confirm protection for real writes.
- Additional DELETE confirmation for delete operations.

### Security

- Personal MCP access tokens are used via `x-api-key` header.
- Legacy path-token URL is redacted in logs.
- MCP tokens are stored as SHA-256 hashes.
- Plaintext token is shown only once.
- Admin token list tool does not return secrets.
- Write tools write audit logs without secrets.

### Not included

- Old `/kb/` write tools are not included in the stable release.
- Visible `/knowledge/baza_znaniy_medsesstry/` knowledge base is not developed further and is not included.
- Internal browser AJAX `type=KNOWLEDGE` integration is not used.

## v0.1.0 — Base Bitrix24 MCP OAuth server

### Base functionality

- Bitrix24 OAuth connection storage.
- MCP HTTP endpoint.
- Personal MCP token mode.
- Legacy/service connector mode.
- Basic Bitrix task tools.
- Basic Bitrix REST tools.
- PostgreSQL storage.
- Docker-based deployment.
