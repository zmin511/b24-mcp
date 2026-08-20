import { describe, expect, it } from "vitest";
import { BitrixListsService, normalizeListName, sanitizeAdditionalFields } from "./service.js";

class FakeClient {
  calls: Array<{ method: string; params: any }> = [];
  sections: any[] = [];
  elements: any[] = [];
  nextSectionId = 3000;
  nextElementId = 4000;
  failName?: string;

  async call(method: string, params: any = {}) {
    this.calls.push({ method, params });
    if (method === "lists.section.get") {
      let rows = this.sections;
      if (params.FILTER?.ID) rows = rows.filter((s) => Number(s.ID) === Number(params.FILTER.ID));
      return { result: rows };
    }
    if (method === "lists.section.add") {
      const id = this.nextSectionId++;
      this.sections.push({ ID: String(id), NAME: params.FIELDS.NAME, SORT: String(params.FIELDS.SORT), IBLOCK_SECTION_ID: params.IBLOCK_SECTION_ID || null });
      return { result: id };
    }
    if (method === "lists.section.update") {
      const row = this.sections.find((s) => Number(s.ID) === Number(params.SECTION_ID));
      if (!row) throw new Error("missing section");
      row.NAME = params.FIELDS.NAME;
      row.SORT = String(params.FIELDS.SORT);
      return { result: true };
    }
    if (method === "lists.section.delete") {
      this.sections = this.sections.filter((s) => Number(s.ID) !== Number(params.SECTION_ID));
      return { result: true };
    }
    if (method === "lists.element.get") {
      let rows = this.elements;
      if (params.ELEMENT_ID) rows = rows.filter((e) => Number(e.ID) === Number(params.ELEMENT_ID));
      if (params.FILTER?.SECTION_ID) rows = rows.filter((e) => Number(e.IBLOCK_SECTION_ID) === Number(params.FILTER.SECTION_ID));
      return { result: rows };
    }
    if (method === "lists.element.add") {
      if (params.FIELDS.NAME === this.failName) throw new Error("simulated failure");
      const id = this.nextElementId++;
      this.elements.push({ ID: String(id), NAME: params.FIELDS.NAME, IBLOCK_SECTION_ID: params.IBLOCK_SECTION_ID, ...params.FIELDS });
      return { result: id };
    }
    if (method === "lists.element.update") {
      const row = this.elements.find((e) => Number(e.ID) === Number(params.ELEMENT_ID));
      if (!row) throw new Error("missing element");
      Object.assign(row, params.FIELDS);
      return { result: true };
    }
    if (method === "lists.element.delete") {
      this.elements = this.elements.filter((e) => Number(e.ID) !== Number(params.ELEMENT_ID));
      return { result: true };
    }
    throw new Error(`Unexpected method ${method}`);
  }
}

const ctx = { iblockTypeId: "bitrix_processes", iblockId: 329 };

describe("BitrixListsService", () => {
  it("normalizes Unicode, whitespace, and case", () => {
    expect(normalizeListName("  ТЕРМОМЕТР   Ａ  ")).toBe("термометр a");
  });

  it("blocks system field overrides", () => {
    expect(() => sanitizeAdditionalFields({ NAME: "bad" })).toThrow(/controlled/);
  });

  it("uses documented NAME wildcard filters", async () => {
    const client = new FakeClient();
    const service = new BitrixListsService(client);
    await service.findSectionByName(ctx, 2381, "Термометры");
    await service.findElementByName(ctx, 2381, "Термометр AND dt-623");
    const sectionCall = client.calls.find((c) => c.method === "lists.section.get");
    const elementCall = client.calls.find((c) => c.method === "lists.element.get");
    expect(sectionCall?.params.FILTER).toEqual({ NAME: "%Термометры%" });
    expect(elementCall?.params.FILTER).toEqual({ NAME: "%Термометр AND dt-623%", SECTION_ID: 2381 });
  });

  it("skips an existing element by normalized SECTION_ID + NAME", async () => {
    const client = new FakeClient();
    client.elements.push({ ID: "41", NAME: "Термометр AND dt-623", IBLOCK_SECTION_ID: 2381 });
    const service = new BitrixListsService(client);
    const res = await service.addElement(ctx, { sectionId: 2381, name: "  ТЕРМОМЕТР   and DT-623 " });
    expect(res.status).toBe("skipped");
    expect(client.calls.some((c) => c.method === "lists.element.add")).toBe(false);
  });

  it("rejects undocumented section and element moves", async () => {
    const client = new FakeClient();
    client.sections.push({ ID: "3001", NAME: "Термометры", IBLOCK_SECTION_ID: 2381, SORT: "500" });
    client.elements.push({ ID: "4001", NAME: "Термометр", IBLOCK_SECTION_ID: 3001 });
    const service = new BitrixListsService(client);
    await expect(service.updateSection(ctx, { sectionId: 3001, parentSectionId: 9999 })).rejects.toThrow(/not supported/);
    await expect(service.updateElement(ctx, { elementId: 4001, sectionId: 9999 })).rejects.toThrow(/not supported/);
    expect(client.calls.some((c) => c.method === "lists.section.update")).toBe(false);
    expect(client.calls.some((c) => c.method === "lists.element.update")).toBe(false);
  });

  it("dry-run batch performs no mutating REST calls", async () => {
    const client = new FakeClient();
    const service = new BitrixListsService(client);
    const res = await service.importBatch(ctx, {
      dryRun: true,
      items: [{ parentSectionId: 2381, sectionName: "Термометры", name: "Термометр AND dt-623" }]
    });
    expect(res.created).toBe(1);
    expect(client.calls.some((c) => /\.(add|update|delete)$/.test(c.method))).toBe(false);
  });

  it("creates a missing section and element in real batch", async () => {
    const client = new FakeClient();
    const service = new BitrixListsService(client);
    const res = await service.importBatch(ctx, {
      dryRun: false,
      items: [{ parentSectionId: 2381, sectionName: "Термометры", name: "Термометр AND dt-623" }]
    });
    expect(res.created).toBe(1);
    expect(res.sections_created).toBe(1);
    expect(client.sections).toHaveLength(1);
    expect(client.elements).toHaveLength(1);
  });

  it("continues batch after a row failure", async () => {
    const client = new FakeClient();
    client.sections.push({ ID: "3001", NAME: "Термометры", IBLOCK_SECTION_ID: 2381, SORT: "500" });
    client.failName = "Ошибка";
    const service = new BitrixListsService(client);
    const res = await service.importBatch(ctx, {
      dryRun: false,
      items: [
        { parentSectionId: 2381, sectionName: "Термометры", name: "Ошибка" },
        { parentSectionId: 2381, sectionName: "Термометры", name: "Рабочая строка" }
      ]
    });
    expect(res.failed).toBe(1);
    expect(res.created).toBe(1);
  });

  it("is idempotent across repeated batch runs", async () => {
    const client = new FakeClient();
    const service = new BitrixListsService(client);
    const item = { parentSectionId: 2381, sectionName: "Термометры", name: "Термометр AND dt-623" };
    const first = await service.importBatch(ctx, { dryRun: false, items: [item] });
    const second = await service.importBatch(ctx, { dryRun: false, items: [item] });
    expect(first.created).toBe(1);
    expect(second.skipped).toBe(1);
    expect(client.elements).toHaveLength(1);
  });
});
