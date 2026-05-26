import type { DbPool } from "../../storage/db.js";

export class ReportsService {
  constructor(private readonly pool: DbPool) {}

  async completedTasksSummary(params: { connectionId: string; since?: string; until?: string }) {
    const { connectionId, since, until } = params;
    const where: string[] = ["connection_id = $1", "closed_date is not null"];
    const values: any[] = [connectionId];
    if (since) {
      values.push(new Date(since));
      where.push(`closed_date >= $${values.length}`);
    }
    if (until) {
      values.push(new Date(until));
      where.push(`closed_date <= $${values.length}`);
    }
    const res = await this.pool.query(
      `select task_id, title, created_date, closed_date, responsible_id, creator_id, group_id, deadline, status, normalized
       from tasks
       where ${where.join(" and ")}
       order by closed_date desc
       limit 1000`,
      values
    );
    return { items: res.rows };
  }

  async taskTimeline(params: { connectionId: string; taskId: number }) {
    const res = await this.pool.query(
      `select captured_at, normalized, raw from task_snapshots
       where connection_id=$1 and task_id=$2
       order by captured_at asc
       limit 2000`,
      [params.connectionId, params.taskId]
    );
    const msgs = await this.pool.query(
      `select source, message_id, author_id, created_at, text, raw
       from task_messages
       where connection_id=$1 and task_id=$2
       order by created_at asc nulls last
       limit 5000`,
      [params.connectionId, params.taskId]
    );
    return { snapshots: res.rows, messages: msgs.rows };
  }

  async userWorkload(params: { connectionId: string }) {
    const res = await this.pool.query(
      `select responsible_id, count(*)::int as open_tasks
       from tasks
       where connection_id=$1 and closed_date is null
       group by responsible_id
       order by open_tasks desc nulls last
       limit 1000`,
      [params.connectionId]
    );
    return { items: res.rows };
  }
}
