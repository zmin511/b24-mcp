import fs from "node:fs";
import { stdout } from "node:process";
import { URL } from "node:url";

const servicePath = new URL("../src/modules/lists/service.ts", import.meta.url);
let source = fs.readFileSync(servicePath, "utf8");

const updateStartMarker = '    const currentSection = parentId(current.IBLOCK_SECTION_ID);';
const updateEndMarker = '    return { status: "updated" as const, id: input.elementId, object };';
const updateStart = source.indexOf(updateStartMarker);
const updateEnd = source.indexOf(updateEndMarker, updateStart);

if (updateStart < 0 || updateEnd < 0) {
  if (!source.includes('const targetSection = input.sectionId ?? currentSection;')) {
    throw new Error("updateElement replacement anchors not found");
  }
} else {
  const updateReplacement = [
    '    const currentSection = parentId(current.IBLOCK_SECTION_ID);',
    '    const targetSection = input.sectionId ?? currentSection;',
    '    const nextName = input.name ?? String(current.NAME ?? "");',
    '',
    '    if (input.name !== undefined || targetSection !== currentSection) {',
    '      const duplicate = await this.findElementByName(ctx, targetSection, nextName);',
    '      if (duplicate && Number(duplicate.ID) !== input.elementId) {',
    '        return { status: "skipped" as const, reason: "duplicate", id: Number(duplicate.ID), object: duplicate };',
    '      }',
    '    }',
    '',
    '    const preserved: Record<string, unknown> = {};',
    '    for (const [key, value] of Object.entries(current)) {',
    '      if (key.startsWith("PROPERTY_")) preserved[key] = value;',
    '    }',
    '    const updates = sanitizeAdditionalFields(input.fields);',
    '',
    '    await this.client.call("lists.element.update", {',
    '      ...this.base(ctx),',
    '      ELEMENT_ID: input.elementId,',
    '      IBLOCK_SECTION_ID: targetSection,',
    '      FIELDS: { NAME: nextName, IBLOCK_SECTION_ID: targetSection, ...preserved, ...updates }',
    '    });',
    '    const object = await this.getElement(ctx, input.elementId);',
    '    if (!object || Number(object.ID) !== input.elementId) throw new Error("Read-after-write failed for element " + input.elementId);',
    '',
    '    if (!sameId(object.IBLOCK_SECTION_ID, targetSection)) {',
    '      if (targetSection !== currentSection) {',
    '        await this.client.call("lists.element.update", {',
    '          ...this.base(ctx),',
    '          ELEMENT_ID: input.elementId,',
    '          IBLOCK_SECTION_ID: currentSection,',
    '          FIELDS: { NAME: String(current.NAME ?? ""), IBLOCK_SECTION_ID: currentSection, ...preserved }',
    '        });',
    '        const rolledBack = await this.getElement(ctx, input.elementId);',
    '        if (!rolledBack || !sameId(rolledBack.IBLOCK_SECTION_ID, currentSection)) {',
    '          throw new Error("Element " + input.elementId + " failed target section verification and rollback failed");',
    '        }',
    '      }',
    '      throw new Error("Element " + input.elementId + " remained in section " + String(object.IBLOCK_SECTION_ID ?? "root") + " instead of " + targetSection);',
    '    }',
    '',
    '    return { status: "updated" as const, id: input.elementId, object };'
  ].join("\n");
  source = source.slice(0, updateStart) + updateReplacement + source.slice(updateEnd + updateEndMarker.length);
}

const recoveryAnchor = '        if (input.dryRun) {\n          sanitizeAdditionalFields(row.fields);';
if (!source.includes('would_move_mcp_root_element')) {
  if (!source.includes(recoveryAnchor)) throw new Error("importBatch recovery anchor not found");

  const recoveryBlock = [
    '        let misplacedRoot: any | null = null;',
    '        if (section.id) {',
    '          const expectedCode = stableCode("mcp_element", section.id, normalizeListName(row.name));',
    '          const rootLookup = await this.client.call("lists.element.get", {',
    '            ...this.base(ctx),',
    '            ELEMENT_CODE: expectedCode,',
    '            SELECT: ["ID", "CODE", "NAME", "IBLOCK_SECTION_ID"]',
    '          });',
    '          misplacedRoot = resultItems(rootLookup).find((candidate) =>',
    '            sameId(candidate?.IBLOCK_SECTION_ID, 0) &&',
    '            String(candidate?.CODE ?? "") === expectedCode &&',
    '            normalizeListName(String(candidate?.NAME ?? "")) === normalizeListName(row.name)',
    '          ) ?? null;',
    '        }',
    '',
    '        if (misplacedRoot) {',
    '          rowResult.element_id = Number(misplacedRoot.ID);',
    '          if (input.dryRun) {',
    '            rowResult.status = "updated";',
    '            rowResult.action = "would_move_mcp_root_element";',
    '            rowResult.planned = true;',
    '          } else {',
    '            const moved = await this.updateElement(ctx, {',
    '              elementId: Number(misplacedRoot.ID),',
    '              sectionId: section.id,',
    '              name: row.name,',
    '              fields: row.fields',
    '            });',
    '            rowResult.status = moved.status;',
    '            rowResult.action = moved.status === "updated" ? "moved_mcp_root_element" : "existing_duplicate";',
    '            rowResult.element_id = moved.id;',
    '          }',
    '          results.push(rowResult);',
    '          continue;',
    '        }',
    ''
  ].join("\n");

  source = source.replace(recoveryAnchor, recoveryBlock + recoveryAnchor);
}

fs.writeFileSync(servicePath, source, "utf8");
stdout.write("Applied safe recovery for MCP-created list elements misplaced at root\n");
