import { describe, expect, it, vi } from "vitest";
import { ensureIndexes } from "./db.js";

const conflict = Object.assign(
  new Error(
    'An existing index has the same name as the requested index. Requested index: { v: 2, unique: true, key: { tenantId: 1 }, name: "tenantId_1" }, existing index: { v: 2, key: { tenantId: 1 }, name: "tenantId_1" }',
  ),
  { code: 86 },
);

describe("ensureIndexes", () => {
  it("drops the old same-name index named in the error, then builds the right one", async () => {
    const model = {
      init: vi.fn().mockRejectedValue(conflict),
      createIndexes: vi.fn().mockResolvedValue(),
      collection: { dropIndex: vi.fn().mockResolvedValue() },
    };
    await ensureIndexes(model);
    expect(model.collection.dropIndex).toHaveBeenCalledWith("tenantId_1");
    expect(model.createIndexes).toHaveBeenCalledOnce();
  });
  it("does nothing extra when indexes are fine", async () => {
    const model = {
      init: vi.fn().mockResolvedValue(),
      collection: { dropIndex: vi.fn() },
    };
    await ensureIndexes(model);
    expect(model.collection.dropIndex).not.toHaveBeenCalled();
  });
  it("other errors still stop the server start", async () => {
    const model = {
      init: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("boom"), { code: 1 })),
    };
    await expect(ensureIndexes(model)).rejects.toThrow("boom");
  });
});
