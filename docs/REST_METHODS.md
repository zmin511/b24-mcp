# Bitrix24 REST methods used (by module)

## Meta/health
- `app.info`
- `methods` (capability detection)
- `profile` (optional)

## Users
- `user.search`
- `user.get` (optional)

## Tasks
- `tasks.task.get`
- `tasks.task.list`
- `tasks.task.add`
- `tasks.task.update`
- `tasks.task.complete`
- `tasks.task.defer`
- `tasks.task.fields`
- Chat/comments (new card):
  - `im.dialog.messages.get`
  - `tasks.task.chat.message.send`
- Legacy comments (deprecated fallback):
  - `task.commentitem.getlist`
  - `task.commentitem.add`
- Results:
  - `tasks.task.result.list`
- Checklist:
  - `task.checklistitem.getlist`
  - `task.checklistitem.add`
  - `task.checklistitem.update`
  - `task.checklistitem.delete`
- Reminders:
  - `tasks.task.reminder.add`
- Participants:
  - `tasks.task.update` (with accomplices/auditors fields)

## Disk
- `disk.storage.getlist`
- `disk.folder.get`
- `disk.folder.getchildren`
- `disk.folder.addsubfolder`
- `disk.folder.uploadfile`
- `disk.file.get`
- `disk.file.getDownloadUrl` (if available) / fallback: `disk.file.get`
- `disk.folder.moveto` / `disk.file.moveto` (if available)
- `disk.folder.sharetouser`

## Knowledge base (landing, TYPE=KNOWLEDGE)
- `landing.site.getList`
- `landing.site.add`
- `landing.landing.getList`
- `landing.landing.add`
- `landing.landing.update`
- `landing.block.add`
- `landing.block.update` (optional for MVP)
- `landing.landing.getPreview` (optional)

## Bizproc
- `bizproc.workflow.template.list`
- `bizproc.workflow.start`
- `bizproc.workflow.instances`
- `bizproc.workflow.kill` (optional; rights-dependent)
- `bizproc.workflow.template.update` (only via explicit tool, rights-dependent)

