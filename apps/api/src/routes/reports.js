import { Router } from "express";
import writeXlsxFile from "write-excel-file/node";
import { z } from "zod";
import {
  addDaysToDateString,
  financialYearRange,
  getFinancialYear,
  istDateString,
  rupeesToPaise,
  todayIst,
} from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import {
  buildBalanceSheet,
  buildDayBook,
  buildIncomeExpenditure,
  buildTrialBalance,
  dayBookAll,
} from "../services/reports.js";
import { AppError } from "../utils/errors.js";

const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const BEGINNING = "2000-01-01";
const DAY_BOOK_MAX_DAYS = 93;
const EXPORT_LIMIT = 20_000;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date");
const rangeQuery = z.object({
  from: date.optional(),
  to: date.optional(),
  compare: z.enum(["none", "previous"]).optional(),
  asOn: date.optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(10).max(200).optional(),
});
const settingsBody = z.object({
  fixedAssetsRupees: z.string().trim().min(1, "Enter the fixed assets amount"),
  capitalRupees: z
    .string()
    .trim()
    .min(1, "Enter the capital / reserve fund amount"),
  reason: z.string().trim().min(3, "Write the reason").max(300),
});

const dayNumber = (d) =>
  Math.round(
    Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000,
  );

/**
 * Reports (cash basis): Income & Expenditure, Balance Sheet, Trial Balance and Day Book. Admin and
 * Principal can read; only the Admin enters the opening balances (fixed assets, capital). Every
 * figure comes from receipts, expense payments, petty cash and the money ledger; nothing is typed
 * in except those two opening balances. Excel exports are written to the audit log.
 */
