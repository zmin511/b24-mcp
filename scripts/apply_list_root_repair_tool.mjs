import fs from "node:fs";
import { stdout } from "node:process";
import { URL } from "node:url";

const path = new URL("../src/mcp/server.ts", import.meta.url);
let source = fs.readFileSync(path, "utf8");

if (!source.includes('name: "bitrix_list_repair_root_batch"')) {
  const anchor = `    {\n      name: "bitrix_list_import_batch",`;
  if (!source.includes(anchor)) throw new Error("bitrix_list_import_batch anchor not found in src/mcp/server.ts");

  const block = String.raw`    {
      name: "bitrix_list_repair_root_batch",
      description: "Safely repair list elements accidentally created at the list root: verify the source ID/name is in root, ensure a verified copy exists in the requested section, then delete only the verified root source. dry_run=true by default; real repair requires confirm=true.",
      risky: true,
      inputSchema: z.object({
        iblock_type_id: z.string().min(1),
        iblock_id: z.number().int().positive(),
        dry_run: z.boolean().optional(),
        items: z.array(z.object({
          source_element_id: z.number().int().positive(),
          parent_section_id: z.number().int().nonnegative(),
          section_name: z.string().min(1).max(255),
          name: z.string().min(1).max(255)
        })).min(1).max(500)
      }).merge(baseInput),
      handler: async (ctx, input) => {
        const dryRun = input.dry_run !== false;
        if (!dryRun) requireConfirm("bitrix_list_repair_root_batch", input, ctx.config.ALLOW_UNCONFIRMED_WRITES);
        const connectionId = input.connection_id ?? ctx.config.BITRIX_DEFAULT_CONNECTION_ID;
        const { client } = await createBitrixClientForConnection({
          pool: ctx.pool,
          logger: ctx.logger,
          connectionId,
          encryptionKeyBase64: ctx.config.APP_ENCRYPTION_KEY_BASE64
        });
        const lists = new BitrixListsService(client);
        const listCtx = { iblockTypeId: input.iblock_type_id, iblockId: input.iblock_id };
        const normalizeName = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
        const sectionCache = new Map<string, any>();
        const results: any[] = [];

        for (let index = 0; index < input.items.length; index++) {
          const row = input.items[index];
          const out: any = {
            index,
            source_element_id: row.source_element_id,
            name: row.name,
            section_name: row.section_name,
            resolved_section_id: null
          };
          try {
            const sourceElement = await lists.getElement(listCtx, row.source_element_id);
            if (!sourceElement) {
              out.status = "skipped";
              out.action = "source_not_found";
              results.push(out);
              continue;
            }

            const sourceSectionId = Number(sourceElement.IBLOCK_SECTION_ID ?? 0) || 0;
            if (sourceSectionId !== 0) {
              throw new Error("Source element " + row.source_element_id + " is not in list root; actual section=" + sourceSectionId);
            }
            if (normalizeName(sourceElement.NAME) !== normalizeName(row.name)) {
              throw new Error("Source element " + row.source_element_id + " name does not match expected name");
            }

            const sectionKey = String(row.parent_section_id) + "|" + normalizeName(row.section_name);
            let section = sectionCache.get(sectionKey);
            if (!section) {
              section = await lists.findSectionByName(listCtx, row.parent_section_id, row.section_name);
              if (!section) throw new Error("Target section '" + row.section_name + "' under " + row.parent_section_id + " was not found");
              sectionCache.set(sectionKey, section);
            }
            const sectionId = Number(section.ID);
            out.resolved_section_id = sectionId;

            const existingTarget = await lists.findElementByName(listCtx, sectionId, row.name);
            if (dryRun) {
              out.status = "planned";
              out.action = existingTarget ? "would_delete_verified_root_source" : "would_create_target_then_delete_root_source";
              out.target_element_id = existingTarget ? Number(existingTarget.ID) : null;
              results.push(out);
              continue;
            }

            let target = existingTarget;
            if (!target) {
              const created = await lists.addElement(listCtx, { sectionId, name: row.name });
              target = created.object;
              out.target_created = created.status === "created";
            } else {
              out.target_created = false;
            }

            if (!target || Number(target.IBLOCK_SECTION_ID ?? 0) !== sectionId || normalizeName(target.NAME) !== normalizeName(row.name)) {
              throw new Error("Target verification failed for '" + row.name + "' in section " + sectionId);
            }
            out.target_element_id = Number(target.ID);

            const deleted = await lists.deleteElement(listCtx, row.source_element_id);
            if (deleted.status !== "deleted" && deleted.status !== "skipped") {
              throw new Error("Unexpected delete status for source " + row.source_element_id);
            }

            out.status = "repaired";
            out.action = "target_verified_root_source_deleted";
            results.push(out);
          } catch (err: any) {
            out.status = "failed";
            out.action = "failed";
            out.error = { code: err?.code, message: err?.message ?? String(err) };
            results.push(out);
          }
        }

        const count = (status: string) => results.filter((row) => row.status === status).length;
        return {
          connectionId,
          dry_run: dryRun,
          total: results.length,
          planned: count("planned"),
          repaired: count("repaired"),
          skipped: count("skipped"),
          failed: count("failed"),
          results
        };
      }
    },
`;

  source = source.replace(anchor, `${block}${anchor}`);
}

fs.writeFileSync(path, source, "utf8");
stdout.write("Applied safe Bitrix list root repair MCP tool\n");
