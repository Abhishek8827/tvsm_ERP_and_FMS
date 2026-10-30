import { describe, expect, it } from "vitest";
import {
  maskPhone,
  normalizePhone,
  receiptParams,
  tcParams,
  templatePayload,
} from "./whatsapp.js";

describe("normalizePhone", () => {
  it.each([
    ["9826012340", "919826012340"],
    ["98260 12340", "919826012340"],
    ["+91 98260-12340", "919826012340"],
    ["09826012340", "919826012340"],
    ["919826012340", "919826012340"],
    ["98260 12340 / 98250 11111", "919826012340"],
    ["12345 / 98250 11111", "919825011111"],
  ])("%s -> %s", (input, out) => expect(normalizePhone(input)).toBe(out));
  it.each([
    [""],
    [null],
    [undefined],
    ["12345"],
    ["1234567890"],
    ["0731-2345678"],
    ["abc"],
  ])("rejects %s", (input) => expect(normalizePhone(input)).toBeNull());
});

describe("maskPhone", () => {
  it("hides the middle of the number", () => {
    expect(maskPhone("919826012340")).toBe("+91 98XXX XXX40");
    expect(maskPhone(null)).toBeNull();
  });
});

const receipt = {
  number: "R-2026-27/0042",
  issuedAt: new Date("2026-10-13T06:00:00Z"),
  totalPaise: 150000,
  mode: "upi",
  dueAfterPaise: 0,
  student: { name: "Aarav  Sharma\n", classKey: "5", section: "A" },
};

describe("receiptParams", () => {
  it("gives the 7 values in template order, clean and in IST", () => {
    const p = receiptParams(receipt);
    expect(p).toHaveLength(7);
    expect(p[0]).toBe("Aarav Sharma");
    expect(p[2]).toBe("R-2026-27/0042");
    expect(p[3]).toBe("13 Oct 2026");
    expect(p[4]).toBe("Rs 1,500");
    expect(p[5]).toBe("UPI / QR");
    expect(p[6]).toBe("Rs 0");
    expect(p.every((v) => v.length > 0 && !/[\n\t]/.test(v))).toBe(true);
  });
  it("uses the IST date near midnight", () => {
    const p = receiptParams({
      ...receipt,
      issuedAt: new Date("2026-10-13T19:00:00Z"),
    });
    expect(p[3]).toBe("14 Oct 2026");
  });
  it("never sends an empty value", () => {
    const p = receiptParams({ ...receipt, student: {} });
    expect(p[0]).toBe("-");
    expect(p[1]).toBe("-");
  });
});

describe("tcParams / templatePayload", () => {
  it("builds the TC values and the Graph API body", () => {
    const p = tcParams({
      slNo: 17,
      snapshot: { name: "Aarav Sharma" },
      entered: { dateOfIssue: "2026-10-13" },
    });
    expect(p).toEqual(["Aarav Sharma", "17", "13 Oct 2026"]);
    expect(
      templatePayload({
        to: "919826012340",
        template: "tc_issued",
        lang: "en",
        params: p,
      }),
    ).toEqual({
      messaging_product: "whatsapp",
      to: "919826012340",
      type: "template",
      template: {
        name: "tc_issued",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: p.map((text) => ({ type: "text", text })),
          },
        ],
      },
    });
  });
});
