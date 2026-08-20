import fs from "node:fs";
import { stdout } from "node:process";
import { URL } from "node:url";

const servicePath = new URL("../src/modules/lists/service.ts", import.meta.url);
let source = fs.readFileSync(servicePath, "utf8");

const oldFields = '      FIELDS: { NAME: input.name, ...fields }';
const newFields = '      FIELDS: { NAME: input.name, IBLOCK_SECTION_ID: input.sectionId, ...fields }';

if (source.includes(oldFields)) {
  source = source.replace(oldFields, newFields);
} else if (!source.includes(newFields)) {
  throw new Error("Element add FIELDS anchor not found in src/modules/lists/service.ts");
}

const oldVerify = '    const object = await this.getElement(ctx, id);\n    if (!object || Number(object.ID) !== id) throw new Error(`Read-after-write failed for element ${id}`);\n    return { status: "created" as const, id, object };';
const newVerify = `    const object = await this.getElement(ctx, id);\n    if (!object || Number(object.ID) !== id) throw new Error(\`Read-after-write failed for element \${id}\`);\n    if (!sameId(object.IBLOCK_SECTION_ID, input.sectionId)) {\n      await this.client.call("lists.element.delete", { ...this.base(ctx), ELEMENT_ID: id });\n      const afterRollback = await this.getElement(ctx, id);\n      if (afterRollback) {\n        throw new Error(\`Element \${id} was created in section \${String(object.IBLOCK_SECTION_ID ?? "root")} instead of \${input.sectionId}; automatic rollback failed\`);\n      }\n      throw new Error(\`Element \${id} was created in section \${String(object.IBLOCK_SECTION_ID ?? "root")} instead of \${input.sectionId}; wrong element was rolled back\`);\n    }\n    return { status: "created" as const, id, object };`;

if (source.includes(oldVerify)) {
  source = source.replace(oldVerify, newVerify);
} else if (!source.includes("wrong element was rolled back")) {
  throw new Error("Read-after-write anchor not found in src/modules/lists/service.ts");
}

fs.writeFileSync(servicePath, source, "utf8");
stdout.write("Applied list element section placement compatibility fix\n");
