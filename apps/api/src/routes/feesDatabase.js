import { Router } from "express";
import writeXlsxFile from "write-excel-file/node";
import { z } from "zod";
import {
  CLASS_KEYS,
  ReceiptRuleError,
  computeDues,
  creditsFromReceipts,
  lateSettledFromReceipts,
  classLabel,
  getFinancialYear,
  istDateString,
  planRebate,
  todayIst,
} from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import {
  buildFeeRows,
  filterRows,
  sortRows,
  totalsOf,
} from "../services/feesDatabase.js";
import { AppError, notFound } from "../utils/errors.js";

const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EXPORT_LIMIT = 6000;
// Which receipt lines are "school fee" and which are "transport fee" in the payment history.
// Everything else on a receipt (T.C., other, late fee) is shown as "other".
const SCHOOL_HEADS = ["tuition", "old_fees", "admission", "form"];
const TRANSPORT_HEADS = ["transport", "transport_old"];
const detailsQuery = z.object({
  fy: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  mode: z.enum(["cash", "upi"]).optional(),
  category: z.enum(["school", "transport", "other"]).optional(),
});
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const rupeesToPaise = z.coerce
  .number()
  .min(0)
  .transform((r) => Math.round(r * 100));
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Bad id");

const filterQuery = z.object({
  fy: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  q: z.string().trim().max(60).optional(),
  classKey: z.enum(CLASS_KEYS).optional(),
  section: z.string().trim().max(5).optional(),
  status: z.enum(["active", "inactive"]).default("active"),
  transport: bool.optional(),
  newAdmission: bool.optional(),
  rte: bool.optional(),
  village: z.string().trim().max(60).optional(),
  category: z.string().trim().max(10).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  feeStatus: z
    .enum(["noplan", "overdue", "pending", "clear", "school_paid_bus_pending"])
    .optional(),
  // "Dues up to this month" (YYYY-MM): fees due by the END of that month, whatever is paid today.
  upto: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  // Rupees in the URL, paise inside (rule: money is paise on the server).
  minDue: rupeesToPaise.optional(),
  maxDue: rupeesToPaise.optional(),
});
const listQuery = filterQuery.extend({
  sort: z
    .enum(["admissionNo", "name", "class", "outstanding", "dueNow", "paid"])
    .optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
// Last day of a "YYYY-MM" month, e.g. 2026-09 -> 2026-09-30 (the day dues are worked out for).
const endOfMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const rebateBody = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  kind: z.enum(["school", "transport"]),
  amountPaise: z.number().int().positive().max(100_000_000_00),
  head: z
    .enum([
      "tuition",
      "admission",
      "form",
      "transport",
      "old_fees",
      "transport_old",
    ])
    .optional(),
  reason: z.string().trim().min(3, "Write the reason").max(300),
});
const waiverBody = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  periods: z
    .array(z.string().min(1).max(20))
    .min(1, "Choose at least one month")
    .max(12),
  reason: z.string().trim().min(3, "Write the reason").max(300),
});
const reverseBody = z.object({
  reason: z.string().trim().min(3, "Write the reason").max(300),
});

const shapeRebate = (r) => ({
  id: String(r._id),
  studentId: String(r.studentId),
  student: r.student ?? null,
  fy: r.fy,
  kind: r.kind,
  periods: r.periods ?? [],
  totalPaise: r.totalPaise,
  reason: r.reason,
  status: r.status,
  reversedReason: r.reversedReason ?? null,
  createdByName: r.createdByName ?? null,
  createdAt: r.createdAt,
});

/**
 * Fees Database. Everyone signed in can LOOK (the Cashier too, read-only and without Excel);
 * only the Admin changes anything (late-fee waivers here; rebates have their own module,
 * rebates.js; fees are posted automatically every month).
 */
