import type { Logger } from "../common/logger.js";
import type { DbPool } from "../storage/db.js";
import { createBitrixClientForConnection } from "../bitrix/factory.js";
import { getSyncJob, upsertSyncJob } from "../storage/syncJobs.js";
import { BitrixTasksService } from "../modules/tasks/service.js";
import { normalizeTask } from "../modules/tasks/normalize.js";
import { upsertTask, upsertTaskMessages } from "../storage/tasksRepo.js";

const JOB_TYPE = "tasks_recent";

export async function syncRecentTasks(params: {
  pool: DbPool;
  logger: Logger;
  connectionId: string;
  encryptionKeyBase64: string;
  maxTasks?: number;
}) {
  const { client, capabilities } = await createBitrixClientForConnection(params);
  const tasks = new BitrixTasksService(client, capabilities);

  const job = await getSyncJob(params.pool, params.connectionId, JOB_TYPE);
  const cursor = (job?.cursor_json as any) ?? {};
  const since = typeof cursor.since === "string" ? cursor.since : undefined;

  const listRes = await tasks.taskList({
    order: { CHANGED_DATE: "asc" },
    filter: since ? { ">=CHANGED_DATE": since } : {},
    select: [
      "ID",
      "TITLE",
      "DESCRIPTION",
      "STATUS",
      "CREATED_DATE",
      "CHANGED_DATE",
      "STATUS_CHANGED_DATE",
      "CLOSED_DATE",
      "CLOSED_BY",
      "CREATOR_ID",
      "RESPONSIBLE_ID",
      "ACCOMPLICES",
      "AUDITORS",
      "DEADLINE",
      "GROUP_ID",
      "PARENT_ID",
      "PRIORITY",
      "TAGS",
      "UF_CRM_TASK",
      "COMMENTS_COUNT",
      "CHAT_ID"
    ],
    start: 0
  });

  const rawList = (listRes.result as any)?.tasks ?? (listRes.result as any)?.items ?? (listRes.result as any) ?? [];
  const list: any[] = Array.isArray(rawList) ? rawList : [];

  let lastChanged = since;
  let processed = 0;

  for (const t of list) {
    if (params.maxTasks && processed >= params.maxTasks) break;
    const taskId = Number(t?.id ?? t?.ID);
    if (!Number.isFinite(taskId)) continue;

    const getRes = await tasks.taskGet(taskId);
    const rawTask = (getRes.result as any)?.task ?? (getRes.result as any) ?? {};
    const normalized = normalizeTask(rawTask);

    await upsertTask({
      pool: params.pool,
      connectionId: params.connectionId,
      taskId,
      title: normalized.title,
      description: normalized.description,
      status: typeof (rawTask?.status ?? rawTask?.STATUS) === "number" ? (rawTask?.status ?? rawTask?.STATUS) : Number(rawTask?.status ?? rawTask?.STATUS),
      createdDate: normalized.createdDate,
      changedDate: normalized.changedDate,
      statusChangedDate: normalized.statusChangedDate,
      closedDate: normalized.closedDate,
      deadline: normalized.deadline,
      creatorId: normalized.creatorId,
      responsibleId: normalized.responsibleId,
      groupId: normalized.groupId,
      parentId: normalized.parentId,
      priority: normalized.priority,
      tags: normalized.tags,
      crmLinks: normalized.crmLinks,
      chatId: normalized.chatId,
      commentsCount: normalized.commentsCount,
      normalized,
      raw: rawTask
    });

    const comments = await tasks.taskCommentsGet(taskId, normalized.chatId);
    await upsertTaskMessages({
      pool: params.pool,
      connectionId: params.connectionId,
      taskId,
      messages: comments.messages.map((m) => ({
        source: m.source,
        messageId: m.messageId,
        authorId: m.authorId,
        createdAt: m.createdAt,
        text: m.text,
        raw: m.raw
      }))
    });

    if (normalized.changedDate) lastChanged = normalized.changedDate;
    processed++;
  }

  await upsertSyncJob(params.pool, params.connectionId, JOB_TYPE, { since: lastChanged ?? since ?? null, processed });

  params.logger.info({ connectionId: params.connectionId, processed, since, lastChanged }, "syncRecentTasks_done");
  return { processed, since: since ?? null, lastChanged: lastChanged ?? null };
}

