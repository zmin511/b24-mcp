import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Logger } from "../common/logger.js";
import type { AppConfig } from "../common/config.js";
import type { DbPool } from "../storage/db.js";
import { createBitrixClientForConnection } from "../bitrix/factory.js";
import { BitrixTasksService } from "../modules/tasks/service.js";
import { BitrixDiskService } from "../modules/disk/service.js";
import { BitrixKnowledgeService } from "../modules/knowledge/service.js";
import { BitrixNoteService } from "../modules/note/service.js";
import { BitrixBizprocService } from "../modules/bizproc/service.js";
import { BitrixUsersService } from "../modules/users/service.js";
import { ReportsService } from "../modules/reports/service.js";
import { BitrixImService } from "../modules/im/service.js";
import { BitrixCrmService } from "../modules/crm/service.js";
import { jsonResult } from "./types.js";
import { requireConfirm, redactSecrets } from "./safety.js";
import { writeAuditLog } from "../storage/audit.js";
import { upsertConnection } from "../storage/connections.js";
import { listMcpAccessTokens, revokeMcpAccessToken, upsertMcpAccessToken } from "../storage/mcpAccessTokens.js";
import { encryptString } from "../common/crypto.js";
import { syncRecentTasks } from "../jobs/syncRecentTasks.js";
import { syncTaskById } from "../jobs/syncTaskById.js";
import { AppError } from "../common/errors.js";

export type RequestAuth =
  | { kind: "admin"; tokenSource: string; actor?: string }
  | { kind: "user"; tokenSource: string; connectionId: string; actor?: string; accessTokenId: string; bitrixUserId?: number };

export type Ctx = { config: AppConfig; pool: DbPool; logger: Logger; requestAuth?: RequestAuth };

type ToolDef = {
  name: string;
  description: string;
  risky: boolean;
  inputSchema: z.ZodTypeAny;
  handler: (ctx: Ctx, input: any) => Promise<any>;
};

const baseInput = z.object({
  connection_id: z.string().optional(),
  confirm: z.boolean().optional()
});

const executionPlanActionSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("task_comment_add"),
    task_id: z.number().int().positive(),
    message: z.string().min(1).max(10000)
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("task_checklist_add"),
    task_id: z.number().int().positive(),
    title: z.string().min(1).max(1000)
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("task_create"),
    local_ref: z.string().min(1).max(100).optional(),
    fields: z.record(z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
      z.null()
    ]))
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("task_update_fields"),
    task_id: z.number().int().positive(),
    fields: z.record(z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
      z.null()
    ]))
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("task_update_description_append"),
    task_id: z.number().int().positive(),
    text: z.string().min(1).max(20000)
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("task_participants_update"),
    task_id: z.number().int().positive(),
    accomplices: z.array(z.number().int().positive()).max(50).optional(),
    auditors: z.array(z.number().int().positive()).max(50).optional()
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("im_message_add"),
    dialog_id: z.string().min(1).max(100),
    message: z.string().min(1).max(10000)
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("disk_file_create_text"),
    folder_id: z.number().int().positive(),
    filename: z.string().min(1).max(255),
    content: z.string().min(1).max(200000)
  })
]);

const executionPlanSchema = z.object({
  plan_id: z.string().min(1).max(200),
  dry_run: z.boolean().optional(),
  stop_on_error: z.boolean().optional(),
  actions: z.array(executionPlanActionSchema).min(1).max(100)
});

const taskBatchQuerySchema = z.object({
  name: z.string().min(1).max(100),
  params: z.object({
    order: z.record(z.enum(["asc", "desc", "ASC", "DESC"])).optional(),
    filter: z.record(z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number(), z.boolean()]))
    ])).optional(),
    select: z.array(z.string().min(1).max(100)).max(100).optional(),
    start: z.number().int().min(0).optional()
  }).optional()
});

function normalizeBulkTask(task: any) {
  if (!task) return null;

  return {
    taskId: Number(task.id ?? task.ID),
    title: task.title ?? task.TITLE ?? "",
    status: task.status ?? task.STATUS,
    responsibleId: Number(task.responsibleId ?? task.RESPONSIBLE_ID ?? 0) || null,
    createdBy: Number(task.createdBy ?? task.CREATED_BY ?? 0) || null,
    createdDate: task.createdDate ?? task.CREATED_DATE ?? null,
    changedDate: task.changedDate ?? task.CHANGED_DATE ?? null,
    deadline: task.deadline ?? task.DEADLINE ?? null,
    closedDate: task.closedDate ?? task.CLOSED_DATE ?? null,
    priority: task.priority ?? task.PRIORITY ?? null,
    groupId: Number(task.groupId ?? task.GROUP_ID ?? 0) || null,
    chatId: task.chatId ? String(task.chatId) : (task.CHAT_ID ? String(task.CHAT_ID) : null)
  };
}

