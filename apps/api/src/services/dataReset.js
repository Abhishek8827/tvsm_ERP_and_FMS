import { AuditLog } from "../models/AuditLog.js";
import { BankAccount } from "../models/BankAccount.js";
import { BonafideCertificate } from "../models/BonafideCertificate.js";
import { CashbookSettings } from "../models/CashbookSettings.js";
import { CashierPin } from "../models/CashierPin.js";
import { CertificateRequest } from "../models/CertificateRequest.js";
import { CertificateSettings } from "../models/CertificateSettings.js";
import { Charge } from "../models/Charge.js";
import { Counter } from "../models/Counter.js";
import { DayClose } from "../models/DayClose.js";
import { ExpenseHead } from "../models/ExpenseHead.js";
import { ExpensePayment } from "../models/ExpensePayment.js";
import { ExpenseReversal } from "../models/ExpenseReversal.js";
import { ExpenseVoucher } from "../models/ExpenseVoucher.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { PettyEntry } from "../models/PettyEntry.js";
import { Rebate } from "../models/Rebate.js";
import { Receipt } from "../models/Receipt.js";
import { ReceiptCancellation } from "../models/ReceiptCancellation.js";
import { ReportSettings } from "../models/ReportSettings.js";
import { Student } from "../models/Student.js";
import { TransferCertificate } from "../models/TransferCertificate.js";
import { User } from "../models/User.js";
import { WhatsappMessage } from "../models/WhatsappMessage.js";

/**
 * "Make the application new": removes test data before the school starts using it for real.
 * Owner's decisions (2026-10-29): KEEP users and the fee structure / settings; everything else is
 * test data; all numbers restart at 0001; opening balances go back to zero.
 *
 * EVERY model must appear below (a test fails if a new model file is not classified), so a model
 * added later can never be silently left out of, or wrongly swept into, a cleanup.
 *
 *   keep  - left exactly as it is
 *   wipe  - every row of this school is deleted
 *   reset - the row stays, but the listed fields go back to their empty state
 */
export const PLAN = [
  // --- kept
  { name: "User", model: User, action: "keep", why: "logins stay" },
  {
    name: "FeeStructure",
    model: FeeStructure,
    action: "keep",
    why: "fee chart is setup, not test data",
  },
  { name: "ExpenseHead", model: ExpenseHead, action: "keep", why: "setup" },
  {
    name: "CertificateSettings",
    model: CertificateSettings,
    action: "keep",
    why: "TC book no. and start Sl. No.",
  },
  // --- reset to empty
  {
    name: "CashbookSettings",
    model: CashbookSettings,
    action: "reset",
    set: { transportOpeningPaise: 0, history: [] },
    why: "transport opening balance back to zero (heads and start date stay)",
  },
  {
    name: "ReportSettings",
    model: ReportSettings,
    action: "reset",
    set: { fixedAssetsPaise: 0, capitalPaise: 0, history: [] },
    why: "fixed assets and capital back to zero",
  },
  {
    name: "CashierPin",
    model: CashierPin,
    action: "reset",
    set: { failed: 0, locked: false },
    why: "PIN stays, wrong-try lock is cleared",
  },
  // --- wiped
  {
    name: "Student",
    model: Student,
    action: "wipe",
    why: "students are re-imported from the real Excel",
  },
  { name: "Charge", model: Charge, action: "wipe" },
  { name: "Receipt", model: Receipt, action: "wipe" },
  { name: "ReceiptCancellation", model: ReceiptCancellation, action: "wipe" },
  { name: "Rebate", model: Rebate, action: "wipe" },
  { name: "DayClose", model: DayClose, action: "wipe" },
  { name: "ExpenseVoucher", model: ExpenseVoucher, action: "wipe" },
  { name: "ExpensePayment", model: ExpensePayment, action: "wipe" },
  { name: "ExpenseReversal", model: ExpenseReversal, action: "wipe" },
  { name: "PettyEntry", model: PettyEntry, action: "wipe" },
  {
    name: "LedgerEntry",
    model: LedgerEntry,
    action: "wipe",
    why: "includes the DEMO opening balances (cash, banks, petty)",
  },
  { name: "TransferCertificate", model: TransferCertificate, action: "wipe" },
  { name: "BonafideCertificate", model: BonafideCertificate, action: "wipe" },
  { name: "CertificateRequest", model: CertificateRequest, action: "wipe" },
  { name: "WhatsappMessage", model: WhatsappMessage, action: "wipe" },
  {
    name: "Counter",
    model: Counter,
    action: "wipe",
    why: "receipt / voucher / petty / Bonafide numbers restart at 0001",
  },
  {
    name: "AuditLog",
    model: AuditLog,
    action: "wipe",
    why: "test history; ONE entry recording this cleanup is written afterwards",
  },
  {
    name: "BankAccount",
    model: BankAccount,
    action: "wipe",
    filter: { name: { $regex: "\\(DEMO\\)", $options: "i" } },
    why: 'only banks whose name contains "(DEMO)"; real bank accounts stay',
  },
];

