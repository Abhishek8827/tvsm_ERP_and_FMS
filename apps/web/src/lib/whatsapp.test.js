import { describe, expect, it } from "vitest";
import { normalizePhone, receiptMessage, tcMessage, waLink } from "./whatsapp";

describe("normalizePhone", () => {
  it.each([
    ["98260 12340", "919826012340"],
    ["+91 98260-12340", "919826012340"],
    ["09826012340", "919826012340"],
    ["12345 / 98250 11111", "919825011111"],
  ])("%s", (i, o) => expect(normalizePhone(i)).toBe(o));
  it.each(["", null, "0731-2345678", "12345", "5826012340"])(
    "rejects %s",
    (i) => expect(normalizePhone(i)).toBeNull(),
  );
});
describe("waLink", () => {
  it("builds an encoded wa.me link", () => {
    expect(waLink("98260 12340", "a b&c")).toBe(
      "https://wa.me/919826012340?text=a%20b%26c",
    );
  });
  it("is null without a valid number", () =>
    expect(waLink("abc", "x")).toBeNull());
});
describe("messages", () => {
  it("receipt", () =>
    expect(
      receiptMessage(
        {
          number: "R-1",
          totalPaise: 150000,
          student: { name: "Asha", admissionNo: "12" },
        },
        "3 Nov 2026",
      ),
    ).toContain("R-1"));
  it("tc", () =>
    expect(
      tcMessage({
        slNo: 7,
        snapshot: { name: "Asha" },
        entered: { dateOfIssue: "2026-11-03" },
      }),
    ).toContain("No. 7 for Asha"));
});
