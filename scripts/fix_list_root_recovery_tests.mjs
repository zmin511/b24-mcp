import fs from "node:fs";
import { stdout } from "node:process";
import { URL } from "node:url";

const testPath = new URL("../src/modules/lists/service.test.ts", import.meta.url);
let source = fs.readFileSync(testPath, "utf8");

const elementIdFilter = '      if (params.ELEMENT_ID) rows = rows.filter((e) => Number(e.ID) === Number(params.ELEMENT_ID));';
const elementCodeFilter = '      if (params.ELEMENT_CODE) rows = rows.filter((e) => String(e.CODE ?? "") === String(params.ELEMENT_CODE));';
if (source.includes(elementIdFilter) && !source.includes(elementCodeFilter)) {
  source = source.replace(elementIdFilter, elementIdFilter + "\n" + elementCodeFilter);
}

const oldMoveStart = '  it("rejects undocumented section and element moves", async () => {';
const nextTestMarker = '  it("dry-run batch performs no mutating REST calls", async () => {';
const moveStart = source.indexOf(oldMoveStart);
const nextTest = source.indexOf(nextTestMarker, moveStart);

if (moveStart >= 0 && nextTest > moveStart) {
  const replacement = [
    '  it("rejects section moves but allows verified element section moves", async () => {',
    '    const client = new FakeClient();',
    '    client.sections.push({ ID: "3001", NAME: "Термометры", IBLOCK_SECTION_ID: 2381, SORT: "500" });',
    '    client.elements.push({ ID: "4001", NAME: "Термометр", IBLOCK_SECTION_ID: 3001 });',
    '    const service = new BitrixListsService(client);',
    '    await expect(service.updateSection(ctx, { sectionId: 3001, parentSectionId: 9999 })).rejects.toThrow(/not supported/);',
    '    const moved = await service.updateElement(ctx, { elementId: 4001, sectionId: 9999 });',
    '    expect(moved.status).toBe("updated");',
    '    expect(Number(client.elements[0].IBLOCK_SECTION_ID)).toBe(9999);',
    '    const updateCall = client.calls.find((c) => c.method === "lists.element.update");',
    '    expect(updateCall?.params.FIELDS.IBLOCK_SECTION_ID).toBe(9999);',
    '  });',
    '',
  ].join("\n");
  source = source.slice(0, moveStart) + replacement + source.slice(nextTest);
} else if (!source.includes('allows verified element section moves')) {
  throw new Error("Move test replacement anchors not found");
}

const idempotentMarker = '  it("is idempotent across repeated batch runs", async () => {';
if (!source.includes('would_move_mcp_root_element')) {
  const insertAt = source.indexOf(idempotentMarker);
  if (insertAt < 0) throw new Error("Idempotent test anchor not found");

  const recoveryTests = [
    '  it("dry-run recognizes an MCP-coded root element as a move", async () => {',
    '    const client = new FakeClient();',
    '    client.sections.push({ ID: "3001", NAME: "Термометры", IBLOCK_SECTION_ID: 2381, SORT: "500" });',
    '    client.elements.push({',
    '      ID: "4001",',
    '      NAME: "Термометр AND dt-623",',
    '      IBLOCK_SECTION_ID: null,',
    '      CODE: "mcp_element_2a9deedf53580f01b03a71b4"',
    '    });',
    '    const service = new BitrixListsService(client);',
    '    const res = await service.importBatch(ctx, {',
    '      dryRun: true,',
    '      items: [{ parentSectionId: 2381, sectionName: "Термометры", name: "Термометр AND dt-623" }]',
    '    });',
    '    expect(res.updated).toBe(1);',
    '    expect(res.results[0].action).toBe("would_move_mcp_root_element");',
    '    expect(client.calls.some((c) => c.method === "lists.element.update")).toBe(false);',
    '  });',
    '',
    '  it("moves an MCP-coded root element in a real batch without recreating it", async () => {',
    '    const client = new FakeClient();',
    '    client.sections.push({ ID: "3001", NAME: "Термометры", IBLOCK_SECTION_ID: 2381, SORT: "500" });',
    '    client.elements.push({',
    '      ID: "4001",',
    '      NAME: "Термометр AND dt-623",',
    '      IBLOCK_SECTION_ID: null,',
    '      CODE: "mcp_element_2a9deedf53580f01b03a71b4"',
    '    });',
    '    const service = new BitrixListsService(client);',
    '    const res = await service.importBatch(ctx, {',
    '      dryRun: false,',
    '      items: [{ parentSectionId: 2381, sectionName: "Термометры", name: "Термометр AND dt-623" }]',
    '    });',
    '    expect(res.updated).toBe(1);',
    '    expect(res.results[0].action).toBe("moved_mcp_root_element");',
    '    expect(Number(client.elements[0].IBLOCK_SECTION_ID)).toBe(3001);',
    '    expect(client.elements).toHaveLength(1);',
    '    expect(client.calls.some((c) => c.method === "lists.element.add")).toBe(false);',
    '    expect(client.calls.some((c) => c.method === "lists.element.delete")).toBe(false);',
    '  });',
    '',
  ].join("\n");

  source = source.slice(0, insertAt) + recoveryTests + source.slice(insertAt);
}

fs.writeFileSync(testPath, source, "utf8");
stdout.write("Applied list root recovery regression tests\n");
