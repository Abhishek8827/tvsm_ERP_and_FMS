import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONFIRM_PHRASE,
  PLAN,
  parseArgs,
  wipeBlockedReason,
} from "./dataReset.js";

const names = (action) =>
  PLAN.filter((p) => p.action === action).map((p) => p.name);

describe("data cleaner plan", () => {
  it("classifies EVERY model file: a new model cannot be silently left out of a cleanup", () => {
    const files = readdirSync(new URL("../models/", import.meta.url))
      .filter(
        (f) =>
          f.endsWith(".js") && !f.endsWith(".test.js") && f !== "immutable.js",
      )
      .map((f) => f.replace(".js", ""))
      .sort();
    expect(PLAN.map((p) => p.name).sort()).toEqual(files);
  });
  it("keeps users, fee structure, expense heads and certificate settings, as the owner decided", () => {
    expect(names("keep").sort()).toEqual(
      ["CertificateSettings", "ExpenseHead", "FeeStructure", "User"].sort(),
    );
  });
  it("wipes all money, student, certificate, counter and audit data", () => {
    for (const n of [
      'Receipt', 'ReceiptCancellation', 'LedgerEntry', 'ExpenseVoucher', 'ExpensePayment',
      'PettyEntry', 'Student', 'Charge', 'TransferCertificate', 'BonafideCertificate',
      'Counter', 'AuditLog', 'DayClose', 'WhatsappMessage',
    ]) expect(names('wipe'), n).toContain(n); // prettier-ignore
  });
  it("removes only DEMO banks, and zeroes the opening figures kept in settings", () => {
    const bank = PLAN.find((p) => p.name === "BankAccount");
    expect(bank.filter.name.$regex).toBe("\\(DEMO\\)");
    expect(new RegExp(bank.filter.name.$regex, "i").test("IDFC (DEMO)")).toBe(
      true,
    );
    expect(new RegExp(bank.filter.name.$regex, "i").test("IDFC Bank")).toBe(
      false,
    );
    expect(PLAN.find((p) => p.name === "ReportSettings").set).toMatchObject({
      fixedAssetsPaise: 0,
      capitalPaise: 0,
    });
    expect(
      PLAN.find((p) => p.name === "CashbookSettings").set.transportOpeningPaise,
    ).toBe(0);
  });
});

describe("data cleaner guards", () => {
  const ok = {
    args: { wipe: true, db: "erp", phrase: CONFIRM_PHRASE },
    env: { ALLOW_DATA_RESET: "yes" },
    dbName: "erp",
  };
  it("parses the command line", () => {
    expect(
      parseArgs(["--wipe", "--db=erp", `--phrase=${CONFIRM_PHRASE}`]),
    ).toEqual({
      wipe: true,
      db: "erp",
      phrase: CONFIRM_PHRASE,
    });
    expect(parseArgs([])).toEqual({
      wipe: false,
      db: undefined,
      phrase: undefined,
    });
  });
  it("lets a wipe through only when all guards are right", () => {
    expect(wipeBlockedReason(ok)).toBeNull();
  });
  it("blocks when the env switch, the database name or the phrase is missing or wrong", () => {
    expect(wipeBlockedReason({ ...ok, env: {} })).toMatch(/ALLOW_DATA_RESET/);
    expect(
      wipeBlockedReason({ ...ok, env: { ALLOW_DATA_RESET: "true" } }),
    ).toMatch(/ALLOW_DATA_RESET/);
    expect(
      wipeBlockedReason({ ...ok, args: { ...ok.args, db: "other" } }),
    ).toMatch(/--db/);
    expect(
      wipeBlockedReason({ ...ok, args: { ...ok.args, db: undefined } }),
    ).toMatch(/--db/);
    expect(
      wipeBlockedReason({
        ...ok,
        args: { ...ok.args, phrase: "delete all test data" },
      }),
    ).toMatch(/--phrase/);
  });
});
