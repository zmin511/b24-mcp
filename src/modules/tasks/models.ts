export type TaskStatus =
  | "NEW"
  | "PENDING"
  | "IN_PROGRESS"
  | "SUPPOSEDLY_COMPLETED"
  | "COMPLETED"
  | "DEFERRED"
  | "DECLINED"
  | "UNKNOWN";

export type TaskNormalized = {
  taskId: number;
  title?: string;
  description?: string;
  status?: TaskStatus;
  createdDate?: string;
  changedDate?: string;
  statusChangedDate?: string;
  closedDate?: string;
  deadline?: string;
  creatorId?: number;
  responsibleId?: number;
  accompliceIds?: number[];
  auditorIds?: number[];
  closedById?: number;
  groupId?: number;
  parentId?: number;
  priority?: number;
  tags?: string[];
  crmLinks?: unknown;
  chatId?: string;
  commentsCount?: number;
  isCompleted: boolean;
  isOverdue: boolean;
  hasResult: boolean;
};

export type TaskMessage = {
  source: "chat" | "legacy";
  messageId: string;
  taskId: number;
  authorId?: number;
  createdAt?: string;
  text?: string;
  raw: unknown;
};

