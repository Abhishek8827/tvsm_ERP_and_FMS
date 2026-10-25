import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  AUTHORISERS,
  ExpenseRuleError,
  PAY_MODES,
  getFinancialYear,
  isValidPin,
  todayIst,
} from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import { AppError, notFound } from "../utils/errors.js";

/**
 * School expenses, petty cash, bank & cash (Step 6). Roles (confirmed by the school):
 *  Admin     makes vouchers, payments, adjustments, petty entries, transfers, heads, banks, PIN
 *  Principal approves/rejects vouchers and reversals; sees every entry and every balance
 *  Cashier   sees only the petty cash balance + last 5 entries, bank names for Collect Fee, and
 *            (with the 4-digit PIN) all balances. Nothing else.
 */
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const idemKey = z
  .string({ error: "Idempotency-Key header is required" })
  .regex(
    /^[\w-]{8,100}$/,
    "Idempotency-Key must be 8-100 letters, digits, - or _",
  );
const paise = z.number().int().min(1).max(100_000_000_00);
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-06-30");
const text = (max) => z.string().trim().max(max);
const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
const rangeQuery = { from: dateField.optional(), to: dateField.optional() };
const accountKey = z
  .string()
  .regex(/^(cash|petty|bank:[a-f\d]{24})$/, "Unknown account");

const bankBody = z.object({
  name: text(60).min(2, "Write the bank name"),
  last4: z
    .string()
    .regex(/^\d{4}$/, "Last 4 digits of the account")
    .optional(),
  openingPaise: z.number().int().min(0).max(100_000_000_00).optional(),
  defaultForModes: z.array(z.enum(["upi", "qr"])).optional(),
});
const bankPatch = z.object({
  name: text(60).min(2).optional(),
  active: z.boolean().optional(),
  defaultForModes: z.array(z.enum(["upi", "qr"])).optional(),
});
const voucherBody = z.object({
  date: dateField,
  headId: objectId,
  payeeName: text(80),
  particulars: text(300),
  amountPaise: paise,
});
const paymentBody = z.object({
  date: dateField,
  amountPaise: paise,
  mode: z.enum(PAY_MODES),
  bankId: objectId.optional(),
  authorisedBy: z.enum(AUTHORISERS),
  details: text(200).optional(),
  remark: text(200).optional(),
});
const adjustmentBody = z.object({
  amountPaise: paise,
  reason: text(200).min(3, "Write the reason"),
  remark: text(300).min(3, "Write the supporting remark"),
});
const pettyBody = z.object({
  date: dateField,
  headId: objectId.optional(),
  payeeName: text(80),
  particulars: text(300),
  amountPaise: paise,
});
const reasonText = text(300).min(3, "Write the reason");
const reasonBody = z.object({ reason: text(300).min(3, "Write the reason") });

const shapeVoucher = (v) => ({
  id: String(v._id),
  number: v.number,
  date: v.date,
  headName: v.headName,
  payeeName: v.payeeName,
  particulars: v.particulars,
  amountPaise: v.amountPaise,
  status: v.status,
  paidPaise: v.paidPaise ?? 0,
  adjustedPaise: v.adjustedPaise ?? 0,
  balanceDuePaise: v.balanceDuePaise ?? v.amountPaise,
  adjustments: (v.adjustments ?? []).map((a) => ({
    amountPaise: a.amountPaise,
    reason: a.reason,
    remark: a.remark,
    byName: a.byName ?? null,
    at: a.at,
  })),
  createdByName: v.createdByName ?? null,
  decidedByName: v.decidedByName ?? null,
  decidedAt: v.decidedAt ?? null,
  rejectionReason: v.rejectionReason ?? null,
});
const shapePayment = (p) => ({
  id: String(p._id),
  seq: p.seq,
  voucherId: String(p.voucherId),
  voucherNumber: p.voucherNumber,
  date: p.date,
  headName: p.headName,
  payeeName: p.payeeName,
  details: p.details,
  mode: p.mode,
  bankName: p.bankName ?? null,
  amountPaise: p.amountPaise,
  // "Approved by" shows the Principal who approved the voucher and who authorised the payment.
  approvedBy: [p.approvedByName, p.authorisedBy].filter(Boolean).join(" / "),
  authorisedBy: p.authorisedBy,
  remark: p.remark,
  status: p.status,
});
const shapePetty = (e) => ({
  id: String(e._id),
  seq: e.seq,
  date: e.date,
  headName: e.headName ?? null,
  payeeName: e.payeeName,
  particulars: e.particulars,
  amountPaise: e.amountPaise,
  status: e.status,
  reversalReason: e.reversalReason ?? null,
});
const shapeReversal = (r) => ({
  id: String(r._id),
  kind: r.kind,
  targetId: String(r.targetId),
  voucherId: String(r.voucherId),
  voucherNumber: r.voucherNumber,
  amountPaise: r.amountPaise,
  status: r.status,
  reason: r.reason,
  requestedByName: r.requestedByName ?? null,
  decidedByName: r.decidedByName ?? null,
  decisionNote: r.decisionNote ?? null,
  createdAt: r.createdAt,
});