export function reportsRouter(deps, authenticate) {
  const router = Router();
  const view = [authenticate, requireRole("admin", "principal")];
  const adminOnly = [authenticate, requireRole("admin")];
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  /** Defaults: this financial year up to today. Rejects a future end or a backwards range. */
  function period(q) {
    const today = todayIst();
    const fyStart = istDateString(
      financialYearRange(getFinancialYear(new Date())).start,
    );
    const from = q.from ?? fyStart;
    const to = q.to ?? today;
    if (to > today)
      throw new AppError(
        "FUTURE_DATE",
        422,
        "The end date cannot be in the future.",
      );
    if (from > to)
      throw new AppError(
        "BAD_RANGE",
        422,
        "The start date is after the end date.",
      );
    if (dayNumber(to) - dayNumber(from) > 800)
      throw new AppError(
        "BAD_RANGE",
        422,
        "Choose a period of two years or less.",
      );
    return { from, to };
  }
  async function settingsOf(tenantId) {
    const s = await deps.reportsStore.getSettings(tenantId);
    return {
      fixedAssetsPaise: s?.fixedAssetsPaise ?? 0,
      capitalPaise: s?.capitalPaise ?? 0,
      set: !!s,
    };
  }

  async function incomeExpenditure(req, q) {
    const tenantId = req.user.tenantId;
    const { from, to } = period(q);
    const [income, expenses] = await Promise.all([
      deps.reportsStore.income(tenantId, from, to),
      deps.reportsStore.expenses(tenantId, from, to),
    ]);
    let compare;
    if (q.compare === "previous") {
      const len = dayNumber(to) - dayNumber(from) + 1;
      const cTo = addDaysToDateString(from, -1);
      const cFrom = addDaysToDateString(cTo, -(len - 1));
      const [cIncome, cExpenses] = await Promise.all([
        deps.reportsStore.income(tenantId, cFrom, cTo),
        deps.reportsStore.expenses(tenantId, cFrom, cTo),
      ]);
      compare = { from: cFrom, to: cTo, income: cIncome, expenses: cExpenses };
    }
    return buildIncomeExpenditure({ from, to, income, expenses, compare });
  }

  async function surplusUpTo(tenantId, upTo) {
    const [inc, exp] = await Promise.all([
      deps.reportsStore.income(tenantId, BEGINNING, upTo),
      deps.reportsStore.expenses(tenantId, BEGINNING, upTo),
    ]);
    const income =
      Object.values(inc.byHead).reduce((n, v) => n + v, 0) + inc.latePaise;
    return income - exp.reduce((n, e) => n + e.paise, 0);
  }

  async function balanceSheet(req, q) {
    const tenantId = req.user.tenantId;
    const asOn = q.asOn ?? todayIst();
    if (asOn > todayIst())
      throw new AppError(
        "FUTURE_DATE",
        422,
        "The date cannot be in the future.",
      );
    const [accounts, banks, settings, surplus, receivable, payables] =
      await Promise.all([
        deps.reportsStore.balances(tenantId, asOn),
        deps.moneyStore.listBanks(tenantId),
        settingsOf(tenantId),
        surplusUpTo(tenantId, asOn),
        deps.reportsStore.receivable(tenantId, asOn),
        deps.reportsStore.payables(tenantId, asOn),
      ]);
    for (const b of banks) accounts[`bank:${b._id}`] ??= 0;
    return buildBalanceSheet({
      asOn,
      accounts,
      banks,
      settings,
      surplusToDatePaise: surplus,
      receivablePaise: receivable,
      payablePaise: payables,
    });
  }

  async function trialBalance(req, q) {
    const tenantId = req.user.tenantId;
    const { from, to } = period(q);
    const [income, expenses, accounts, banks, settings, before] =
      await Promise.all([
        deps.reportsStore.income(tenantId, from, to),
        deps.reportsStore.expenses(tenantId, from, to),
        deps.reportsStore.balances(tenantId, to),
        deps.moneyStore.listBanks(tenantId),
        settingsOf(tenantId),
        surplusUpTo(tenantId, addDaysToDateString(from, -1)),
      ]);
    for (const b of banks) accounts[`bank:${b._id}`] ??= 0;
    return buildTrialBalance({
      from,
      to,
      income,
      expenses,
      accounts,
      banks,
      settings,
      surplusBeforePaise: before,
    });
  }

  async function dayBook(req, q, { all = false } = {}) {
    const { from, to } = period(q);
    if (dayNumber(to) - dayNumber(from) + 1 > DAY_BOOK_MAX_DAYS)
      throw new AppError(
        "BAD_RANGE",
        422,
        `Choose ${DAY_BOOK_MAX_DAYS} days or fewer for the Day Book.`,
      );
    const banks = await deps.moneyStore.listBanks(req.user.tenantId);
    const entries = await deps.reportsStore.dayBookEntries(
      req.user.tenantId,
      from,
      to,
      banks,
    );
    if (all) {
      if (entries.length > EXPORT_LIMIT)
        throw new AppError(
          "TOO_MANY_ROWS",
          422,
          "Too many entries for one file. Choose a shorter period.",
        );
      return { from, to, rows: dayBookAll(entries) };
    }
    return buildDayBook({
      from,
      to,
      entries,
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 50,
    });
  }

  router.get(
    "/reports/income-expenditure",
    ...view,
    wrap(async (req, res) =>
      res.json(await incomeExpenditure(req, rangeQuery.parse(req.query))),
    ),
  );
  router.get(
    "/reports/balance-sheet",
    ...view,
    wrap(async (req, res) =>
      res.json(await balanceSheet(req, rangeQuery.parse(req.query))),
    ),
  );
  router.get(
    "/reports/trial-balance",
    ...view,
    wrap(async (req, res) =>
      res.json(await trialBalance(req, rangeQuery.parse(req.query))),
    ),
  );
  router.get(
    "/reports/day-book",
    ...view,
    wrap(async (req, res) =>
      res.json(await dayBook(req, rangeQuery.parse(req.query))),
    ),
  );

  router.get(
    "/reports/settings",
    ...view,
    wrap(async (req, res) => {
      const s = await deps.reportsStore.getSettings(req.user.tenantId);
      res.json({
        set: !!s,
        fixedAssetsPaise: s?.fixedAssetsPaise ?? 0,
        capitalPaise: s?.capitalPaise ?? 0,
        history: (s?.history ?? []).map((h) => ({
          at: h.at,
          byName: h.byName ?? null,
          reason: h.reason,
          fixedAssetsPaise: h.fixedAssetsPaise,
          capitalPaise: h.capitalPaise,
        })),
      });
    }),
  );

  router.put(
    "/reports/settings",
    ...adminOnly,
    wrap(async (req, res) => {
      const body = settingsBody.parse(req.body);
      let fixed;
      let capital;
      try {
        fixed = rupeesToPaise(body.fixedAssetsRupees);
        capital = rupeesToPaise(body.capitalRupees);
      } catch {
        throw new AppError("VALIDATION", 400, "Enter valid amounts.");
      }
      if (fixed < 0 || capital < 0)
        throw new AppError("VALIDATION", 400, "Amounts cannot be negative.");
      const before = await settingsOf(req.user.tenantId);
      const saved = await deps.reportsStore.saveSettings({
        tenantId: req.user.tenantId,
        fixedAssetsPaise: fixed,
        capitalPaise: capital,
        reason: body.reason,
        user: req.user,
      });
      await recordAudit(deps, req, {
        action: "update",
        entity: "ReportSettings",
        entityId: String(saved._id),
        oldValue: {
          fixedAssetsPaise: before.fixedAssetsPaise,
          capitalPaise: before.capitalPaise,
        },
        newValue: { fixedAssetsPaise: fixed, capitalPaise: capital },
        reason: body.reason,
      });
      res.json({ ok: true, fixedAssetsPaise: fixed, capitalPaise: capital });
    }),
  );

  router.get(
    "/reports/export",
    ...view,
    wrap(async (req, res) => {
      const type = z
        .enum([
          "income-expenditure",
          "balance-sheet",
          "trial-balance",
          "day-book",
        ])
        .parse(req.query.type);
      const q = rangeQuery.parse(req.query);
      const R = (p) => p / 100;
      const bold = (value) => ({ value, fontWeight: "bold" });
      let rows;
      let name;
      if (type === "income-expenditure") {
        const r = await incomeExpenditure(req, q);
        name = `income-expenditure-${r.from}-to-${r.to}`;
        const cmp = !!r.compare;
        rows = [
          [bold(`Income & Expenditure ${r.from} to ${r.to} (cash basis)`)],
          [],
        ];
        rows.push([
          bold("Income"),
          bold("Amount"),
          ...(cmp ? [bold(`${r.compare.from} to ${r.compare.to}`)] : []),
        ]);
        for (const l of r.income)
          rows.push([l.label, R(l.paise), ...(cmp ? [R(l.comparePaise)] : [])]);
        rows.push(
          [
            bold("Total income"),
            bold(R(r.totalIncomePaise)),
            ...(cmp ? [bold(R(r.compare.totalIncomePaise))] : []),
          ],
          [],
        );
        rows.push([
          bold("Expenditure"),
          bold("Amount"),
          ...(cmp ? [bold("Earlier period")] : []),
        ]);
        for (const l of r.expenditure)
          rows.push([l.label, R(l.paise), ...(cmp ? [R(l.comparePaise)] : [])]);
        rows.push(
          [
            bold("Total expenditure"),
            bold(R(r.totalExpenditurePaise)),
            ...(cmp ? [bold(R(r.compare.totalExpenditurePaise))] : []),
          ],
          [],
        );
        rows.push([
          bold("Surplus / (deficit)"),
          bold(R(r.surplusPaise)),
          ...(cmp ? [bold(R(r.compare.surplusPaise))] : []),
        ]);
      } else if (type === "balance-sheet") {
        const r = await balanceSheet(req, q);
        name = `balance-sheet-${r.asOn}`;
        rows = [
          [bold(`Balance Sheet as on ${r.asOn} (cash basis)`)],
          [],
          [bold("Assets"), bold("Amount")],
        ];
        for (const l of r.assets) rows.push([l.label, R(l.paise)]);
        rows.push(
          [bold("Total assets"), bold(R(r.totalAssetsPaise))],
          [],
          [bold("Funds"), bold("Amount")],
        );
        for (const l of r.funds) rows.push([l.label, R(l.paise)]);
        rows.push([bold("Total funds"), bold(R(r.totalFundsPaise))]);
        rows.push(
          [
            "Difference (assets - funds), check opening balances",
            R(r.differencePaise),
          ],
          [],
        );
        rows.push([bold("Memo items (not in the totals)")]);
        rows.push([
          "Fee dues to be received (excluding late fee)",
          R(r.memo.feeReceivablePaise),
        ]);
        rows.push(["Approved expenses not yet paid", R(r.memo.payablesPaise)]);
      } else if (type === "trial-balance") {
        const r = await trialBalance(req, q);
        name = `trial-balance-${r.from}-to-${r.to}`;
        rows = [
          [bold(`Trial Balance ${r.from} to ${r.to}`)],
          [],
          [bold("Account"), bold("Debit"), bold("Credit")],
        ];
        for (const l of r.rows)
          rows.push([
            l.label,
            l.debitPaise ? R(l.debitPaise) : "",
            l.creditPaise ? R(l.creditPaise) : "",
          ]);
        rows.push([
          bold("Total"),
          bold(R(r.totalDebitPaise)),
          bold(R(r.totalCreditPaise)),
        ]);
      } else {
        const r = await dayBook(req, q, { all: true });
        name = `day-book-${r.from}-to-${r.to}`;
        rows = [
          [bold(`Day Book ${r.from} to ${r.to}`)],
          [],
          [
            "Date and time (IST)",
            "Type",
            "Reference",
            "Particulars",
            "Account",
            "Money in",
            "Money out",
          ].map(bold),
        ];
        for (const e of r.rows)
          rows.push([
            new Date(e.at).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
            }),
            e.type,
            e.ref,
            e.particulars,
            e.account,
            e.inPaise ? R(e.inPaise) : "",
            e.outPaise ? R(e.outPaise) : "",
          ]);
      }
      const buffer = await writeXlsxFile(rows).toBuffer();
      await recordAudit(deps, req, {
        action: "export",
        entity: "Report",
        entityId: type,
        newValue: {
          type,
          from: q.from ?? null,
          to: q.to ?? null,
          asOn: q.asOn ?? null,
        },
      });
      res.setHeader("Content-Type", XLSX);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${name}.xlsx"`,
      );
      res.send(Buffer.from(buffer));
    }),
  );

  return router;
}
