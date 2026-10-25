import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

/**
 * Every model: tenantId may exist on the top-level document only. A required tenantId on a
 * sub-document makes every save of that document fail on a real database.
 */
const dir = path.dirname(fileURLToPath(import.meta.url));
describe("tenantId is only on top-level documents", () => {
  it("no sub-document schema in any model has its own tenantId", async () => {
    for (const f of fs.readdirSync(dir))
      if (f.endsWith(".js") && !f.includes(".test.")) await import(`./${f}`);
    const bad = [];
    for (const [name, model] of Object.entries(mongoose.models)) {
      expect(
        model.schema.path("tenantId"),
        `${name} needs tenantId`,
      ).toBeTruthy();
      for (const child of model.schema.childSchemas)
        if (child.schema.path("tenantId"))
          bad.push(`${name}.${child.model?.path ?? "?"}`);
    }
    expect(bad).toEqual([]);
  });
});
