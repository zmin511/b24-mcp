import { createHash } from "node:crypto";

export type ListsRestClient = {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<any>;
};

export type ListContext = {
  iblockTypeId: string;
  iblockId: number;
};

export type BatchItem = {
  parentSectionId: number;
  sectionName: string;
  name: string;
  sectionSort?: number;
  fields?: Record<string, unknown>;
  updateExisting?: boolean;
};

const SYSTEM_FIELD_KEYS = new Set([
  "ID",
  "CODE",
  "NAME",
  "IBLOCK_ID",
  "IBLOCK_CODE",
  "IBLOCK_TYPE_ID",
  "IBLOCK_SECTION_ID",
  "SECTION_ID",
  "SECTION_CODE",
  "ELEMENT_ID",
  "ELEMENT_CODE",
  "CREATED_BY",
  "MODIFIED_BY",
  "DATE_CREATE",
  "TIMESTAMP_X"
]);

export function normalizeListName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function sanitizeAdditionalFields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const upper = key.toUpperCase();
    if (SYSTEM_FIELD_KEYS.has(upper)) {
      throw new Error(`Field '${key}' is controlled by the typed list tool and cannot be overridden`);
    }
    out[key] = value;
  }
  return out;
}

function resultItems(res: any): any[] {
  const raw = res?.result ?? [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function resultId(res: any): number {
  const raw = res?.result?.ID ?? res?.result?.id ?? res?.result;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Bitrix write method did not return a valid object ID: ${JSON.stringify(raw)}`);
  }
  return id;
}

function parentId(value: unknown): number {
  const id = Number(value ?? 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function stableCode(prefix: string, ...parts: Array<string | number>): string {
  const hash = createHash("sha256").update(parts.join("\u001f"), "utf8").digest("hex").slice(0, 24);
  return `${prefix}_${hash}`;
}

function sameId(a: unknown, b: unknown): boolean {
  return parentId(a) === parentId(b);
}

export class BitrixListsService {
  constructor(private readonly client: ListsRestClient) {}

  private base(ctx: ListContext) {
    return {
      IBLOCK_TYPE_ID: ctx.iblockTypeId,
      IBLOCK_ID: ctx.iblockId
    };
  }

  async getSection(ctx: ListContext, sectionId: number): Promise<any | null> {
    const res = await this.client.call("lists.section.get", {
      ...this.base(ctx),
      FILTER: { ID: sectionId },
      SELECT: ["ID", "CODE", "IBLOCK_SECTION_ID", "SORT", "NAME", "ACTIVE"]
    });
    return resultItems(res)[0] ?? null;
  }

  async findSectionByName(ctx: ListContext, parentSectionId: number, name: string): Promise<any | null> {
    const res = await this.client.call("lists.section.get", {
      ...this.base(ctx),
      FILTER: { "%NAME": name },
      SELECT: ["ID", "CODE", "IBLOCK_SECTION_ID", "SORT", "NAME", "ACTIVE"]
    });
    const wanted = normalizeListName(name);
    return resultItems(res).find((row) =>
      sameId(row?.IBLOCK_SECTION_ID, parentSectionId) && normalizeListName(String(row?.NAME ?? "")) === wanted
    ) ?? null;
  }

  async addSection(ctx: ListContext, input: { parentSectionId: number; name: string; sort: number }) {
    const existing = await this.findSectionByName(ctx, input.parentSectionId, input.name);
    if (existing) {
      return { status: "skipped" as const, reason: "duplicate", id: Number(existing.ID), object: existing };
    }

    const write = await this.client.call("lists.section.add", {
      ...this.base(ctx),
      IBLOCK_SECTION_ID: input.parentSectionId,
      SECTION_CODE: stableCode("mcp_section", input.parentSectionId, normalizeListName(input.name)),
      FIELDS: { NAME: input.name, SORT: input.sort }
    });
    const id = resultId(write);
    const object = await this.getSection(ctx, id);
    if (!object || Number(object.ID) !== id) throw new Error(`Read-after-write failed for section ${id}`);
    return { status: "created" as const, id, object };
  }

  async updateSection(ctx: ListContext, input: { sectionId: number; parentSectionId?: number; name?: string; sort?: number }) {
    const current = await this.getSection(ctx, input.sectionId);
    if (!current) throw new Error(`Section ${input.sectionId} was not found`);

    const nextName = input.name ?? String(current.NAME ?? "");
    const nextParent = input.parentSectionId ?? parentId(current.IBLOCK_SECTION_ID);
    if (input.name !== undefined || input.parentSectionId !== undefined) {
      const duplicate = await this.findSectionByName(ctx, nextParent, nextName);
      if (duplicate && Number(duplicate.ID) !== input.sectionId) {
        return { status: "skipped" as const, reason: "duplicate", id: Number(duplicate.ID), object: duplicate };
      }
    }

    const payload: Record<string, unknown> = {
      ...this.base(ctx),
      SECTION_ID: input.sectionId,
      FIELDS: {
        NAME: nextName,
        SORT: input.sort ?? Number(current.SORT ?? 500)
      }
    };
    if (input.parentSectionId !== undefined) payload.IBLOCK_SECTION_ID = input.parentSectionId;

    await this.client.call("lists.section.update", payload);
    const object = await this.getSection(ctx, input.sectionId);
    if (!object || Number(object.ID) !== input.sectionId) throw new Error(`Read-after-write failed for section ${input.sectionId}`);
    return { status: "updated" as const, id: input.sectionId, object };
  }

  async deleteSection(ctx: ListContext, sectionId: number) {
    const before = await this.getSection(ctx, sectionId);
    if (!before) return { status: "skipped" as const, reason: "not_found", id: sectionId };
    const res = await this.client.call("lists.section.delete", { ...this.base(ctx), SECTION_ID: sectionId });
    const after = await this.getSection(ctx, sectionId);
    if (after) throw new Error(`Delete verification failed for section ${sectionId}`);
    return { status: "deleted" as const, id: sectionId, res };
  }

  async getElement(ctx: ListContext, elementId: number): Promise<any | null> {
    const res = await this.client.call("lists.element.get", {
      ...this.base(ctx),
      ELEMENT_ID: elementId
    });
    return resultItems(res)[0] ?? null;
  }

  async findElementByName(ctx: ListContext, sectionId: number, name: string): Promise<any | null> {
    const res = await this.client.call("lists.element.get", {
      ...this.base(ctx),
      FILTER: { "%NAME": name, IBLOCK_SECTION_ID: sectionId },
      SELECT: ["ID", "CODE", "NAME", "IBLOCK_SECTION_ID"]
    });
    const wanted = normalizeListName(name);
    return resultItems(res).find((row) =>
      sameId(row?.IBLOCK_SECTION_ID, sectionId) && normalizeListName(String(row?.NAME ?? "")) === wanted
    ) ?? null;
  }

  async addElement(ctx: ListContext, input: { sectionId: number; name: string; fields?: Record<string, unknown> }) {
    const existing = await this.findElementByName(ctx, input.sectionId, input.name);
    if (existing) {
      return { status: "skipped" as const, reason: "duplicate", id: Number(existing.ID), object: existing };
    }

    const fields = sanitizeAdditionalFields(input.fields);
    const write = await this.client.call("lists.element.add", {
      ...this.base(ctx),
      IBLOCK_SECTION_ID: input.sectionId,
      ELEMENT_CODE: stableCode("mcp_element", input.sectionId, normalizeListName(input.name)),
      FIELDS: { NAME: input.name, ...fields }
    });
    const id = resultId(write);
    const object = await this.getElement(ctx, id);
    if (!object || Number(object.ID) !== id) throw new Error(`Read-after-write failed for element ${id}`);
    return { status: "created" as const, id, object };
  }

  async updateElement(ctx: ListContext, input: { elementId: number; sectionId?: number; name?: string; fields?: Record<string, unknown> }) {
    const current = await this.getElement(ctx, input.elementId);
    if (!current) throw new Error(`Element ${input.elementId} was not found`);

    const nextSection = input.sectionId ?? parentId(current.IBLOCK_SECTION_ID);
    const nextName = input.name ?? String(current.NAME ?? "");
    if (input.name !== undefined || input.sectionId !== undefined) {
      const duplicate = await this.findElementByName(ctx, nextSection, nextName);
      if (duplicate && Number(duplicate.ID) !== input.elementId) {
        return { status: "skipped" as const, reason: "duplicate", id: Number(duplicate.ID), object: duplicate };
      }
    }

    const preserved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(current)) {
      if (key.startsWith("PROPERTY_")) preserved[key] = value;
    }
    const updates = sanitizeAdditionalFields(input.fields);
    const payload: Record<string, unknown> = {
      ...this.base(ctx),
      ELEMENT_ID: input.elementId,
      FIELDS: { NAME: nextName, ...preserved, ...updates }
    };
    if (input.sectionId !== undefined) payload.IBLOCK_SECTION_ID = input.sectionId;

    await this.client.call("lists.element.update", payload);
    const object = await this.getElement(ctx, input.elementId);
    if (!object || Number(object.ID) !== input.elementId) throw new Error(`Read-after-write failed for element ${input.elementId}`);
    return { status: "updated" as const, id: input.elementId, object };
  }

  async deleteElement(ctx: ListContext, elementId: number) {
    const before = await this.getElement(ctx, elementId);
    if (!before) return { status: "skipped" as const, reason: "not_found", id: elementId };
    const res = await this.client.call("lists.element.delete", { ...this.base(ctx), ELEMENT_ID: elementId });
    const after = await this.getElement(ctx, elementId);
    if (after) throw new Error(`Delete verification failed for element ${elementId}`);
    return { status: "deleted" as const, id: elementId, res };
  }

  async importBatch(ctx: ListContext, input: { dryRun: boolean; items: BatchItem[] }) {
    const results: any[] = [];
    const sectionCache = new Map<string, any>();
    const batchElementKeys = new Set<string>();
    let sectionsCreated = 0;
    let sectionsExisting = 0;

    for (let index = 0; index < input.items.length; index++) {
      const row = input.items[index];
      const rowResult: any = {
        index,
        name: row?.name,
        section_name: row?.sectionName,
        resolved_section_id: null
      };

      try {
        if (!row || !row.name?.trim() || !row.sectionName?.trim()) throw new Error("section_name and name are required");
        const sectionKey = `${row.parentSectionId}|${normalizeListName(row.sectionName)}`;
        let section = sectionCache.get(sectionKey);

        if (!section) {
          const existingSection = await this.findSectionByName(ctx, row.parentSectionId, row.sectionName);
          if (existingSection) {
            section = { id: Number(existingSection.ID), planned: false, object: existingSection };
            sectionsExisting++;
          } else if (input.dryRun) {
            section = { id: null, planned: true, object: null };
            sectionsCreated++;
          } else {
            const created = await this.addSection(ctx, {
              parentSectionId: row.parentSectionId,
              name: row.sectionName,
              sort: row.sectionSort ?? 500
            });
            section = { id: created.id, planned: false, object: created.object };
            if (created.status === "created") sectionsCreated++; else sectionsExisting++;
          }
          sectionCache.set(sectionKey, section);
        }

        rowResult.resolved_section_id = section.id;
        const itemKey = `${sectionKey}|${normalizeListName(row.name)}`;
        if (batchElementKeys.has(itemKey)) {
          rowResult.status = "skipped";
          rowResult.action = "duplicate_in_batch";
          rowResult.reason = "Duplicate SECTION_ID + NAME within this batch";
          results.push(rowResult);
          continue;
        }
        batchElementKeys.add(itemKey);

        let existing: any | null = null;
        if (section.id) existing = await this.findElementByName(ctx, section.id, row.name);

        if (existing) {
          rowResult.element_id = Number(existing.ID);
          if (!row.updateExisting) {
            rowResult.status = "skipped";
            rowResult.action = "existing";
            rowResult.reason = "Element already exists in the target section";
          } else if (input.dryRun) {
            rowResult.status = "updated";
            rowResult.action = "would_update";
            rowResult.planned = true;
          } else {
            const updated = await this.updateElement(ctx, {
              elementId: Number(existing.ID),
              sectionId: section.id,
              name: row.name,
              fields: row.fields
            });
            rowResult.status = updated.status;
            rowResult.action = updated.status === "updated" ? "updated" : "existing_duplicate";
            rowResult.element_id = updated.id;
          }
          results.push(rowResult);
          continue;
        }

        if (input.dryRun) {
          sanitizeAdditionalFields(row.fields);
          rowResult.status = "created";
          rowResult.action = section.planned ? "would_create_section_and_element" : "would_create_element";
          rowResult.planned = true;
          results.push(rowResult);
          continue;
        }

        if (!section.id) throw new Error("Target section ID was not resolved");
        const created = await this.addElement(ctx, { sectionId: section.id, name: row.name, fields: row.fields });
        rowResult.status = created.status;
        rowResult.action = created.status === "created" ? "created" : "existing";
        rowResult.element_id = created.id;
        results.push(rowResult);
      } catch (err: any) {
        rowResult.status = "failed";
        rowResult.action = "failed";
        rowResult.error = {
          code: err?.code,
          message: err?.message ?? String(err)
        };
        results.push(rowResult);
      }
    }

    const count = (status: string) => results.filter((row) => row.status === status).length;
    return {
      dry_run: input.dryRun,
      total: results.length,
      created: count("created"),
      updated: count("updated"),
      skipped: count("skipped"),
      failed: count("failed"),
      sections_created: sectionsCreated,
      sections_existing: sectionsExisting,
      results
    };
  }
}
