import type { DbPool } from "./db.js";

export async function upsertTask(params: {
  pool: DbPool;
  connectionId: string;
  taskId: number;
  title?: string;
  description?: string;
  status?: number;
  createdDate?: string;
  changedDate?: string;
  statusChangedDate?: string;
  closedDate?: string;
  deadline?: string;
  creatorId?: number;
  responsibleId?: number;
  groupId?: number;
  parentId?: number;
  priority?: number;
  tags?: string[];
  crmLinks?: unknown;
  chatId?: string;
  commentsCount?: number;
  normalized: unknown;
  raw: unknown;
}) {
  const p = params;
  await p.pool.query(
    `insert into tasks(
      connection_id, task_id, title, description, status, created_date, changed_date, status_changed_date, closed_date,
      deadline, creator_id, responsible_id, group_id, parent_id, priority, tags, crm_links, chat_id, comments_count,
      normalized, raw, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now())
    on conflict(connection_id, task_id) do update set
      title=excluded.title,
      description=excluded.description,
      status=excluded.status,
      created_date=excluded.created_date,
      changed_date=excluded.changed_date,
      status_changed_date=excluded.status_changed_date,
      closed_date=excluded.closed_date,
      deadline=excluded.deadline,
      creator_id=excluded.creator_id,
      responsible_id=excluded.responsible_id,
      group_id=excluded.group_id,
      parent_id=excluded.parent_id,
      priority=excluded.priority,
      tags=excluded.tags,
      crm_links=excluded.crm_links,
      chat_id=excluded.chat_id,
      comments_count=excluded.comments_count,
      normalized=excluded.normalized,
      raw=excluded.raw,
      updated_at=now()`,
    [
      p.connectionId,
      p.taskId,
      p.title ?? null,
      p.description ?? null,
      p.status ?? null,
      p.createdDate ?? null,
      p.changedDate ?? null,
      p.statusChangedDate ?? null,
      p.closedDate ?? null,
      p.deadline ?? null,
      p.creatorId ?? null,
      p.responsibleId ?? null,
      p.groupId ?? null,
      p.parentId ?? null,
      p.priority ?? null,
      p.tags ?? null,
      p.crmLinks ?? null,
      p.chatId ?? null,
      p.commentsCount ?? null,
      p.normalized,
      p.raw
    ]
  );

  await p.pool.query(
    `insert into task_snapshots(connection_id, task_id, normalized, raw) values ($1,$2,$3,$4)`,
    [p.connectionId, p.taskId, p.normalized, p.raw]
  );
}

export async function upsertTaskMessages(params: {
  pool: DbPool;
  connectionId: string;
  taskId: number;
  messages: Array<{
    source: "chat" | "legacy";
    messageId: string;
    authorId?: number;
    createdAt?: string;
    text?: string;
    raw: unknown;
  }>;
}) {
  const { pool, connectionId, taskId, messages } = params;
  for (const m of messages) {
    await pool.query(
      `insert into task_messages(connection_id, task_id, source, message_id, author_id, created_at, text, raw)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict(connection_id, task_id, source, message_id) do update set
         author_id=excluded.author_id,
         created_at=excluded.created_at,
         text=excluded.text,
         raw=excluded.raw`,
      [
        connectionId,
        taskId,
        m.source,
        m.messageId,
        m.authorId ?? null,
        m.createdAt ? new Date(m.createdAt) : null,
        m.text ?? null,
        m.raw
      ]
    );
  }
}

