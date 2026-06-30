const examples = [
  {
    tool: "bitrix_connection_upsert",
    args: {
      confirm: true,
      id: "default",
      portal_url: "https://YOUR_PORTAL.bitrix24.ru",
      auth_type: "webhook",
      webhook_url: "https://<BITRIX_DOMAIN>/rest/<USER_ID>/<WEBHOOK_CODE>/"
    }
  },
  { tool: "bitrix_health_check", args: { connection_id: "default" } },
  { tool: "bitrix_user_search", args: { query: "Иван", connection_id: "default" } },
  { tool: "bitrix_task_list", args: { connection_id: "default", params: { order: { ID: "desc" }, filter: {}, select: ["ID", "TITLE", "CREATED_DATE", "CLOSED_DATE"] } } },
  { tool: "bitrix_task_sync_recent", args: { connection_id: "default", max_tasks: 20 } },
  { tool: "bitrix_report_task_summary", args: { connection_id: "default", since: "2026-01-01T00:00:00Z" } }
];

process.stdout.write(JSON.stringify(examples, null, 2) + "\n");

