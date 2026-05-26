import type { TaskMessage, TaskNormalized, TaskStatus } from "./models.js";

function toNum(v: any): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function toStr(v: any): string | undefined {
  return typeof v === "string" ? v : v == null ? undefined : String(v);
}

export function normalizeTask(rawTask: any): TaskNormalized {
  const id = toNum(rawTask?.id) ?? toNum(rawTask?.ID);
  if (!id) throw new Error("Task id missing in raw task");

  const statusNum = toNum(rawTask?.status ?? rawTask?.STATUS);
  const status: TaskStatus =
    statusNum === 1
      ? "NEW"
      : statusNum === 2
        ? "PENDING"
        : statusNum === 3
          ? "IN_PROGRESS"
          : statusNum === 4
            ? "SUPPOSEDLY_COMPLETED"
            : statusNum === 5
              ? "COMPLETED"
              : statusNum === 6
                ? "DEFERRED"
                : statusNum === 7
                  ? "DECLINED"
                  : "UNKNOWN";

  const createdDate = toStr(rawTask?.createdDate ?? rawTask?.CREATED_DATE);
  const changedDate = toStr(rawTask?.changedDate ?? rawTask?.CHANGED_DATE);
  const statusChangedDate = toStr(rawTask?.statusChangedDate ?? rawTask?.STATUS_CHANGED_DATE);
  const closedDate = toStr(rawTask?.closedDate ?? rawTask?.CLOSED_DATE);
  const deadline = toStr(rawTask?.deadline ?? rawTask?.DEADLINE);

  const now = Date.now();
  const isCompleted = status === "COMPLETED";
  const isOverdue = !isCompleted && !!deadline && Date.parse(deadline) < now;

  const chatId = toStr(rawTask?.chatId ?? rawTask?.CHAT_ID ?? rawTask?.chat?.id);
  const commentsCount = toNum(rawTask?.commentsCount ?? rawTask?.COMMENTS_COUNT);

  const accomplices = rawTask?.accomplices ?? rawTask?.ACCOMPLICES;
  const auditors = rawTask?.auditors ?? rawTask?.AUDITORS;

  const accompliceIds = Array.isArray(accomplices) ? accomplices.map(toNum).filter(Boolean) as number[] : undefined;
  const auditorIds = Array.isArray(auditors) ? auditors.map(toNum).filter(Boolean) as number[] : undefined;

  return {
    taskId: id,
    title: toStr(rawTask?.title ?? rawTask?.TITLE),
    description: toStr(rawTask?.description ?? rawTask?.DESCRIPTION),
    status,
    createdDate,
    changedDate,
    statusChangedDate,
    closedDate,
    deadline,
    creatorId: toNum(rawTask?.creatorId ?? rawTask?.CREATOR_ID),
    responsibleId: toNum(rawTask?.responsibleId ?? rawTask?.RESPONSIBLE_ID),
    accompliceIds,
    auditorIds,
    closedById: toNum(rawTask?.closedBy ?? rawTask?.CLOSED_BY),
    groupId: toNum(rawTask?.groupId ?? rawTask?.GROUP_ID),
    parentId: toNum(rawTask?.parentId ?? rawTask?.PARENT_ID),
    priority: toNum(rawTask?.priority ?? rawTask?.PRIORITY),
    tags: Array.isArray(rawTask?.tags ?? rawTask?.TAGS) ? (rawTask?.tags ?? rawTask?.TAGS) : undefined,
    crmLinks: rawTask?.crmLinks ?? rawTask?.UF_CRM_TASK ?? rawTask?.UF_CRM_TASKS,
    chatId,
    commentsCount,
    isCompleted,
    isOverdue,
    hasResult: false
  };
}

export function normalizeChatMessages(taskId: number, raw: any): TaskMessage[] {
  const msgs = raw?.messages ?? raw?.result?.messages ?? raw?.result ?? raw;
  if (!Array.isArray(msgs)) return [];

  return msgs.map((m: any) => ({
    source: "chat",
    taskId,
    messageId: toStr(m?.id ?? m?.ID ?? m?.message_id) ?? cryptoRandomFallback(m),
    authorId: toNum(m?.author_id ?? m?.AUTHOR_ID ?? m?.senderId ?? m?.FROM_USER_ID),
    createdAt: toStr(m?.date_create ?? m?.DATE_CREATE ?? m?.created_at ?? m?.DATE),
    text: toStr(m?.text ?? m?.MESSAGE ?? m?.message),
    raw: m
  }));
}

export function normalizeLegacyComments(taskId: number, raw: any): TaskMessage[] {
  const list = raw?.result ?? raw;
  if (!Array.isArray(list)) return [];
  return list.map((m: any) => ({
    source: "legacy",
    taskId,
    messageId: toStr(m?.ID ?? m?.id) ?? cryptoRandomFallback(m),
    authorId: toNum(m?.AUTHOR_ID ?? m?.authorId),
    createdAt: toStr(m?.POST_DATE ?? m?.postDate),
    text: toStr(m?.POST_MESSAGE ?? m?.postMessage ?? m?.MESSAGE),
    raw: m
  }));
}

function cryptoRandomFallback(obj: any) {
  return `fallback_${Date.now()}_${Math.floor(Math.random() * 1e9)}_${JSON.stringify(obj).length}`;
}