export function feesDatabaseRouter(deps, authenticate) {
  const router = Router();
  const all = [authenticate, requireRole("admin", "principal", "cashier")];
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
  const ruleToHttp = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ReceiptRuleError)
        throw new AppError(
          e.code,
          422,
          e.message,
          e.field ? { [e.field]: e.message } : undefined,
        );
      throw e;
    }
  };

  async function rowsFor(req, f) {
    const fy = f.fy ?? getFinancialYear(new Date());
    const { fy: _fy, feeStatus, minDue, maxDue, upto, ...studentFilters } = f;
    const rows = await buildFeeRows({
      deps,
      tenantId: req.user.tenantId,
      fy,
      filters: studentFilters,
      asOf: upto ? endOfMonth(upto) : todayIst(),
    });
    return {
      fy,
      rows: filterRows(rows, {
        feeStatus,
        minDuePaise: minDue,
        maxDuePaise: maxDue,
      }),
    };
  }

  router.get(
    "/fees-database",
    ...all,
    wrap(async (req, res) => {
      const f = listQuery.parse(req.query);
      const { fy, rows } = await rowsFor(req, f);
      const sorted = sortRows(rows, f.sort, f.dir);
      res.json({
        fy,
        page: f.page,
        pageSize: f.pageSize,
        total: sorted.length,
        totals: totalsOf(rows),
        rows: sorted.slice((f.page - 1) * f.pageSize, f.page * f.pageSize),
      });
    }),
  );

  router.get(
    "/fees-database/export",
    authenticate,
    requireRole("admin", "principal"),
    wrap(async (req, res) => {
      const f = filterQuery.parse(req.query);
      const { fy, rows } = await rowsFor(req, f);
      if (rows.length > EXPORT_LIMIT)
        throw new AppError(
          "TOO_MANY_ROWS",
          413,
          "Too many students. Narrow the filters.",
        );
      // Every column of the school's sheet is always exported (hiding columns is only on screen).
      const head = [
        "S.NO",
        "SCH. ID",
        "STUDENT NAME",
        "CLASS",
        "SECTION",
        "ADDRESS",
        "CONTACT NO.",
        "OLD SCHOOL DUE",
        "OLD BUS DUE",
        "NEW SCHOOL RECEIVABLE",
        "NEW BUS RECEIVABLE",
        "ADM FEES REC.",
        "FORM FEES REC.",
        "NEW SCHOOL FEE PAID",
        "NEW BUS FEE PAID",
        "ADMISSION FEE PAID",
        "FORM FEE PAID",
        "SCHOOL - REBATE",
        "TRANSPORT - REBATE",
        "ADMISSION - REBATE",
        "NEW SCHOOL FEES DUE",
        "NEW BUS FEES DUE",
        "ADM FEES DUE",
        "FORM FEES DUE",
        "TOTAL DUES",
        "LATE FEE (PENALTY, NOT IN TOTAL)",
        "STATUS",
      ];
      const r = (p) => p / 100;
      const body = sortRows(rows, "class").map((x, i) => [
        i + 1,
        x.admissionNo,
        x.name,
        classLabel(x.classKey),
        x.section,
        x.address,
        x.contactNo,
        r(x.cols.oldSchoolDue),
        r(x.cols.oldBusDue),
        r(x.cols.newSchoolReceivable),
        r(x.cols.newBusReceivable),
        r(x.cols.admReceivable),
        r(x.cols.formReceivable),
        r(x.cols.newSchoolPaid),
        r(x.cols.newBusPaid),
        r(x.cols.admPaid),
        r(x.cols.formPaid),
        r(x.cols.schoolRebate),
        r(x.cols.transportRebate),
        r(x.cols.admissionRebate),
        r(x.cols.newSchoolDue),
        r(x.cols.newBusDue),
        r(x.cols.admDue),
        r(x.cols.formDue),
        r(x.dueNowPaise),
        r(x.lateFeePaise),
        x.status === "active" ? "Active" : "Inactive",
      ]);
      const buffer = await writeXlsxFile([
        head.map((value) => ({ value, fontWeight: "bold" })),
        ...body,
      ]).toBuffer();
      await recordAudit(deps, req, {
        action: "export",
        entity: "fees_database",
        newValue: { rows: rows.length, fy, upto: f.upto ?? null },
      });
      res
        .set("Content-Type", XLSX)
        .set(
          "Content-Disposition",
          `attachment; filename="fees-database-${istDateString(new Date())}.xlsx"`,
        )
        .send(buffer);
    }),
  );

  // ----- rebates -----
  router.get(
    "/students/:id/rebates",
    authenticate,
    requireRole("admin", "principal"),
    wrap(async (req, res) => {
      const rows = await deps.rebateStore.listForStudent(
        req.user.tenantId,
        objectId.parse(req.params.id),
      );
      res.json({ rows: rows.map(shapeRebate) });
    }),
  );

  router.post(
    "/students/:id/rebates",
    authenticate,
    requireRole("admin"),
    wrap(async (req, res) => {
      const body = rebateBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const student = await deps.studentStore.findById(
        tenantId,
        objectId.parse(req.params.id),
      );
      if (!student) throw notFound("Student");
      const rows = await deps.chargeStore.listForStudent(
        tenantId,
        student._id,
        body.fy,
      );
      const charges = rows.map((c) => ({
        id: String(c._id),
        head: c.head,
        period: c.period,
        dueDate: c.dueDate,
        amount: c.amountPaise,
      }));
      if (charges.length === 0)
        throw new AppError(
          "NO_FEE_PLAN",
          409,
          "This student has no fees posted for that year. Apply fees first.",
        );
      const chart = await deps.feeStore.get(tenantId, body.fy);
      const saved = await deps.rebateStore.create({
        tenantId,
        studentId: student._id,
        fy: body.fy,
        kind: body.kind,
        rebateType: body.kind,
        reason: body.reason,
        student: {
          name: student.name,
          admissionNo: student.admissionNo,
          classKey: student.classKey,
        },
        user: req.user,
        // Runs inside the transaction on freshly read receipts and rebates.
        build: (prior) =>
          ruleToHttp(() =>
            planRebate({
              kind: body.kind,
              charges,
              receipts: prior,
              asOf: todayIst(),
              config: chart ?? undefined,
              amountPaise: body.amountPaise,
              head: body.head,
            }),
          ),
        audit: (doc) =>
          recordAudit(
            deps,
            req,
            {
              action: "create",
              entity: "rebate",
              entityId: String(doc._id),
              reason: body.reason,
              newValue: {
                student: student.admissionNo,
                fy: body.fy,
                kind: body.kind,
                totalPaise: doc.totalPaise,
              },
            },
            { critical: true },
          ),
      });
      res.status(201).json(shapeRebate(saved));
    }),
  );

  // One student's full fee picture: who, what was billed / paid / rebated / is due (school and
  // transport kept apart, old dues apart from this session's), and every receipt.
  // READ-ONLY and worked out by the same fee engine as Collect Fee.
  router.get(
    "/students/:id/fee-details",
    authenticate,
    requireRole("admin", "principal", "cashier"),
    wrap(async (req, res) => {
      const q = detailsQuery.parse(req.query);
      const tenantId = req.user.tenantId;
      const fy = q.fy ?? getFinancialYear(new Date());
      const student = await deps.studentStore.findById(
        tenantId,
        objectId.parse(req.params.id),
      );
      if (!student) throw notFound("Student");
      const chart = await deps.feeStore.get(tenantId, fy);
      const [chargeRows, counted, all] = await Promise.all([
        deps.chargeStore.listForStudent(tenantId, student._id, fy),
        deps.receiptStore.listForStudent(tenantId, student._id, fy),
        deps.receiptStore.listByStudent(tenantId, student._id, {
          fy,
          from: q.from,
          to: q.to,
          mode: q.mode,
        }),
      ]);
      const charges = chargeRows.map((c) => ({
        id: String(c._id),
        head: c.head,
        period: c.period,
        dueDate: c.dueDate,
        amount: c.amountPaise,
      }));
      const dues = computeDues({
        charges,
        credits: creditsFromReceipts(counted),
        asOf: todayIst(),
        config: chart ?? undefined,
        lateFeesSettled: lateSettledFromReceipts(counted),
      });
      const byHead = {};
      for (const inst of dues.instalments)
        for (const it of inst.items) {
          const h = (byHead[it.head] ??= {
            billed: 0,
            paid: 0,
            concession: 0,
            due: 0,
          });
          h.billed += it.amount;
          h.paid += it.paid;
          h.concession += it.concession;
          h.due += it.due;
        }
      const group = (heads) =>
        heads.reduce(
          (n, k) => ({
            billedPaise: n.billedPaise + (byHead[k]?.billed ?? 0),
            paidPaise: n.paidPaise + (byHead[k]?.paid ?? 0),
            concessionPaise: n.concessionPaise + (byHead[k]?.concession ?? 0),
            outstandingPaise: n.outstandingPaise + (byHead[k]?.due ?? 0),
          }),
          {
            billedPaise: 0,
            paidPaise: 0,
            concessionPaise: 0,
            outstandingPaise: 0,
          },
        );
      const part = (r, heads) =>
        r.lines
          .filter((l) => heads.includes(l.head))
          .reduce((n, l) => n + l.amountPaise, 0);
      let payments = all.map((r) => {
        const school = part(r, SCHOOL_HEADS);
        const transport = part(r, TRANSPORT_HEADS);
        return {
          id: String(r._id),
          number: r.number,
          issuedAt: r.issuedAt,
          status: r.status,
          totalPaise: r.totalPaise,
          schoolPaise: school,
          transportPaise: transport,
          otherPaise: r.totalPaise - school - transport,
          mode: r.mode,
          reference: r.reference ?? null,
          bankName: r.bankName ?? null,
          cashierName: r.cashierName ?? null,
          cancellation: r.cancellation
            ? {
                status: r.cancellation.status,
                reason: r.cancellation.reason,
                requestedByName: r.cancellation.requestedByName ?? null,
                decidedByName: r.cancellation.decidedByName ?? null,
                decidedAt: r.cancellation.decidedAt ?? null,
              }
            : null,
        };
      });
      if (q.category === "school")
        payments = payments.filter((p) => p.schoolPaise > 0);
      if (q.category === "transport")
        payments = payments.filter((p) => p.transportPaise > 0);
      if (q.category === "other")
        payments = payments.filter((p) => p.otherPaise > 0);
      const counts = (p) => p.status !== "cancelled";
      res.json({
        fy,
        student: {
          id: String(student._id),
          name: student.name,
          admissionNo: student.admissionNo,
          fatherName: student.fatherName ?? "",
          classKey: student.classKey,
          section: student.section ?? "",
          address: student.address ?? "",
          contactNo: student.contactNo ?? "",
          status: student.status,
          usesTransport: !!student.usesTransport,
          transportFrom: student.transportFrom ?? null,
          transportUntil: student.transportUntil ?? null,
        },
        planPosted: charges.length > 0,
        summary: {
          oldSchool: group(["old_fees"]),
          oldTransport: group(["transport_old"]),
          currentSchool: group(["tuition", "admission", "form"]),
          currentTransport: group(["transport"]),
          totals: {
            billedPaise: dues.totals.billed,
            concessionPaise: dues.totals.concession,
            paidPaise: dues.totals.paid,
            outstandingPaise: dues.totals.outstanding,
            lateFeePaise: dues.totals.lateFee,
          },
        },
        payments,
        // Cancelled receipts are listed but never counted as money received.
        paymentTotals: {
          count: payments.filter(counts).length,
          totalPaise: payments
            .filter(counts)
            .reduce((n, p) => n + p.totalPaise, 0),
        },
      });
    }),
  );

  // Late-fee relaxation: the Admin waives the late fee of chosen overdue months, with a reason.
  // Stored like a rebate (so it can be reversed and is audited) but it carries months, not money.
  router.post(
    "/students/:id/late-fee-waivers",
    authenticate,
    requireRole("admin"),
    wrap(async (req, res) => {
      const body = waiverBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const student = await deps.studentStore.findById(
        tenantId,
        objectId.parse(req.params.id),
      );
      if (!student) throw notFound("Student");
      const rows = await deps.chargeStore.listForStudent(
        tenantId,
        student._id,
        body.fy,
      );
      const charges = rows.map((c) => ({
        id: String(c._id),
        head: c.head,
        period: c.period,
        dueDate: c.dueDate,
        amount: c.amountPaise,
      }));
      const chart = await deps.feeStore.get(tenantId, body.fy);
      const saved = await deps.rebateStore.create({
        tenantId,
        studentId: student._id,
        fy: body.fy,
        kind: "late_fee",
        reason: body.reason,
        student: {
          name: student.name,
          admissionNo: student.admissionNo,
          classKey: student.classKey,
        },
        user: req.user,
        // Inside the transaction, on freshly read data: only months that REALLY carry a late fee
        // right now can be waived (so a month cannot be waived twice or before it is late).
        build: (prior) => {
          const dues = computeDues({
            charges,
            credits: creditsFromReceipts(prior),
            asOf: todayIst(),
            config: chart ?? undefined,
            lateFeesSettled: lateSettledFromReceipts(prior),
          });
          const late = new Map(
            dues.instalments
              .filter((i) => i.lateFee > 0)
              .map((i) => [i.period, i.lateFee]),
          );
          const bad = body.periods.filter((p) => !late.has(p));
          if (bad.length)
            throw new AppError(
              "NO_LATE_FEE",
              422,
              `No late fee is pending for: ${bad.join(", ")}.`,
              { periods: "Choose months that have a late fee" },
            );
          return {
            lines: [],
            periods: body.periods,
            totalPaise: body.periods.reduce((n, p) => n + late.get(p), 0),
          };
        },
        audit: (doc) =>
          recordAudit(
            deps,
            req,
            {
              action: "create",
              entity: "late_fee_waiver",
              entityId: String(doc._id),
              reason: body.reason,
              newValue: {
                student: student.admissionNo,
                fy: body.fy,
                periods: body.periods,
                totalPaise: doc.totalPaise,
              },
            },
            { critical: true },
          ),
      });
      res.status(201).json(shapeRebate(saved));
    }),
  );

  router.post(
    "/rebates/:id/reverse",
    authenticate,
    requireRole("admin"),
    wrap(async (req, res) => {
      const { reason } = reverseBody.parse(req.body);
      const id = objectId.parse(req.params.id);
      const done = await deps.rebateStore.reverse({
        tenantId: req.user.tenantId,
        id,
        reason,
        user: req.user,
      });
      if (!done)
        throw new AppError(
          "NOT_FOUND",
          404,
          "Rebate not found or already reversed.",
        );
      await recordAudit(
        deps,
        req,
        { action: "cancel", entity: "rebate", entityId: id, reason },
        { critical: true },
      );
      res.json(shapeRebate(done));
    }),
  );

  return router;
}
