import type { BitrixRestClient } from "../../bitrix/http/client.js";
import { hasMethod, type BitrixCapabilities } from "../../bitrix/capabilities/detect.js";
import { AppError } from "../../common/errors.js";
import { normalizeChatMessages, normalizeLegacyComments, normalizeTask } from "./normalize.js";

export class BitrixTasksService {
  constructor(
    private readonly client: BitrixRestClient,
    private readonly caps: BitrixCapabilities
  ) {}

  healthCheck() {
    return this.client.call("app.info", {});
  }

  taskFields() {
    return this.client.call("tasks.task.getFields", {});
  }

  taskGet(taskId: number, params: Record<string, unknown> = {}) {
    return this.client.call("tasks.task.get", { taskId, ...params });
  }

  async taskList(params: Record<string, unknown>) {
    return this.client.call("tasks.task.list", params);
  }

  taskCreate(fields: Record<string, unknown>) {
    return this.client.call("tasks.task.add", { fields });
  }

  taskUpdate(taskId: number, fields: Record<string, unknown>) {
    return this.client.call("tasks.task.update", { taskId, fields });
  }

  taskComplete(taskId: number) {
    return this.client.call("tasks.task.complete", { taskId });
  }

  taskDefer(taskId: number) {
    return this.client.call("tasks.task.defer", { taskId });
  }

  async taskCommentsGet(taskId: number, chatId?: string) {
    let resolvedChatId = chatId;

    if (!resolvedChatId) {
      try {
        const task = await this.client.call<any>("tasks.task.get", { taskId });
        resolvedChatId =
          task?.result?.task?.chatId ??
          task?.result?.task?.chat?.id ??
          task?.result?.task?.CHAT_ID;
      } catch {
        // Ignore task.get errors here and continue to legacy fallback.
      }
    }

    if (resolvedChatId && hasMethod(this.caps, "im.dialog.messages.get")) {
      const chatRes = await this.client.call<any>("im.dialog.messages.get", { dialog_id: String(resolvedChatId) });
      return { source: "chat" as const, messages: normalizeChatMessages(taskId, chatRes.result ?? chatRes) };
    }

    if (hasMethod(this.caps, "task.commentitem.getlist")) {
      const legacy = await this.client.call<any>("task.commentitem.getlist", { TASKID: taskId });
      return { source: "legacy" as const, messages: normalizeLegacyComments(taskId, legacy.result ?? legacy) };
    }

    throw new AppError("No supported API for task comments in this portal", "NOT_SUPPORTED", { status: 400 });
  }

  async taskChatSend(taskId: number, message: string) {
    const task = await this.client.call<any>("tasks.task.get", { taskId });
    const chatId = task?.result?.task?.chatId ?? task?.result?.task?.chat?.id ?? task?.result?.task?.CHAT_ID;

    if (!chatId) {
      throw new AppError("Task chatId not found; cannot send message", "CHAT_ID_MISSING", { status: 400 });
    }

    try {
      return await this.client.call("tasks.task.chat.message.send", {
        fields: {
          taskId,
          text: message
        }
      });
    } catch (err: any) {
      const methodNotFound =
        err?.code === "BITRIX_HTTP" &&
        (err?.details?.error === "ERROR_METHOD_NOT_FOUND" ||
          err?.details?.error_description === "Method not found!");

      if (methodNotFound) {
        return this.legacyCommentAdd(taskId, message);
      }

      throw err;
    }
  }

  legacyCommentAdd(taskId: number, message: string) {
    return this.client.call("task.commentitem.add", {
      TASKID: taskId,
      FIELDS: {
        POST_MESSAGE: message
      }
    });
  }

  taskResultsGet(taskId: number) {
    return this.client.call("tasks.task.result.list", { taskId });
  }

  checklistGet(taskId: number) {
    return this.client.call("task.checklistitem.getlist", { TASKID: taskId });
  }

  checklistAdd(taskId: number, title: string) {
    return this.client.call("task.checklistitem.add", { TASKID: taskId, FIELDS: { TITLE: title } });
  }

  checklistUpdate(taskId: number, itemId: number, fields: Record<string, unknown>) {
    return this.client.call("task.checklistitem.update", { TASKID: taskId, ITEMID: itemId, FIELDS: fields });
  }

  checklistDelete(taskId: number, itemId: number) {
    return this.client.call("task.checklistitem.delete", { TASKID: taskId, ITEMID: itemId });
  }

  reminderAdd(taskId: number, userId: number, remindAt: string) {
    return this.client.call("tasks.task.reminder.add", {
      taskId,
      fields: {
        userId,
        remindAt
      }
    });
  }

  async normalizeTaskPayload(task: any) {
    return normalizeTask(task);
  }
}

