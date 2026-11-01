import { describe, expect, it } from "vitest";
import {
  ADMISSION_STUDENT_FIELDS,
  FORM_FEE_PAISE,
  admissionDues,
  formNumber,
  isSession,
  paymentStatus,
  planAdmissionReceipt,
} from "./admissions.js";
import { receiptNumber } from "./collect.js";

const rec = (...lines) => ({
  lines: lines.map(([head, amountPaise]) => ({ head, amountPaise })),
});

describe("admission numbers", () => {
  it("form number is NEW/<session>/<3 digits>, and keeps growing past 999", () => {
    expect(formNumber("2026-27", 1)).toBe("NEW/2026-27/001");
    expect(formNumber("2026-27", 42)).toBe("NEW/2026-27/042");
    expect(formNumber("2026-27", 1234)).toBe("NEW/2026-27/1234");
  });
  it("a session must look like 2026-27", () => {
    expect(isSession("2026-27")).toBe(true);
    expect(isSession("2026-28")).toBe(false);
    expect(isSession("26-27")).toBe(false);
  });
  it("admission receipts have their own series", () => {
    expect(receiptNumber("admission", "2026-27", 7)).toBe("A-FY2026-27/0007");
    expect(receiptNumber("school", "2026-27", 7)).toBe("S-FY2026-27/0007");
  });
  it("the form fee is Rs 100", () => expect(FORM_FEE_PAISE).toBe(10000));
  it("carries only existing student fields, never fee or status fields", () => {
    expect(ADMISSION_STUDENT_FIELDS).toContain("name");
    expect(ADMISSION_STUDENT_FIELDS).not.toContain("isNewAdmission");
    expect(ADMISSION_STUDENT_FIELDS).not.toContain("admissionNo");
  });
});

describe("admission dues", () => {
  const base = { formFeePaise: 10000, admissionFeePaise: 500000 };
  it("unpaid -> partial -> paid per head, with the outstanding total", () => {
    const none = admissionDues(base);
    expect(none.form.status).toBe("unpaid");
    expect(none.outstandingPaise).toBe(510000);
    const some = admissionDues({
      ...base,
      receipts: [rec(["form", 10000], ["admission", 100000])],
    });
    expect(some.form.status).toBe("paid");
    expect(some.admission.status).toBe("partial");
    expect(some.collectedPaise).toBe(110000);
    expect(some.outstandingPaise).toBe(400000);
  });
  it("paymentStatus edge cases", () => {
    expect(paymentStatus(100, 0)).toBe("unpaid");
    expect(paymentStatus(100, 100)).toBe("paid");
    expect(paymentStatus(0, 0)).toBe("unpaid");
  });
});

describe("planAdmissionReceipt", () => {
  const dues = admissionDues({
    formFeePaise: 10000,
    admissionFeePaise: 500000,
  });
  it("builds lines, total and what is left", () => {
    const p = planAdmissionReceipt({
      dues,
      input: { formPaise: 10000, admissionPaise: 200000 },
    });
    expect(p.lines).toEqual([
      { head: "form", amountPaise: 10000 },
      { head: "admission", amountPaise: 200000 },
    ]);
    expect(p.totalPaise).toBe(210000);
    expect(p.dueAfterPaise).toBe(300000);
  });
  it("refuses more than pending, a zero payment and a bad amount", () => {
    expect(() =>
      planAdmissionReceipt({ dues, input: { formPaise: 20000 } }),
    ).toThrow(/more than/);
    expect(() => planAdmissionReceipt({ dues, input: {} })).toThrow(
      /Enter an amount/,
    );
    expect(() =>
      planAdmissionReceipt({ dues, input: { admissionPaise: -5 } }),
    ).toThrow(/valid/);
  });
});
