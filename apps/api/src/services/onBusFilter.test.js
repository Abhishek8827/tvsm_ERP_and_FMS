import { describe, expect, it } from "vitest";
import { onBusFilter } from "./stores.js";

describe("Fees Database transport filter", () => {
  it('"on the bus" means flagged AND entered in the Transport module (has a start month)', () => {
    expect(onBusFilter(true)).toEqual({
      usesTransport: true,
      transportFrom: { $exists: true, $ne: null },
    });
  });
  it('"not on the bus" is the exact opposite, so the two lists never overlap or miss anyone', () => {
    expect(onBusFilter(false)).toEqual({ $nor: [onBusFilter(true)] });
  });
});