/** Rule errors become 422 with the field, like the receipt rules. */
const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof ExpenseRuleError)
      return next(
        new AppError(
          e.code,
          422,
          e.message,
          e.field ? { [e.field]: e.message } : undefined,
        ),
      );
    next(e);
  }
};

export function moneyRouter(deps, authenticate) {
  const router = Router();
  const store = () => deps.moneyStore;
  const adminOnly = [authenticate, requireRole("admin")];
  const principalOnly = [authenticate, requireRole("principal")];
  const adminOrPrincipal = [authenticate, requireRole("admin", "principal")];
  const anyRole = [authenticate, requireRole("admin", "principal", "cashier")];
  const tenant = (req) => req.user.tenantId;
  const audit = (req, entry) => (saved, session) =>
    recordAudit(deps, req, { ...entry(saved) }, { critical: true, session });
  const notFoundIfNull = (v, what) => {
    if (!v) throw notFound(what);
    return v;
  };
  const noFuture = (date) => {
    if (date > todayIst())
      throw new AppError(
        "FUTURE_DATE",
        422,
        "The date cannot be in the future.",
        {
          date: "The date cannot be in the future.",
        },
      );
  };

  // ----- balances -----
  router.get(
    "/money/overview",
    ...adminOrPrincipal,
    wrap(async (req, res) => {
      res.json(await store().overview(tenant(req)));
    }),
  );
  router.get(
    "/money/pending",
    ...adminOrPrincipal,
    wrap(async (req, res) => {
      res.json(await store().pendingCounts(tenant(req)));
    }),
  );
  router.post(
    "/money/opening",
    ...adminOnly,
    wrap(async (req, res) => {
      const body = z
        .object({ account: z.enum(["cash", "petty"]), amountPaise: paise })
        .parse(req.body);
      const row = await store().setOpening({
        tenantId: tenant(req),
        ...body,
        user: req.user,
        audit: (saved) =>
          recordAudit(
            deps,
            req,
            {
              action: "create",
              entity: "opening_balance",
              entityId: String(saved._id),
              newValue: body,
            },
            { critical: true },
          ),
      });
      res.status(201).json({ id: String(row._id) });
    }),
  );

  // Edit any opening balance (cash, petty or a bank). Reason is compulsory; history is kept.
  router.put(
    "/money/opening",
    ...adminOnly,
    wrap(async (req, res) => {
      const body = z
        .object({ account: accountKey, amountPaise: paise, reason: reasonText })
        .parse(req.body);
      const out = await store().changeOpening({
        tenantId: tenant(req),
        ...body,
        user: req.user,
        audit: (saved) =>
          recordAudit(
            deps,
            req,
            {
              action: "update",
              entity: "opening_balance",
              entityId: body.account,
              reason: body.reason,
              oldValue: { amountPaise: saved.fromPaise },
              newValue: { amountPaise: saved.toPaise },
            },
            { critical: true },
          ),
      });
      res.json(out);
    }),
  );

  // ----- bank accounts -----
  // Names only (no balances): the Cashier needs them to choose the bank for a UPI / QR receipt.
  router.get(
    "/banks/options",
    ...anyRole,
    wrap(async (req, res) => {
      const banks = await store().listBanks(tenant(req), { onlyActive: true });
      res.json({
        banks: banks.map((b) => ({
          id: String(b._id),
          name: b.name,
          last4: b.last4 ?? null,
          defaultForModes: b.defaultForModes,
        })),
      });
    }),
  );
  router.post(
    "/banks",
    ...adminOnly,
    wrap(async (req, res) => {
      const body = bankBody.parse(req.body);
      const bank = await store().createBank({
        tenantId: tenant(req),
        input: body,
        user: req.user,
        audit: audit(req, (b) => ({
          action: "create",
          entity: "bank_account",
          entityId: String(b._id),
          newValue: { name: b.name, openingPaise: body.openingPaise ?? 0 },
        })),
      });
      res.status(201).json({ id: String(bank._id) });
    }),
  );
  router.patch(
    "/banks/:id",
    ...adminOnly,
    wrap(async (req, res) => {
      const patch = bankPatch.parse(req.body);
      const bank = await store().updateBank({
        tenantId: tenant(req),
        id: objectId.parse(req.params.id),
        patch,
        audit: (b) =>
          recordAudit(
            deps,
            req,
            {
              action: "update",
              entity: "bank_account",
              entityId: String(b._id),
              newValue: patch,
            },
            { critical: true },
          ),
      });
      notFoundIfNull(bank, "Bank account");
      res.json({ id: String(bank._id) });
    }),
  );

  // ----- expense heads -----
  router.get(
    "/expense-heads",
    ...adminOrPrincipal,
    wrap(async (req, res) => {
      const heads = await store().listHeads(tenant(req));
      res.json({
        heads: heads.map((h) => ({
          id: String(h._id),
          name: h.name,
          active: h.active,
        })),
      });
    }),
  );
  router.post(
    "/expense-heads",
    ...adminOnly,
    wrap(async (req, res) => {
      const { name } = z
        .object({ name: text(60).min(2, "Write the head name") })
        .parse(req.body);
      const head = await store().createHead({
        tenantId: tenant(req),
        name,
        user: req.user,
        audit: (h) =>
          recordAudit(
            deps,
            req,
            {
              action: "create",
              entity: "expense_head",
              entityId: String(h._id),
              newValue: { name },
            },
            { critical: true },
          ),
      });
      res
        .status(201)
        .json({ id: String(head._id), name: head.name, active: head.active });
    }),
  );
  router.patch(
    "/expense-heads/:id",
    ...adminOnly,
    wrap(async (req, res) => {
      const patch = z
        .object({
          name: text(60).min(2).optional(),
          active: z.boolean().optional(),
        })
        .parse(req.body);
      const head = await store().updateHead({
        tenantId: tenant(req),
        id: objectId.parse(req.params.id),
        patch,
        audit: (h) =>
          recordAudit(
            deps,
            req,
            {
              action: "update",
              entity: "expense_head",
              entityId: String(h._id),
              newValue: patch,
            },
            { critical: true },
          ),
      });
      notFoundIfNull(head, "Expense head");
      res.json({ id: String(head._id), name: head.name, active: head.active });
    }),
  );

  // ----- vouchers -----
  router.get(
    "/vouchers",
    ...adminOrPrincipal,
    wrap(async (req, res) => {
      const f = z
        .object({
          ...pageQuery,
          ...rangeQuery,
          status: z
            .enum(["pending", "approved", "rejected", "cancelled"])
            .optional(),
          q: text(60).optional(),
        })
        .parse(req.query);
      const out = await store().listVouchers({ tenantId: tenant(req), ...f });
      res.json({
        rows: out.rows.map(shapeVoucher),
        total: out.total,
        page: f.page,
        pageSize: f.pageSize,
        totals: out.totals,
      });
    }),
  );
  router.get(
    "/vouchers/:id",
    ...adminOrPrincipal,
    wrap(async (req, res) => {
      const v = notFoundIfNull(
        await store().getVoucher(tenant(req), objectId.parse(req.params.id)),
        "Voucher",
      );
      res.json({
        ...shapeVoucher(v),
        payments: v.payments.map(shapePayment),
        reversals: v.reversals.map(shapeReversal),
      });
    }),
  );
  router.post(
    "/vouchers",
    ...adminOnly,
    rateLimit({ windowMs: 60_000, limit: 60 }),
    wrap(async (req, res) => {
      const key = idemKey.parse(req.get("Idempotency-Key"));
      const body = voucherBody.parse(req.body);
      noFuture(body.date);
      const { voucher, replay } = await store().createVoucher({
        tenantId: tenant(req),
        fy: getFinancialYear(new Date()),
        input: body,
        idempotencyKey: key,
        user: req.user,
        audit: audit(req, (v) => ({
          action: "create",
          entity: "expense_voucher",
          entityId: String(v._id),
          newValue: {
            number: v.number,
            amountPaise: v.amountPaise,
            payeeName: v.payeeName,
          },
        })),
      });
      res.status(replay ? 200 : 201).json({ ...shapeVoucher(voucher), replay });
    }),
  );
  router.post(
    "/vouchers/:id/approve",
    ...principalOnly,
    wrap(async (req, res) => {
      const id = objectId.parse(req.params.id);
      const v = await store().decideVoucher({
        tenantId: tenant(req),
        id,
        decision: "approve",
        user: req.user,
        audit: audit(req, (x) => ({
          action: "approve",
          entity: "expense_voucher",
          entityId: String(x._id),
          newValue: { number: x.number, amountPaise: x.amountPaise },
        })),
      });
      if (!v)
        throw new AppError(
          "NOT_PENDING",
          409,
          "This voucher is not waiting for a decision.",
        );
      res.json(shapeVoucher(v));
    }),
  );
  router.post(
    "/vouchers/:id/reject",
    ...principalOnly,
    wrap(async (req, res) => {
      const id = objectId.parse(req.params.id);
      const { reason } = reasonBody.parse(req.body);
      const v = await store().decideVoucher({
        tenantId: tenant(req),
        id,
        decision: "reject",
        reason,
        user: req.user,
        audit: audit(req, (x) => ({
          action: "reject",
          entity: "expense_voucher",
          entityId: String(x._id),
          reason,
        })),
      });
      if (!v)
        throw new AppError(
          "NOT_PENDING",
          409,
          "This voucher is not waiting for a decision.",
        );
      res.json(shapeVoucher(v));
    }),
  );
  router.post(
    "/vouchers/:id/adjustments",
    ...adminOnly,
    wrap(async (req, res) => {
      const input = adjustmentBody.parse(req.body);
      const v = notFoundIfNull(
        await store().addAdjustment({
          tenantId: tenant(req),
          id: objectId.parse(req.params.id),
          input,
          user: req.user,
          audit: audit(req, (x) => ({
            action: "update",
            entity: "expense_voucher",
            entityId: String(x._id),
            newValue: { adjustmentPaise: input.amountPaise },
            reason: `${input.reason} | ${input.remark}`,
          })),
        }),
        "Voucher",
      );
      res.status(201).json({ id: String(v._id) });
    }),
  );
  router.post(
    "/vouchers/:id/payments",
    ...adminOnly,
    rateLimit({ windowMs: 60_000, limit: 60 }),
    wrap(async (req, res) => {
      const key = idemKey.parse(req.get("Idempotency-Key"));
      const input = paymentBody.parse(req.body);
      noFuture(input.date);
      const out = notFoundIfNull(
        await store().createPayment({
          tenantId: tenant(req),
          fy: getFinancialYear(new Date()),
          voucherId: objectId.parse(req.params.id),
          input,
          idempotencyKey: key,
          user: req.user,
          audit: audit(req, (p) => ({
            action: "create",
            entity: "expense_payment",
            entityId: String(p._id),
            newValue: {
              voucherNumber: p.voucherNumber,
              amountPaise: p.amountPaise,
              mode: p.mode,
              authorisedBy: p.authorisedBy,
            },
          })),
        }),
        "Voucher",
      );
      res
        .status(out.replay ? 200 : 201)
        .json({ ...shapePayment(out.payment), replay: out.replay });
    }),
  );
  router.get(
    "/expense-payments",
    ...adminOrPrincipal,
    wrap(async (req, res) => {
      const f = z
        .object({ ...pageQuery, ...rangeQuery, q: text(60).optional() })
        .parse(req.query);
      const out = await store().listPayments({ tenantId: tenant(req), ...f });
      res.json({
        rows: out.rows.map(shapePayment),
        total: out.total,
        page: f.page,
        pageSize: f.pageSize,
      });
    }),
  );

  // ----- reversals: Admin asks (reason compulsory), Principal decides -----
  router.get(
    "/expense-reversals",
    ...adminOrPrincipal,
    wrap(async (req, res) => {
      const { status } = z
        .object({
          status: z.enum(["requested", "approved", "rejected"]).optional(),
        })
        .parse(req.query);
      const rows = await store().listReversals({
        tenantId: tenant(req),
        status,
      });
      res.json({ rows: rows.map(shapeReversal) });
    }),
  );
  router.post(
    "/expense-reversals",
    ...adminOnly,
    wrap(async (req, res) => {
      const body = z
        .object({
          kind: z.enum(["payment", "voucher"]),
          targetId: objectId,
          reason: text(300),
        })
        .parse(req.body);
      const row = notFoundIfNull(
        await store().requestReversal({
          tenantId: tenant(req),
          ...body,
          user: req.user,
          audit: audit(req, (r) => ({
            action: "create",
            entity: "expense_reversal",
            entityId: String(r._id),
            newValue: {
              kind: r.kind,
              voucherNumber: r.voucherNumber,
              amountPaise: r.amountPaise,
            },
            reason: body.reason,
          })),
        }),
        "Entry",
      );
      res.status(201).json(shapeReversal(row));
    }),
  );
  for (const decision of ["approve", "reject"]) {
    router.post(
      `/expense-reversals/:id/${decision}`,
      ...principalOnly,
      wrap(async (req, res) => {
        const { reason } =
          decision === "reject"
            ? reasonBody.parse(req.body)
            : { reason: undefined };
        const row = await store().decideReversal({
          tenantId: tenant(req),
          id: objectId.parse(req.params.id),
          decision,
          note: reason,
          user: req.user,
          audit: audit(req, (r) => ({
            action: decision,
            entity: "expense_reversal",
            entityId: String(r._id),
            reason,
          })),
        });
        if (!row)
          throw new AppError(
            "NOT_PENDING",
            409,
            "This request is not waiting for a decision.",
          );
        res.json(shapeReversal(row));
      }),
    );
  }

  // ----- petty cash -----
  router.get(
    "/petty/summary",
    ...anyRole,
    wrap(async (req, res) => {
      const s = await store().pettySummary(tenant(req));
      res.json({ balancePaise: s.balancePaise, last: s.last.map(shapePetty) });
    }),
  );
  router.get(
    "/petty",
    ...adminOrPrincipal,
    wrap(async (req, res) => {
      const f = z.object({ ...pageQuery, ...rangeQuery }).parse(req.query);
      const out = await store().listPetty({ tenantId: tenant(req), ...f });
      res.json({
        rows: out.rows.map(shapePetty),
        total: out.total,
        page: f.page,
        pageSize: f.pageSize,
      });
    }),
  );
  router.post(
    "/petty",
    ...adminOnly,
    rateLimit({ windowMs: 60_000, limit: 60 }),
    wrap(async (req, res) => {
      const key = idemKey.parse(req.get("Idempotency-Key"));
      const body = pettyBody.parse(req.body);
      noFuture(body.date);
      const { entry, replay } = await store().createPetty({
        tenantId: tenant(req),
        fy: getFinancialYear(new Date()),
        input: body,
        idempotencyKey: key,
        user: req.user,
        audit: audit(req, (e) => ({
          action: "create",
          entity: "petty_entry",
          entityId: String(e._id),
          newValue: {
            seq: e.seq,
            amountPaise: e.amountPaise,
            payeeName: e.payeeName,
          },
        })),
      });
      res.status(replay ? 200 : 201).json({ ...shapePetty(entry), replay });
    }),
  );
  router.post(
    "/petty/:id/reverse",
    ...adminOnly,
    wrap(async (req, res) => {
      const { reason } = reasonBody.parse(req.body);
      const e = await store().reversePetty({
        tenantId: tenant(req),
        id: objectId.parse(req.params.id),
        reason,
        user: req.user,
        audit: audit(req, (x) => ({
          action: "cancel",
          entity: "petty_entry",
          entityId: String(x._id),
          reason,
        })),
      });
      if (!e)
        throw new AppError(
          "NOT_FOUND",
          404,
          "Entry not found or already reversed.",
        );
      res.json(shapePetty(e));
    }),
  );

  // ----- transfers (cash <-> bank, bank <-> bank, cash -> petty top-up) -----
  router.get(
    "/transfers",
    ...adminOrPrincipal,
    wrap(async (req, res) => {
      const f = z.object(pageQuery).parse(req.query);
      const out = await store().listTransfers({ tenantId: tenant(req), ...f });
      res.json({ ...out, page: f.page, pageSize: f.pageSize });
    }),
  );
  router.post(
    "/transfers",
    ...adminOnly,
    rateLimit({ windowMs: 60_000, limit: 60 }),
    wrap(async (req, res) => {
      const key = idemKey.parse(req.get("Idempotency-Key"));
      const body = z
        .object({
          from: accountKey,
          to: accountKey,
          amountPaise: paise,
          note: text(200).optional(),
        })
        .parse(req.body);
      const out = await store().createTransfer({
        tenantId: tenant(req),
        ...body,
        idempotencyKey: key,
        user: req.user,
        audit: audit(req, () => ({
          action: "create",
          entity: "transfer",
          entityId: key,
          newValue: body,
        })),
      });
      res
        .status(out.replay ? 200 : 201)
        .json({ transferId: out.transferId, replay: out.replay });
    }),
  );

  // ----- Cashier PIN -----
  router.get(
    "/cashier-pin",
    ...adminOnly,
    wrap(async (req, res) => {
      res.json(await store().pinStatus(tenant(req)));
    }),
  );
  router.put(
    "/cashier-pin",
    ...adminOnly,
    wrap(async (req, res) => {
      const { pin } = z.object({ pin: z.string() }).parse(req.body);
      if (!isValidPin(pin))
        throw new AppError(
          "BAD_PIN",
          422,
          "The PIN must be exactly 4 digits.",
          {
            pin: "Use 4 digits",
          },
        );
      await store().setPin({
        tenantId: tenant(req),
        pin,
        user: req.user,
        // WHY the PIN itself is never audited: the log must not hold a secret.
        audit: () =>
          recordAudit(
            deps,
            req,
            {
              action: "update",
              entity: "cashier_pin",
              newValue: { reset: true },
            },
            { critical: true },
          ),
      });
      res.json({ ok: true });
    }),
  );
  // All balances for the Cashier, only with the correct PIN. Strict rate limit on top of the lockout.
  router.post(
    "/money/cashier-view",
    rateLimit({
      windowMs: 60_000,
      limit: 20,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
    authenticate,
    requireRole("cashier"),
    wrap(async (req, res) => {
      const { pin } = z.object({ pin: z.string() }).parse(req.body);
      if (!isValidPin(pin))
        throw new AppError(
          "BAD_PIN",
          422,
          "The PIN must be exactly 4 digits.",
          {
            pin: "Use 4 digits",
          },
        );
      const r = await store().verifyPin({ tenantId: tenant(req), pin });
      if (!r.ok) {
        if (r.reason === "NOT_SET")
          throw new AppError(
            "PIN_NOT_SET",
            409,
            "The PIN is not set yet. Ask the Admin to set it.",
          );
        if (r.reason === "LOCKED") {
          await recordAudit(deps, req, {
            action: "login_blocked",
            entity: "cashier_pin",
            reason: "PIN locked after wrong attempts",
          });
          throw new AppError(
            "PIN_LOCKED",
            423,
            "The PIN is locked. Ask the Admin to set a new PIN.",
          );
        }
        // WHY 422 and not 401: the web client treats every 401 as an expired session and signs out.
        throw new AppError(
          "PIN_WRONG",
          422,
          `Wrong PIN. ${r.attemptsLeft} tries left.`,
          {
            pin: "Wrong PIN",
          },
        );
      }
      res.json(await store().overview(tenant(req)));
    }),
  );
  return router;
}