export const CONFIRM_PHRASE = "DELETE ALL TEST DATA";

/** Reads the command line: --wipe, --db=NAME, --phrase="..." . */
export function parseArgs(argv) {
  const out = { wipe: false, db: undefined, phrase: undefined };
  for (const a of argv) {
    if (a === "--wipe") out.wipe = true;
    else if (a.startsWith("--db=")) out.db = a.slice(5);
    else if (a.startsWith("--phrase=")) out.phrase = a.slice(9);
  }
  return out;
}

/**
 * Returns a plain-language reason why a REAL wipe must not run, or null when every guard passed.
 * Four guards: an env switch that is meant to be removed after the cleanup, --wipe itself, the
 * exact database name, and the exact confirmation phrase. A dry run needs none of them.
 */
export function wipeBlockedReason({ args, env, dbName }) {
  if (env.ALLOW_DATA_RESET !== "yes")
    return "ALLOW_DATA_RESET=yes is not set. Set it only for this cleanup and remove it afterwards.";
  if (args.db !== dbName)
    return `--db must be the exact database name in use (${dbName}). You typed: ${args.db ?? "nothing"}.`;
  if (args.phrase !== CONFIRM_PHRASE)
    return `--phrase must be exactly: ${CONFIRM_PHRASE}`;
  return null;
}

const scope = (tenantId, step) => ({ tenantId, ...(step.filter ?? {}) });

/** How many rows each step would touch. Changes nothing. */
export async function countPlan(tenantId, plan = PLAN) {
  const rows = [];
  for (const step of plan) {
    const n = await step.model.collection.countDocuments(scope(tenantId, step));
    rows.push({
      name: step.name,
      action: step.action,
      count: n,
      why: step.why,
    });
  }
  return rows;
}

/**
 * Does the cleanup. Uses the raw collections on purpose: the models refuse delete / update of
 * receipts and audit entries (that protection is the point of the system), and this one-time
 * pre-launch cleanup is the only place allowed to go around it. Then writes ONE audit entry that
 * says what was removed, by whom and why, so the new audit log does not start unexplained.
 */
export async function runWipe(tenantId, { by, plan = PLAN } = {}) {
  const before = await countPlan(tenantId, plan);
  const removed = {};
  const reset = [];
  for (const step of plan) {
    if (step.action === "wipe") {
      const r = await step.model.collection.deleteMany(scope(tenantId, step));
      removed[step.name] = r.deletedCount;
    } else if (step.action === "reset") {
      const r = await step.model.collection.updateMany(
        { tenantId },
        { $set: step.set },
      );
      if (r.matchedCount > 0) reset.push(step.name);
    }
  }
  await AuditLog.create({
    tenantId,
    userId: by ?? "data-reset-script",
    userRole: "system",
    action: "delete",
    entity: "system_data",
    entityId: "pre-launch-cleanup",
    reason:
      "Pre-launch cleanup: all test data removed, numbers restarted, opening balances zeroed",
    newValue: { removed, reset },
    at: new Date(),
  });
  return { before, removed, reset };
}
