import fs from "node:fs";

const path = new URL("../src/mcp/server.ts", import.meta.url);
let source = fs.readFileSync(path, "utf8");

const importLine = 'import { BitrixListsService } from "../modules/lists/service.js";';
if (!source.includes(importLine)) {
  const anchor = 'import { BitrixCrmService } from "../modules/crm/service.js";';
  if (!source.includes(anchor)) throw new Error("Import anchor not found in src/mcp/server.ts");
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

if (!source.includes('name: "bitrix_list_section_add"')) {
  const anchor = `    {\n      name: "bitrix_rest_call_readonly",`;
  if (!source.includes(anchor)) throw new Error("Tool insertion anchor not found in src/mcp/server.ts");

  const block = String.raw`    {
      name: "bitrix_list_section_add",
      description: "Create a Bitrix24 universal-list section with duplicate protection and read-after-write verification. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({
        iblock_type_id: z.string().min(1),
        iblock_id: z.number().int().positive(),
        parent_section_id: z.number().int().nonnegative(),
        name: z.string().min(1).max(255),
        sort: z.number().int().default(500)
      }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_list_section_add", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const lists = new BitrixListsService(client);
        const res = await lists.addSection(
          { iblockTypeId: input.iblock_type_id, iblockId: input.iblock_id },
          { parentSectionId: input.parent_section_id, name: input.name, sort: input.sort }
        );
        return { connectionId, res };
      }
    },
    {
      name: "bitrix_list_section_update",
      description: "Update a Bitrix24 universal-list section with duplicate protection and read-after-write verification. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({
        iblock_type_id: z.string().min(1),
        iblock_id: z.number().int().positive(),
        section_id: z.number().int().positive(),
        parent_section_id: z.number().int().nonnegative().optional(),
        name: z.string().min(1).max(255).optional(),
        sort: z.number().int().optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        if (input.parent_section_id === undefined && input.name === undefined && input.sort === undefined) {
          throw new Error("Nothing to update: provide parent_section_id, name, or sort");
        }
        requireConfirm("bitrix_list_section_update", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const lists = new BitrixListsService(client);
        const res = await lists.updateSection(
          { iblockTypeId: input.iblock_type_id, iblockId: input.iblock_id },
          { sectionId: input.section_id, parentSectionId: input.parent_section_id, name: input.name, sort: input.sort }
        );
        return { connectionId, res };
      }
    },
    {
      name: "bitrix_list_section_delete",
      description: "Delete a Bitrix24 universal-list section. dry_run=true by default; real deletion requires confirm=true and confirm_delete_text=DELETE.",
      risky: true,
      inputSchema: z.object({
        iblock_type_id: z.string().min(1),
        iblock_id: z.number().int().positive(),
        section_id: z.number().int().positive(),
        dry_run: z.boolean().optional(),
        confirm_delete_text: z.string().optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const dryRun = input.dry_run !== false;
        if (dryRun) return { ok: true, dry_run: true, action: "would_delete", section_id: input.section_id };
        requireConfirm("bitrix_list_section_delete", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        if (input.confirm_delete_text !== "DELETE") throw new Error("Deletion requires confirm_delete_text=DELETE");
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const lists = new BitrixListsService(client);
        return {
          connectionId,
          dry_run: false,
          res: await lists.deleteSection({ iblockTypeId: input.iblock_type_id, iblockId: input.iblock_id }, input.section_id)
        };
      }
    },
    {
      name: "bitrix_list_element_add",
      description: "Create a Bitrix24 universal-list element with normalized SECTION_ID + NAME duplicate protection. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({
        iblock_type_id: z.string().min(1),
        iblock_id: z.number().int().positive(),
        section_id: z.number().int().nonnegative(),
        name: z.string().min(1).max(255),
        fields: z.record(z.any()).optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        requireConfirm("bitrix_list_element_add", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const lists = new BitrixListsService(client);
        const res = await lists.addElement(
          { iblockTypeId: input.iblock_type_id, iblockId: input.iblock_id },
          { sectionId: input.section_id, name: input.name, fields: input.fields }
        );
        return { connectionId, res };
      }
    },
    {
      name: "bitrix_list_element_update",
      description: "Update a Bitrix24 universal-list element with duplicate protection and read-after-write verification. Requires confirm=true.",
      risky: true,
      inputSchema: z.object({
        iblock_type_id: z.string().min(1),
        iblock_id: z.number().int().positive(),
        element_id: z.number().int().positive(),
        section_id: z.number().int().nonnegative().optional(),
        name: z.string().min(1).max(255).optional(),
        fields: z.record(z.any()).optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        if (input.section_id === undefined && input.name === undefined && input.fields === undefined) {
          throw new Error("Nothing to update: provide section_id, name, or fields");
        }
        requireConfirm("bitrix_list_element_update", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const lists = new BitrixListsService(client);
        const res = await lists.updateElement(
          { iblockTypeId: input.iblock_type_id, iblockId: input.iblock_id },
          { elementId: input.element_id, sectionId: input.section_id, name: input.name, fields: input.fields }
        );
        return { connectionId, res };
      }
    },
    {
      name: "bitrix_list_element_delete",
      description: "Delete a Bitrix24 universal-list element. dry_run=true by default; real deletion requires confirm=true and confirm_delete_text=DELETE.",
      risky: true,
      inputSchema: z.object({
        iblock_type_id: z.string().min(1),
        iblock_id: z.number().int().positive(),
        element_id: z.number().int().positive(),
        dry_run: z.boolean().optional(),
        confirm_delete_text: z.string().optional()
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const dryRun = input.dry_run !== false;
        if (dryRun) return { ok: true, dry_run: true, action: "would_delete", element_id: input.element_id };
        requireConfirm("bitrix_list_element_delete", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        if (input.confirm_delete_text !== "DELETE") throw new Error("Deletion requires confirm_delete_text=DELETE");
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const lists = new BitrixListsService(client);
        return {
          connectionId,
          dry_run: false,
          res: await lists.deleteElement({ iblockTypeId: input.iblock_type_id, iblockId: input.iblock_id }, input.element_id)
        };
      }
    },
    {
      name: "bitrix_list_import_batch",
      description: "Idempotent batch import into Bitrix24 universal lists. dry_run=true by default; real writes require confirm=true. Continues after per-row errors.",
      risky: true,
      inputSchema: z.object({
        iblock_type_id: z.string().min(1),
        iblock_id: z.number().int().positive(),
        dry_run: z.boolean().optional(),
        items: z.array(z.object({
          parent_section_id: z.number().int().nonnegative(),
          section_name: z.string().min(1).max(255),
          section_sort: z.number().int().optional(),
          name: z.string().min(1).max(255),
          fields: z.record(z.any()).optional(),
          update_existing: z.boolean().optional()
        })).min(1).max(500)
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const dryRun = input.dry_run !== false;
        if (!dryRun) requireConfirm("bitrix_list_import_batch", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const lists = new BitrixListsService(client);
        const res = await lists.importBatch(
          { iblockTypeId: input.iblock_type_id, iblockId: input.iblock_id },
          {
            dryRun,
            items: input.items.map((row: any) => ({
              parentSectionId: row.parent_section_id,
              sectionName: row.section_name,
              sectionSort: row.section_sort,
              name: row.name,
              fields: row.fields,
              updateExisting: row.update_existing
            }))
          }
        );
        return { connectionId, ...res };
      }
    },
`;

  source = source.replace(anchor, `${block}${anchor}`);
}

fs.writeFileSync(path, source, "utf8");
console.log("Applied typed Bitrix list MCP tools to src/mcp/server.ts");
