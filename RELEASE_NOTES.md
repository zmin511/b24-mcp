# Release notes — v0.2.0

## RU: Кратко

`v0.2.0` — стабильный релиз Bitrix24 MCP OAuth Server с поддержкой чтения и записи Bitrix Note 2.0 через REST v3.

Старая `/kb/` и отдельная видимая база `/knowledge/baza_znaniy_medsesstry/` не входят в релиз и дальше не развиваются.

## RU: Главные изменения

- Стабилизирована модель Personal MCP connector.
- Каждый пользователь работает через свой MCP access token.
- Добавлена поддержка чтения Note 2.0.
- Добавлена поддержка создания, обновления и удаления документов Note 2.0.
- Все write tools защищены через `dry_run`, `confirm` и дополнительное подтверждение удаления.
- README обновлён на русском и английском.
- Добавлен CHANGELOG.
- Версия проекта обновлена до `0.2.0`.

## RU: Рабочие Note 2.0 tools

Read:

- `bitrix_note_collection_list`
- `bitrix_note_collection_get`
- `bitrix_note_document_tree`
- `bitrix_note_document_get`
- `bitrix_note_document_search`

Write:

- `bitrix_note_document_create`
- `bitrix_note_document_update`
- `bitrix_note_document_delete`

Diagnostics:

- `bitrix_rest_v3_note_method_probe`

## RU: Подтверждённые REST v3 методы

- `note.document.add`
- `note.document.update`
- `note.document.delete`

## RU: Что не включено

- Старый `/kb/` Landing API write support.
- Внутренний `/knowledge/` browser AJAX слой.
- База `/knowledge/baza_znaniy_medsesstry/`.

## EN: Summary

`v0.2.0` is a stable Bitrix24 MCP OAuth Server release with Bitrix Note 2.0 read/write support through REST v3.

Old `/kb/` and the separate visible `/knowledge/baza_znaniy_medsesstry/` knowledge base are not part of this release and are no longer developed.

## EN: Main changes

- Stabilized Personal MCP connector model.
- Each user works through their own MCP access token.
- Added Note 2.0 read support.
- Added Note 2.0 document create, update and delete support.
- All write tools are protected with `dry_run`, `confirm` and additional delete confirmation.
- README updated in Russian and English.
- CHANGELOG added.
- Project version updated to `0.2.0`.

## EN: Working Note 2.0 tools

Read:

- `bitrix_note_collection_list`
- `bitrix_note_collection_get`
- `bitrix_note_document_tree`
- `bitrix_note_document_get`
- `bitrix_note_document_search`

Write:

- `bitrix_note_document_create`
- `bitrix_note_document_update`
- `bitrix_note_document_delete`

Diagnostics:

- `bitrix_rest_v3_note_method_probe`

## EN: Confirmed REST v3 methods

- `note.document.add`
- `note.document.update`
- `note.document.delete`

## EN: Not included

- Old `/kb/` Landing API write support.
- Internal `/knowledge/` browser AJAX layer.
- `/knowledge/baza_znaniy_medsesstry/` knowledge base.