function extractTaskListItems(res: any) {
  const raw = res?.result?.tasks ?? res?.result?.items ?? res?.result ?? [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function normalizeBulkChecklist(res: any) {
  const raw = res?.result ?? res ?? [];
  const items = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return items.slice(0, 50).map((item: any) => ({
    id: Number(item.id ?? item.ID),
    title: item.title ?? item.TITLE ?? "",
    isComplete: item.isComplete ?? item.IS_COMPLETE ?? item.complete ?? null,
    sortIndex: item.sortIndex ?? item.SORT_INDEX ?? null
  }));
}

function normalizeBulkResults(res: any) {
  const raw = res?.result ?? res ?? [];
  const items = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return items.slice(0, 20).map((item: any) => ({
    id: Number(item.id ?? item.ID),
    text: String(item.text ?? item.TEXT ?? item.commentText ?? "").slice(0, 1000),
    createdBy: Number(item.createdBy ?? item.CREATED_BY ?? 0) || null,
    createdAt: item.createdAt ?? item.CREATED_AT ?? item.createdDate ?? null
  }));
}

function normalizeBulkComments(res: any) {
  const raw = res?.result ?? res ?? [];
  const items = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return items.slice(0, 20).map((item: any) => ({
    id: Number(item.id ?? item.ID),
    authorId: Number(item.authorId ?? item.AUTHOR_ID ?? item.POST_AUTHOR_ID ?? 0) || null,
    date: item.date ?? item.POST_DATE ?? item.createdAt ?? null,
    message: String(item.message ?? item.POST_MESSAGE ?? item.text ?? "").slice(0, 1000)
  }));
}

function resolveConnectionId(ctx: Ctx, input: any): string {
  if (ctx.requestAuth?.kind === "user") return ctx.requestAuth.connectionId;
  return input?.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
}

function withResolvedConnection(ctx: Ctx, input: any) {
  return { ...input, connection_id: resolveConnectionId(ctx, input) };
}

function requireAdmin(ctx: Ctx, tool: string) {
  if (ctx.requestAuth?.kind === "user") {
    throw new AppError(`Tool '${tool}' requires an admin MCP token`, "ADMIN_REQUIRED", { status: 403 });
  }
}

export function toolList(): ToolDef[] {
  return [
    {
      name: "bitrix_health_check",
      description: "Calls Bitrix24 app.info for the given connection.",
      risky: false,
      inputSchema: baseInput,
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        const res = await tasks.healthCheck();
        return { connectionId, res };
      }
    },
    {
      name: "bitrix_connection_upsert",
      description: "Create/update a Bitrix connection in Postgres (webhook or oauth). Requires confirm=true.",
      risky: true,
      inputSchema: z
        .object({
          id: z.string(),
          portal_url: z.string().min(1),
          auth_type: z.enum(["webhook", "oauth"]),
          webhook_url: z.string().optional(),
          oauth_access_token: z.string().optional(),
          oauth_refresh_token: z.string().optional(),
          oauth_expires_at: z.string().optional()
        })
        .merge(baseInput),
      handler: async (ctx, input) => {
        requireAdmin(ctx, "bitrix_connection_upsert");
        requireConfirm("bitrix_connection_upsert", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const encKey = ctx.config.APP_ENCRYPTION_KEY_BASE64;
        const accessEnc = input.oauth_access_token ? encryptString(input.oauth_access_token, encKey) : null;
        const refreshEnc = input.oauth_refresh_token ? encryptString(input.oauth_refresh_token, encKey) : null;
        const expiresAt = input.oauth_expires_at ? new Date(input.oauth_expires_at) : null;
        await upsertConnection(ctx.pool, {
          id: input.id,
          portal_url: input.portal_url,
          auth_type: input.auth_type,
          webhook_url: input.webhook_url ?? null,
          oauth_access_token_enc: accessEnc,
          oauth_refresh_token_enc: refreshEnc,
          oauth_expires_at: expiresAt
        } as any);
        return { ok: true, id: input.id };
      }
    },
    {
      name: "bitrix_mcp_access_token_upsert",
      description: "Create/update a per-user MCP access token mapped to a Bitrix connection. Requires admin token and confirm=true.",
      risky: true,
      inputSchema: z
        .object({
          id: z.string().min(1),
          token: z.string().min(16),
          label: z.string().min(1),
          bitrix_connection_id: z.string().min(1),
          bitrix_user_id: z.number().int().positive().optional(),
          actor_name: z.string().optional(),
          active: z.boolean().optional()
        })
        .merge(baseInput),
      handler: async (ctx, input) => {
        requireAdmin(ctx, "bitrix_mcp_access_token_upsert");
        requireConfirm("bitrix_mcp_access_token_upsert", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        await upsertMcpAccessToken({
          pool: ctx.pool,
          id: input.id,
          token: input.token,
          label: input.label,
          bitrixConnectionId: input.bitrix_connection_id,
          bitrixUserId: input.bitrix_user_id,
          actorName: input.actor_name,
          active: input.active ?? true
        });
        return {
          ok: true,
          id: input.id,
          label: input.label,
          bitrixConnectionId: input.bitrix_connection_id,
          active: input.active ?? true,
          note: "Token stored as SHA-256 hash; plaintext token is not returned by the server."
        };
      }
    },
    {
      name: "bitrix_mcp_access_token_list",
      description: "List MCP access tokens without secrets. Shows owner, connection, active status, and last usage. Requires admin token.",
      risky: false,
      inputSchema: z
        .object({
          active: z.boolean().optional(),
          limit: z.number().int().positive().max(500).optional()
        })
        .merge(baseInput),
      handler: async (ctx, input) => {
        requireAdmin(ctx, "bitrix_mcp_access_token_list");

        const items = await listMcpAccessTokens(ctx.pool, {
          active: input.active,
          limit: input.limit
        });

        return {
          ok: true,
          count: items.length,
          items
        };
      }
    },
    {
      name: "bitrix_mcp_access_token_revoke",
      description: "Disable a per-user MCP access token by id. Requires admin token and confirm=true.",
      risky: true,
      inputSchema: z
        .object({
          id: z.string().min(1)
        })
        .merge(baseInput),
      handler: async (ctx, input) => {
        requireAdmin(ctx, "bitrix_mcp_access_token_revoke");
        requireConfirm("bitrix_mcp_access_token_revoke", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);

        const revoked = await revokeMcpAccessToken(ctx.pool, input.id);

        return {
          ok: true,
          id: input.id,
          revoked,
          active: revoked ? false : undefined,
          note: revoked ? "Token disabled." : "Token was not found or was already inactive."
        };
      }
    },
    {
      name: "bitrix_user_search",
      description: "Search Bitrix24 users with pagination. Use start from previous response.next to fetch next page.",
      risky: false,
      inputSchema: z
        .object({
          query: z.string().optional(),
          limit: z.number().int().positive().optional(),
          start: z.number().int().nonnegative().optional(),
          active: z.boolean().optional()
        })
        .merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const users = new BitrixUsersService(client);

        const query = typeof input.query === "string" ? input.query.trim() : "";

        // Backward-compatible mode for already-published ChatGPT action:
        // call existing bitrix_user_search with query="*" or query="__all__"
        // to fetch all users by following Bitrix pagination internally.
        if (query === "*" || query.toLowerCase() === "__all__" || query.toLowerCase() === "all") {
          const res = await users.listAll({
            query: undefined,
            limit: input.limit,
            active: input.active,
            maxUsers: input.max_users ?? 5000
          });
          return { connectionId, res };
        }

        const res = await users.search({
          query: input.query,
          limit: input.limit,
          start: input.start,
          active: input.active
        });
        return { connectionId, res };
      }
    },
    {
      name: "bitrix_user_list_all",
      description: "Fetch all Bitrix24 users by automatically following pagination. Useful for local employee directory export.",
      risky: false,
      inputSchema: z
        .object({
          query: z.string().optional(),
          limit: z.number().int().positive().optional(),
          active: z.boolean().optional(),
          max_users: z.number().int().positive().optional()
        })
        .merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const users = new BitrixUsersService(client);
        const res = await users.listAll({
          query: input.query,
          limit: input.limit,
          active: input.active,
          maxUsers: input.max_users
        });
        return { connectionId, res };
      }
    },
    {
      name: "bitrix_task_fields",
      description: "Get tasks fields metadata.",
      risky: false,
      inputSchema: baseInput,
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.taskFields() };
      }
    },
    {
      name: "bitrix_task_list",
      description: "List tasks with Bitrix tasks.task.list params (order/filter/select/start).",
      risky: false,
      inputSchema: z.object({ params: z.record(z.any()).default({}) }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.taskList(input.params) };
      }
    },
    {
      name: "bitrix_task_get",
      description: "Get a task by id; includes normalized payload.",
      risky: false,
      inputSchema: z.object({ task_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        const res = await tasks.taskGet(input.task_id);
        const rawTask = (res.result as any)?.task ?? (res.result as any) ?? {};
        const normalized = await tasks.normalizeTaskPayload(rawTask);
        return { connectionId, raw: rawTask, normalized, res };
      }
    },
    {
      name: "bitrix_task_create",
      description: "Create task via tasks.task.add. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ fields: z.record(z.any()) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_create", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.taskCreate(input.fields) };
      }
    },
    {
      name: "bitrix_crm_deal_create",
      description: "Create CRM deal via crm.deal.add. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({
        fields: z.record(z.any()),
        params: z.record(z.any()).optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_crm_deal_create", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const crm = new BitrixCrmService(client);
        return { connectionId, res: await crm.dealAdd(input.fields, input.params) };
      }
    },
    {
      name: "bitrix_crm_deal_get",
      description: "Get CRM deal by id via crm.deal.get.",
      risky: false,
      inputSchema: z.object({ id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const crm = new BitrixCrmService(client);
        return { connectionId, res: await crm.dealGet(input.id) };
      }
    },
    {
      name: "bitrix_crm_deal_fields",
      description: "Get CRM deal fields metadata via crm.deal.fields.",
      risky: false,
      inputSchema: baseInput,
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const crm = new BitrixCrmService(client);
        return { connectionId, res: await crm.dealFields() };
      }
    },
    {
      name: "bitrix_crm_deal_category_list",
      description: "List CRM deal categories via crm.dealcategory.list.",
      risky: false,
      inputSchema: z.object({ params: z.record(z.any()).default({}) }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const crm = new BitrixCrmService(client);
        return { connectionId, res: await crm.dealCategoryList(input.params) };
      }
    },
    {
      name: "bitrix_crm_deal_stage_list",
      description: "List CRM deal stages via crm.status.list for DEAL_STAGE category.",
      risky: false,
      inputSchema: z.object({ entity_id: z.string().min(1) }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const crm = new BitrixCrmService(client);
        return { connectionId, res: await crm.dealStageList(input.entity_id) };
      }
    },
    {
      name: "bitrix_task_update",
      description: "Update task via tasks.task.update. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ task_id: z.number().int().positive(), fields: z.record(z.any()) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_update", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.taskUpdate(input.task_id, input.fields) };
      }
    },
    {
      name: "bitrix_task_complete",
      description: "Complete task. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ task_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_complete", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.taskComplete(input.task_id) };
      }
    },
    {
      name: "bitrix_task_defer",
      description: "Defer task. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ task_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_defer", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.taskDefer(input.task_id) };
      }
    },
    {
      name: "bitrix_task_comments_get",
      description: "Get task discussion messages via task chat (new card) with legacy fallback.",
      risky: false,
      inputSchema: z.object({ task_id: z.number().int().positive(), chat_id: z.string().optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.taskCommentsGet(input.task_id, input.chat_id) };
      }
    },
    {
      name: "bitrix_task_comment_add",
      description: "Add comment/message into task context (prefers task chat send). Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ task_id: z.number().int().positive(), message: z.string().min(1), legacy: z.boolean().optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_comment_add", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        const res = input.legacy ? await tasks.legacyCommentAdd(input.task_id, input.message) : await tasks.taskChatSend(input.task_id, input.message);
        return { connectionId, res };
      }
    },
    {
      name: "bitrix_task_chat_send",
      description: "Send message into task chat via tasks.task.chat.message.send. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ task_id: z.number().int().positive(), message: z.string().min(1) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_chat_send", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.taskChatSend(input.task_id, input.message) };
      }
    },
    {
      name: "bitrix_task_results_get",
      description: "Get task results via tasks.task.result.list.",
      risky: false,
      inputSchema: z.object({ task_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.taskResultsGet(input.task_id) };
      }
    },
    {
      name: "bitrix_task_checklist_get",
      description: "List checklist items for a task.",
      risky: false,
      inputSchema: z.object({ task_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.checklistGet(input.task_id) };
      }
    },
    {
      name: "bitrix_task_checklist_add",
      description: "Add checklist item. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ task_id: z.number().int().positive(), title: z.string().min(1) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_checklist_add", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.checklistAdd(input.task_id, input.title) };
      }
    },
    {
      name: "bitrix_task_checklist_update",
      description: "Update checklist item. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ task_id: z.number().int().positive(), item_id: z.number().int().positive(), fields: z.record(z.any()) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_checklist_update", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.checklistUpdate(input.task_id, input.item_id, input.fields) };
      }
    },
    {
      name: "bitrix_task_checklist_delete",
      description: "Delete checklist item. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ task_id: z.number().int().positive(), item_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_checklist_delete", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.checklistDelete(input.task_id, input.item_id) };
      }
    },
    {
      name: "bitrix_task_reminder_add",
      description: "Add reminder to task. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ task_id: z.number().int().positive(), user_id: z.number().int().positive(), remind_at: z.string().min(1) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_reminder_add", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        return { connectionId, res: await tasks.reminderAdd(input.task_id, input.user_id, input.remind_at) };
      }
    },
    {
      name: "bitrix_task_participants_update",
      description: "Update task participants via tasks.task.update fields (ACCOMPLICES/AUDITORS). Requires confirm=true.",
      risky: true,
      inputSchema: z
        .object({
          task_id: z.number().int().positive(),
          accomplices: z.array(z.number().int().positive()).optional(),
          auditors: z.array(z.number().int().positive()).optional()
        })
        .merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_task_participants_update", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client, capabilities } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const tasks = new BitrixTasksService(client, capabilities);
        const fields: Record<string, unknown> = {};
        if (input.accomplices) fields.ACCOMPLICES = input.accomplices;
        if (input.auditors) fields.AUDITORS = input.auditors;
        return { connectionId, res: await tasks.taskUpdate(input.task_id, fields) };
      }
    },
    {
      name: "bitrix_task_sync_recent",
      description: "Polling sync: fetch recently changed tasks and persist to local DB.",
      risky: false,
      inputSchema: z.object({ max_tasks: z.number().int().positive().optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        return syncRecentTasks({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64,
          maxTasks: input.max_tasks
        });
      }
    },
    {
      name: "bitrix_sync_task_by_id",
      description: "Sync single task by id into local DB (task + messages).",
      risky: false,
      inputSchema: z.object({ task_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        return syncTaskById({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64,
          taskId: input.task_id
        });
      }
    },
    {
      name: "bitrix_im_recent_list",
      description: "List recent dialogs/chats from Bitrix IM.",
      risky: false,
      inputSchema: baseInput,
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const im = new BitrixImService(client);
        return { connectionId, res: await im.recentList() };
      }
    },
    {
      name: "bitrix_im_dialog_messages_get",
      description: "Read messages from a Bitrix IM dialog/chat.",
      risky: false,
      inputSchema: z.object({ dialog_id: z.string().min(1), limit: z.number().int().positive().optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const im = new BitrixImService(client);
        return { connectionId, res: await im.dialogMessagesGet(input.dialog_id, input.limit) };
      }
    },
    {
      name: "bitrix_im_message_add",
      description: "Send message to a Bitrix IM dialog/chat. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ dialog_id: z.string().min(1), message: z.string().min(1) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_im_message_add", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const im = new BitrixImService(client);
        return { connectionId, res: await im.messageAdd(input.dialog_id, input.message) };
      }
    },
    {
      name: "bitrix_im_notify_personal_add",
      description: "Send personal notification to Bitrix user. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ user_id: z.number().int().positive(), message: z.string().min(1) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_im_notify_personal_add", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const im = new BitrixImService(client);
        return { connectionId, res: await im.notifyPersonalAdd(input.user_id, input.message) };
      }
    },
    {
      name: "bitrix_disk_storage_list",
      description: "List Bitrix Disk storages.",
      risky: false,
      inputSchema: baseInput,
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);
        return { connectionId, res: await disk.storageList() };
      }
    },
    {
      name: "bitrix_disk_folder_get",
      description: "Get folder metadata.",
      risky: false,
      inputSchema: z.object({ folder_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);
        return { connectionId, res: await disk.folderGet(input.folder_id) };
      }
    },
    {
      name: "bitrix_disk_folder_children",
      description: "List folder children.",
      risky: false,
      inputSchema: z.object({ folder_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);
        return { connectionId, res: await disk.folderChildren(input.folder_id) };
      }
    },
    {
      name: "bitrix_disk_folder_create",
      description: "Create subfolder. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ parent_folder_id: z.number().int().positive(), name: z.string().min(1) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_disk_folder_create", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);
        return { connectionId, res: await disk.folderCreate(input.parent_folder_id, input.name) };
      }
    },
    {
      name: "bitrix_disk_folder_upload",
      description: "Upload file into Bitrix Disk folder. Supports local_path, text_content, or base64_content. Requires confirm=true.",
      risky: true,
      inputSchema: z
        .object({
          folder_id: z.number().int().positive(),
          local_path: z.string().optional(),
          filename: z.string().optional(),
          text_content: z.string().optional(),
          base64_content: z.string().optional()
        })
        .merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_disk_folder_upload", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);

        if (input.text_content !== undefined) {
          if (!input.filename) throw new Error("filename is required when using text_content");
          return {
            connectionId,
            res: await disk.createTextFile({
              folderId: input.folder_id,
              filename: input.filename,
              content: input.text_content
            })
          };
        }

        if (input.base64_content !== undefined) {
          if (!input.filename) throw new Error("filename is required when using base64_content");
          return {
            connectionId,
            res: await disk.uploadBase64File({
              folderId: input.folder_id,
              filename: input.filename,
              base64Content: input.base64_content
            })
          };
        }

        if (!input.local_path) {
          throw new Error("Provide one of local_path, text_content, or base64_content");
        }

        return {
          connectionId,
          res: await disk.folderUploadFile({
            folderId: input.folder_id,
            localPath: input.local_path,
            filename: input.filename
          })
        };
      }
    },
    {
      name: "bitrix_disk_file_create_text",
      description: "Create a text file in Bitrix Disk folder from provided content. Useful for txt/csv/json/md reports. Requires confirm=true.",
      risky: true,
      inputSchema: z
        .object({
          folder_id: z.number().int().positive(),
          filename: z.string().min(1),
          content: z.string()
        })
        .merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_disk_file_create_text", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);
        return {
          connectionId,
          res: await disk.createTextFile({
            folderId: input.folder_id,
            filename: input.filename,
            content: input.content
          })
        };
      }
    },
    {
      name: "bitrix_disk_file_upload_base64",
      description: "Upload a binary file to Bitrix Disk folder from base64 content. Useful for xlsx/pdf/docx/zip. Requires confirm=true.",
      risky: true,
      inputSchema: z
        .object({
          folder_id: z.number().int().positive(),
          filename: z.string().min(1),
          base64_content: z.string().min(1)
        })
        .merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_disk_file_upload_base64", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);
        return {
          connectionId,
          res: await disk.uploadBase64File({
            folderId: input.folder_id,
            filename: input.filename,
            base64Content: input.base64_content
          })
        };
      }
    },
    {
      name: "bitrix_disk_file_get",
      description: "Get file metadata.",
      risky: false,
      inputSchema: z.object({ file_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);
        return { connectionId, res: await disk.fileGet(input.file_id) };
      }
    },
    {
      name: "bitrix_disk_file_download",
      description: "Get a download URL for a disk file (if supported).",
      risky: false,
      inputSchema: z.object({ file_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);
        // Try getDownloadUrl; if not available, return file.get response.
        try {
          return { connectionId, res: await disk.fileDownloadUrl(input.file_id) };
        } catch {
          return { connectionId, res: await disk.fileGet(input.file_id), note: "disk.file.getDownloadUrl not supported; returning disk.file.get" };
        }
      }
    },
    {
      name: "bitrix_disk_move",
      description: "Move file/folder to another folder. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ object_type: z.enum(["file", "folder"]), object_id: z.number().int().positive(), target_folder_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_disk_move", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);
        return { connectionId, res: await disk.move({ objectType: input.object_type, objectId: input.object_id, targetFolderId: input.target_folder_id }) };
      }
    },
    {
      name: "bitrix_disk_share_to_user",
      description: "Share disk folder to user (rights). Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ folder_id: z.number().int().positive(), user_id: z.number().int().positive(), access: z.string().optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_disk_share_to_user", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const disk = new BitrixDiskService(client);
        return { connectionId, res: await disk.shareFolderToUser(input.folder_id, input.user_id, input.access) };
      }
    },
    {
      name: "bitrix_rest_call_readonly",
      description: "Diagnostic read-only Bitrix REST call. Blocks mutating methods like add/update/delete/set.",
      risky: false,
      inputSchema: z.object({
        method: z.string().min(1),
        params: z.record(z.any()).optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const method = String(input.method);
        const lower = method.toLowerCase();

        const forbiddenParts = [
          ".add",
          ".update",
          ".delete",
          ".remove",
          ".set",
          ".bind",
          ".unbind",
          ".start",
          ".complete",
          ".send",
          ".upload",
          ".move",
          ".copy"
        ];

        if (forbiddenParts.some((part) => lower.includes(part))) {
          throw new AppError(`Method '${method}' is not allowed in read-only diagnostic tool`, "READONLY_METHOD_FORBIDDEN", { status: 403 });
        }

        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });

        return { connectionId, method, res: await client.call(method, input.params ?? {}) };
      }
    },
    {
      name: "bitrix_rest_v3_call_readonly",
      description: "Diagnostic read-only Bitrix REST v3 call via /rest/api/. Blocks mutating methods like add/update/delete/set.",
      risky: false,
      inputSchema: z.object({
        method: z.string().min(1),
        params: z.record(z.any()).optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const method = String(input.method);
        const lower = method.toLowerCase();

        const forbiddenParts = [
          ".add",
          ".create",
          ".update",
          ".delete",
          ".remove",
          ".set",
          ".bind",
          ".unbind",
          ".start",
          ".complete",
          ".send",
          ".upload",
          ".move",
          ".copy"
        ];

        if (forbiddenParts.some((part) => lower.includes(part))) {
          throw new AppError(`REST v3 method '${method}' is not allowed in read-only diagnostic tool`, "READONLY_METHOD_FORBIDDEN", { status: 403 });
        }

        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });

        return { connectionId, method, res: await client.callV3(method, input.params ?? {}) };
      }
    },
    {
      name: "bitrix_task_context_bulk_get",
      description: "Bulk read compact basic task info for several task IDs. For comments, checklist, and results use separate task tools.",
      risky: false,
      inputSchema: z.object({
        task_ids: z.array(z.number().int().positive()).min(1).max(20),
        include_comments: z.boolean().optional(),
        include_checklist: z.boolean().optional(),
        include_results: z.boolean().optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });

        const items = [];

        for (const taskId of input.task_ids) {
          const item: any = {
            taskId,
            task: null
          };

          try {
            const taskRes = await client.call("tasks.task.get", { taskId });
            const rawTask = (taskRes as any)?.task ?? (taskRes as any)?.result?.task ?? (taskRes as any)?.result ?? taskRes;
            item.task = normalizeBulkTask(rawTask);
            item.ok = true;
          } catch (err: any) {
            item.ok = false;
            item.error = {
              message: err?.message ?? String(err),
              code: err?.code,
              status: err?.status
            };
          }

          if (input.include_comments || input.include_checklist || input.include_results) {
            item.note = "Extra blocks are intentionally skipped in bulk context. Use bitrix_task_comments_get, bitrix_task_checklist_get, or bitrix_task_results_get separately.";
          }

          items.push(item);
        }

        return {
          connectionId,
          count: items.length,
          items
        };
      }
    },
    {
      name: "bitrix_task_search_batch",
      description: "Find several Bitrix tasks by IDs and return compact normalized task rows.",
      risky: false,
      inputSchema: z.object({
        task_ids: z.array(z.number().int().positive()).min(1).max(20)
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });

        const results = [];

        for (const taskId of input.task_ids) {
          const params = {
            filter: { ID: taskId },
            select: [
              "ID",
              "TITLE",
              "STATUS",
              "RESPONSIBLE_ID",
              "CREATED_BY",
              "CREATED_DATE",
              "CHANGED_DATE",
              "DEADLINE",
              "CLOSED_DATE",
              "PRIORITY",
              "GROUP_ID"
            ],
            start: 0
          };

          try {
            const res = await client.call("tasks.task.list", params);
            const tasks = extractTaskListItems(res).slice(0, 1).map(normalizeBulkTask);

            results.push({
              taskId,
              ok: true,
              found: tasks.length > 0,
              task: tasks[0] ?? null,
              total: (res as any)?.total ?? null
            });
          } catch (err: any) {
            results.push({
              taskId,
              ok: false,
              error: {
                message: err?.message ?? String(err),
                code: err?.code,
                status: err?.status,
                details: err?.details,
                stackPreview: typeof err?.stack === "string" ? err.stack.slice(0, 1000) : undefined
              }
            });
          }
        }

        return {
          connectionId,
          count: results.length,
          results
        };
      }
    },
    {
      name: "bitrix_note_collection_list",
      description: "REST v3 Note: list knowledge base collections.",
      risky: false,
      inputSchema: z.object({
        pagination: z.record(z.any()).optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const note = new BitrixNoteService(client);
        return { connectionId, res: await note.collectionList(input.pagination) };
      }
    },
    {
      name: "bitrix_note_collection_get",
      description: "REST v3 Note: get one knowledge base collection by ID.",
      risky: false,
      inputSchema: z.object({
        id: z.number().int().positive(),
        select: z.array(z.string()).optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const note = new BitrixNoteService(client);
        return { connectionId, res: await note.collectionGet(input.id, input.select) };
      }
    },
    {
      name: "bitrix_note_document_tree",
      description: "REST v3 Note: list document tree for a knowledge base collection.",
      risky: false,
      inputSchema: z.object({
        collection_id: z.number().int().positive()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const note = new BitrixNoteService(client);
        return { connectionId, res: await note.documentTreeList(input.collection_id) };
      }
    },
    {
      name: "bitrix_note_document_get",
      description: "REST v3 Note: get a document by ID. Markdown is excluded by default; use include_markdown=true to request it with truncation protection.",
      risky: false,
      inputSchema: z.object({
        id: z.number().int().positive(),
        include_markdown: z.boolean().optional(),
        markdown_limit: z.number().int().positive().max(100000).optional(),
        select: z.array(z.string()).optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const note = new BitrixNoteService(client);
        return {
          connectionId,
          res: await note.documentGetSafe(input.id, {
            includeMarkdown: input.include_markdown,
            markdownLimit: input.markdown_limit,
            select: input.select
          })
        };
      }
    },
    {
      name: "bitrix_note_document_search",
      description: "REST v3 Note: search knowledge base documents.",
      risky: false,
      inputSchema: z.object({
        query: z.string().min(1),
        pagination: z.record(z.any()).optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const note = new BitrixNoteService(client);
        return { connectionId, res: await note.documentSearchList(input.query, input.pagination) };
      }
    },
    {
      name: "bitrix_kb_site_list",
      description: "List knowledge base sites (landing TYPE=KNOWLEDGE).",
      risky: false,
      inputSchema: baseInput,
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const kb = new BitrixKnowledgeService(client);
        return { connectionId, res: await kb.kbSiteList() };
      }
    },
    {
      name: "bitrix_kb_site_list_raw",
      description: "List all Bitrix landing sites without TYPE filter. Useful for diagnosing knowledge base IDs.",
      risky: false,
      inputSchema: baseInput,
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const kb = new BitrixKnowledgeService(client);
        return { connectionId, res: await kb.kbSiteListRaw() };
      }
    },
    {
      name: "bitrix_kb_page_list_full",
      description: "List knowledge base landing pages for a site with extended metadata.",
      risky: false,
      inputSchema: z.object({ site_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const kb = new BitrixKnowledgeService(client);
        return { connectionId, res: await kb.kbPageListFull(input.site_id) };
      }
    },
    {
      name: "bitrix_kb_page_find_by_id",
      description: "Find a knowledge base landing page by landing/page ID.",
      risky: false,
      inputSchema: z.object({ page_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const kb = new BitrixKnowledgeService(client);
        return { connectionId, res: await kb.kbPageFindById(input.page_id) };
      }
    },
    {
      name: "bitrix_kb_find_by_url",
      description: "Diagnose Bitrix knowledge base URL and find candidate site/page IDs.",
      risky: false,
      inputSchema: z.object({ url: z.string().min(1) }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const kb = new BitrixKnowledgeService(client);
        return { connectionId, res: await kb.kbFindByUrl(input.url) };
      }
    },
    {
      name: "bitrix_kb_site_create",
      description: "Create knowledge base site. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ title: z.string().min(1), code: z.string().optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_kb_site_create", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const kb = new BitrixKnowledgeService(client);
        return { connectionId, res: await kb.kbSiteCreate({ title: input.title, code: input.code }) };
      }
    },
    {
      name: "bitrix_kb_page_list",
      description: "List knowledge base pages for a site.",
      risky: false,
      inputSchema: z.object({ site_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const kb = new BitrixKnowledgeService(client);
        return { connectionId, res: await kb.kbPageList(input.site_id) };
      }
    },
    {
      name: "bitrix_kb_page_create",
      description: "Create knowledge base page. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ site_id: z.number().int().positive(), title: z.string().min(1), code: z.string().optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_kb_page_create", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const kb = new BitrixKnowledgeService(client);
        return { connectionId, res: await kb.kbPageCreate({ siteId: input.site_id, title: input.title, code: input.code }) };
      }
    },
    {
      name: "bitrix_kb_page_update",
      description: "Update knowledge base page metadata. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ page_id: z.number().int().positive(), title: z.string().optional(), code: z.string().optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_kb_page_update", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const kb = new BitrixKnowledgeService(client);
        return { connectionId, res: await kb.kbPageUpdate({ pageId: input.page_id, title: input.title, code: input.code }) };
      }
    },
    {
      name: "bitrix_kb_page_add_block",
      description: "Add landing block to knowledge page. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ page_id: z.number().int().positive(), code: z.string().min(1), content: z.string().min(1) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_kb_page_add_block", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const kb = new BitrixKnowledgeService(client);
        return { connectionId, res: await kb.kbPageAddBlock({ pageId: input.page_id, code: input.code, content: input.content }) };
      }
    },
    {
      name: "bitrix_bizproc_template_list",
      description: "List bizproc templates.",
      risky: false,
      inputSchema: z.object({ params: z.record(z.any()).optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const bp = new BitrixBizprocService(client);
        return { connectionId, res: await bp.templateList(input.params ?? {}) };
      }
    },
    {
      name: "bitrix_bizproc_start",
      description: "Start a bizproc workflow. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ template_id: z.number().int().positive(), document_id: z.any(), parameters: z.record(z.any()).optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_bizproc_start", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const bp = new BitrixBizprocService(client);
        return { connectionId, res: await bp.start({ templateId: input.template_id, documentId: input.document_id, parameters: input.parameters }) };
      }
    },
    {
      name: "bitrix_bizproc_instances",
      description: "List workflow instances.",
      risky: false,
      inputSchema: z.object({ params: z.record(z.any()).optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const bp = new BitrixBizprocService(client);
        return { connectionId, res: await bp.instances(input.params ?? {}) };
      }
    },
    {
      name: "bitrix_bizproc_template_update_if_supported",
      description: "Attempt to update bizproc template (rights-dependent). Requires confirm=true.",
      risky: true,
      inputSchema: z.object({ template_id: z.number().int().positive(), fields: z.record(z.any()) }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_bizproc_template_update_if_supported", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const bp = new BitrixBizprocService(client);
        return { connectionId, res: await bp.templateUpdateIfSupported({ templateId: input.template_id, fields: input.fields }) };
      }
    },
    {
      name: "bitrix_report_task_summary",
      description: "Local DB report: completed tasks summary.",
      risky: false,
      inputSchema: z.object({ since: z.string().optional(), until: z.string().optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const reports = new ReportsService(ctx.pool);
        return reports.completedTasksSummary({ connectionId, since: input.since, until: input.until });
      }
    },
    {
      name: "bitrix_report_task_timeline",
      description: "Local DB report: task snapshots + messages timeline.",
      risky: false,
      inputSchema: z.object({ task_id: z.number().int().positive() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const reports = new ReportsService(ctx.pool);
        return reports.taskTimeline({ connectionId, taskId: input.task_id });
      }
    },
    {
      name: "bitrix_report_user_load",
      description: "Local DB report: open tasks count per responsible user.",
      risky: false,
      inputSchema: baseInput,
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const reports = new ReportsService(ctx.pool);
        return reports.userWorkload({ connectionId });
      }
    },
    {
      name: "bitrix_sync_full",
      description: "MVP: runs recent-tasks sync (extend with disk/kb/bizproc sync later).",
      risky: false,
      inputSchema: z.object({ max_tasks: z.number().int().positive().optional() }).merge(baseInput),
      handler: async (ctx, input) => {
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        return syncRecentTasks({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64,
          maxTasks: input.max_tasks
        });
      }
    }
  ];
}

export function createMcpServer(ctx: Ctx) {
  const server = new Server(
    { name: "b24-bp-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  const tools = toolList();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: (() => {
          const schema = zodToJsonSchema(t.inputSchema, { $refStrategy: "none" }) as any;
          delete schema.$schema;
          return schema;
        })()
      }))
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };

    const rawArgs = req.params.arguments ?? {};
    let connectionId = resolveConnectionId(ctx, rawArgs);
    const actor = ctx.requestAuth?.actor ?? (req as any)?.meta?.client ?? undefined;

    try {
      const input = withResolvedConnection(ctx, tool.inputSchema.parse(rawArgs));
      connectionId = input.connection_id;
      const result = await tool.handler(ctx, input);
      if (tool.risky) {
        await writeAuditLog({
          pool: ctx.pool,
          connectionId,
          tool: tool.name,
          risky: true,
          actor,
          request: redactSecrets(input),
          result
        });
      } else if (tool.name === "bitrix_connection_upsert") {
        // already treated as risky by definition, but keep path explicit
      }
      return jsonResult(result);
    } catch (e: any) {
      const errJson = {
        error: e?.code ?? "ERROR",
        message: e?.message ?? String(e),
        details: e?.details ?? undefined
      };
      if (tool.risky) {
        await writeAuditLog({
          pool: ctx.pool,
          connectionId,
          tool: tool.name,
          risky: true,
          actor,
          request: redactSecrets(rawArgs),
          result: errJson
        });
      }
      return { content: [{ type: "text", text: JSON.stringify(errJson, null, 2) }], isError: true };
    }
  });

  async function start() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    ctx.logger.info("MCP server started (stdio)");
  }

  return { server, start };
}
