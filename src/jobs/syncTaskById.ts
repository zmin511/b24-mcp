import type { Logger } from "../common/logger.js";
import type { DbPool } from "../storage/db.js";
import { createBitrixClientForConnection } from "../bitrix/factory.js";
import { BitrixTasksService } from "../modules/tasks/service.js";
import { normalizeTask } from "../modules/tasks/normalize.js";
import { upsertTask, upsertTaskMessages } from "../storage/tasksRepo.js";

export async function syncTaskById(params: {
  pool: DbPool;
  logger: Logger;
  connectionId: string;
  encryptionKeyBase64: string;
  taskId: number;
}) {
  const { client, capabilities } = await createBitrixClientForConnection(params);
  const tasks = new BitrixTasksService(client, capabilities);
  const getRes = await tasks.taskGet(params.taskId);
  const rawTask = (getRes.result as any)?.task ?? (getRes.result as any) ?? {};
  const normalized = normalizeTask(rawTask);

  await upsertTask({
    pool: params.pool,
    connectionId: params.connectionId,
    taskId: params.taskId,
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

  const comments = await tasks.taskCommentsGet(params.taskId, normalized.chatId);
  await upsertTaskMessages({
    pool: params.pool,
    connectionId: params.connectionId,
    taskId: params.taskId,
    messages: comments.messages.map((m) => ({
      source: m.source,
      messageId: m.messageId,
      authorId: m.authorId,
      createdAt: m.createdAt,
      text: m.text,
      raw: m.raw
    }))
  });

  return { taskId: params.taskId, normalized, raw: rawTask, messages: comments.messages };
}

