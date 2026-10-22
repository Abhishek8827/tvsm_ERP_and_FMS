import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  ExpenseRuleError,
  PIN_MAX_ATTEMPTS,
  accountKey,
  balancesFrom,
  checkAdjustment,
  checkPayment,
  checkPettyEntry,
  checkReason,
  checkTransfer,
  checkVoucherInput,
  todayIst,
  voucherFigures,
  voucherNumber,
} from '@erp/shared';
import { BankAccount } from '../models/BankAccount.js';
import { CashierPin } from '../models/CashierPin.js';
import { Counter } from '../models/Counter.js';
import { ExpenseHead } from '../models/ExpenseHead.js';
import { ExpensePayment } from '../models/ExpensePayment.js';
import { ExpenseReversal } from '../models/ExpenseReversal.js';
import { ExpenseVoucher } from '../models/ExpenseVoucher.js';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { PettyEntry } from '../models/PettyEntry.js';
import { Receipt } from '../models/Receipt.js';
import { ReceiptCancellation } from '../models/ReceiptCancellation.js';

const isDuplicateKey = (err) => err?.code === 11000;
const isRetryable = (err) =>
  isDuplicateKey(err) || err?.hasErrorLabel?.('TransientTransactionError');
const fail = (code, message, field) => {
  throw new ExpenseRuleError(code, message, field);
};
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byUser = (user) => ({ createdBy: String(user.id), createdByName: user.name });

/**
 * Runs `fn(session)` in ONE transaction, after taking the money lock. WHY a lock: balances are
 * calculated from the ledger, so two payments at the same moment could both see "enough money".
 * Bumping one counter document makes such transactions queue up (the loser retries).
 */
async function runTxn(tenantId, fn) {
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        await Counter.updateOne(
          { tenantId, key: 'lock:money' },
          { $inc: { seq: 1 } },
          { upsert: true, session },
        );
        result = await fn(session);
      });
      return result;
    } catch (err) {
      last = err;
      if (!isRetryable(err)) throw err;
    } finally {
      await session.endSession();
    }
  }
  throw last;
}

async function nextSeq(tenantId, key, session) {
  const c = await Counter.findOneAndUpdate(
    { tenantId, key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  ).lean();
  return c.seq;
}

/** Fee receipts that still count, summed per account (cash, or the bank chosen for UPI/QR). */
async function receiptTotals(tenantId, session) {
  const gone = await ReceiptCancellation.find({ tenantId, status: 'cancelled' })
    .select('receiptId')
    .session(session)
    .lean();
  const rows = await Receipt.aggregate([
    { $match: { tenantId, _id: { $nin: gone.map((g) => g.receiptId) } } },
    { $group: { _id: { mode: '$mode', bankId: '$bankId' }, paise: { $sum: '$totalPaise' } } },
  ]).session(session);
  const totals = {};
  let unassignedPaise = 0;
  for (const r of rows) {
    if (r._id.mode === 'cash') totals.cash = (totals.cash ?? 0) + r.paise;
    else if (r._id.bankId) {
      const key = `bank:${r._id.bankId}`;
      totals[key] = (totals[key] ?? 0) + r.paise;
    } else unassignedPaise += r.paise; // UPI/QR with no bank chosen (old receipts)
  }
  return { totals, unassignedPaise };
}

async function computeBalances(tenantId, session = null) {
  const entries = await LedgerEntry.aggregate([
    { $match: { tenantId } },
    { $group: { _id: '$account', amountPaise: { $sum: '$amountPaise' } } },
  ]).session(session);
  const { totals, unassignedPaise } = await receiptTotals(tenantId, session);
  return {
    balances: balancesFrom({
      entries: entries.map((e) => ({ account: e._id, amountPaise: e.amountPaise })),
      receiptTotals: totals,
    }),
    unassignedPaise,
  };
}

const ledger = (tenantId, user, rows) =>
  rows.map((r) => ({
    tenantId,
    entryDate: todayIst(),
    createdBy: String(user.id),
    createdByName: user.name,
    ...r,
  }));

const pageOf = (page, pageSize) => ({ skip: (page - 1) * pageSize, limit: pageSize });
const dateRange = (field, from, to) =>
  from || to ? { [field]: { ...(from && { $gte: from }), ...(to && { $lte: to }) } } : {};

export function makeMoneyStore() {
  return {
    computeBalances,

    // ---------- bank accounts ----------
    listBanks: (tenantId, { onlyActive = false } = {}) =>
      BankAccount.find({ tenantId, ...(onlyActive && { active: true }) })
        .sort({ nameLower: 1 })
        .lean(),
    findActiveBank: (tenantId, id) =>
      BankAccount.findOne({ tenantId, _id: id, active: true }).lean(),
    async createBank({ tenantId, input, user, audit }) {
      const session = await mongoose.startSession();
      try {
        let saved;
        await session.withTransaction(async () => {
          const [bank] = await BankAccount.create(
            [
              {
                tenantId,
                name: input.name.trim(),
                nameLower: input.name.trim().toLowerCase(),
                last4: input.last4,
                defaultForModes: input.defaultForModes ?? [],
                createdBy: String(user.id),
              },
            ],
            { session },
          );
          if (input.openingPaise > 0)
            await LedgerEntry.create(
              ledger(tenantId, user, [
                {
                  account: `bank:${bank._id}`,
                  amountPaise: input.openingPaise,
                  type: 'opening',
                  refId: String(bank._id),
                  note: 'Opening balance',
                },
              ]),
              { session, ordered: true },
            );
          saved = bank.toObject();
          if (audit) await audit(saved, session);
        });
        return saved;
      } catch (err) {
        if (isDuplicateKey(err))
          fail('BANK_EXISTS', 'A bank account with this name already exists.', 'name');
        throw err;
      } finally {
        await session.endSession();
      }
    },
    async updateBank({ tenantId, id, patch, audit }) {
      const set = {};
      if (patch.name !== undefined) {
        set.name = patch.name.trim();
        set.nameLower = patch.name.trim().toLowerCase();
      }
      if (patch.active !== undefined) set.active = patch.active;
      if (patch.defaultForModes !== undefined) set.defaultForModes = patch.defaultForModes;
      try {
        const saved = await BankAccount.findOneAndUpdate(
          { tenantId, _id: id },
          { $set: set },
          { returnDocument: 'after' },
        ).lean();
        if (saved && audit) await audit(saved);
        return saved;
      } catch (err) {
        if (isDuplicateKey(err))
          fail('BANK_EXISTS', 'A bank account with this name already exists.', 'name');
        throw err;
      }
    },
    /** Opening cash / petty cash balance, once. Later corrections are normal entries. */
    async setOpening({ tenantId, account, amountPaise, user, audit }) {
      try {
        const [row] = await LedgerEntry.create(
          ledger(tenantId, user, [
            { account, amountPaise, type: 'opening', note: 'Opening balance' },
          ]),
        );
        if (audit) await audit(row.toObject());
        return row.toObject();
      } catch (err) {
        if (isDuplicateKey(err)) fail('OPENING_EXISTS', 'The opening balance is already set.');
        throw err;
      }
    },

    /**
     * Admin edits an opening balance. WHY an entry and not an edit: the ledger is insert-only,
     * so the correction is a signed `opening_change` for the difference, with the reason. The
     * history (old opening + every change) stays visible and the balance moves by the delta.
     */
    async changeOpening({ tenantId, account, amountPaise, reason, user, audit }) {
      return runTxn(tenantId, async (session) => {
        if (account.startsWith('bank:')) {
          const bank = await BankAccount.findOne({ tenantId, _id: account.slice(5) })
            .session(session)
            .lean();
          if (!bank) fail('BANK_NOT_FOUND', 'Bank account not found.', 'account');
        }
        const rows = await LedgerEntry.find({
          tenantId,
          account,
          type: { $in: ['opening', 'opening_change'] },
        })
          .session(session)
          .lean();
        const current = rows.reduce((n, r) => n + r.amountPaise, 0);
        const delta = amountPaise - current;
        if (delta === 0) fail('NO_CHANGE', 'This is already the opening balance.', 'amountPaise');
        const { balances } = await computeBalances(tenantId, session);
        if ((balances[account] ?? 0) + delta < 0)
          fail(
            'WOULD_GO_NEGATIVE',
            'Money already spent from this account is more than this opening balance.',
            'amountPaise',
          );
        const [row] = await LedgerEntry.create(
          ledger(tenantId, user, [
            {
              account,
              amountPaise: delta,
              type: rows.length ? 'opening_change' : 'opening',
              note: `Opening changed from ${current} to ${amountPaise} paise: ${reason}`,
            },
          ]),
          { session, ordered: true },
        );
        const result = { account, fromPaise: current, toPaise: amountPaise, reason };
        if (audit) await audit({ ...result, _id: row._id }, session);
        return result;
      });
    },

    // ---------- balances ----------
    async overview(tenantId) {
      const [{ balances, unassignedPaise }, banks, openRows] = await Promise.all([
        computeBalances(tenantId),
        BankAccount.find({ tenantId }).sort({ nameLower: 1 }).lean(),
        LedgerEntry.aggregate([
          { $match: { tenantId, type: { $in: ['opening', 'opening_change'] } } },
          { $group: { _id: '$account', amountPaise: { $sum: '$amountPaise' } } },
        ]),
      ]);
      const openings = Object.fromEntries(openRows.map((r) => [r._id, r.amountPaise]));
      return {
        openingCashPaise: openings.cash ?? 0,
        openingPettyPaise: openings.petty ?? 0,
        cashPaise: balances.cash ?? 0,
        pettyPaise: balances.petty ?? 0,
        banks: banks.map((b) => ({
          id: String(b._id),
          name: b.name,
          last4: b.last4 ?? null,
          active: b.active,
          defaultForModes: b.defaultForModes,
          openingPaise: openings[`bank:${b._id}`] ?? 0,
          balancePaise: balances[`bank:${b._id}`] ?? 0,
        })),
        unassignedReceiptsPaise: unassignedPaise,
      };
    },

    // ---------- expense heads ----------
    listHeads: (tenantId, { onlyActive = false } = {}) =>
      ExpenseHead.find({ tenantId, ...(onlyActive && { active: true }) })
        .sort({ nameLower: 1 })
        .lean(),
    async createHead({ tenantId, name, user, audit }) {
      try {
        const head = await ExpenseHead.create({
          tenantId,
          name: name.trim(),
          nameLower: name.trim().toLowerCase(),
          createdBy: String(user.id),
        });
        if (audit) await audit(head.toObject());
        return head.toObject();
      } catch (err) {
        if (isDuplicateKey(err)) fail('HEAD_EXISTS', 'This expense head already exists.', 'name');
        throw err;
      }
    },
    async updateHead({ tenantId, id, patch, audit }) {
      const set = {};
      if (patch.name !== undefined) {
        set.name = patch.name.trim();
        set.nameLower = patch.name.trim().toLowerCase();
      }
      if (patch.active !== undefined) set.active = patch.active;
      try {
        const saved = await ExpenseHead.findOneAndUpdate(
          { tenantId, _id: id },
          { $set: set },
          { returnDocument: 'after' },
        ).lean();
        if (saved && audit) await audit(saved);
        return saved;
      } catch (err) {
        if (isDuplicateKey(err)) fail('HEAD_EXISTS', 'This expense head already exists.', 'name');
        throw err;
      }
    },

    // ---------- vouchers ----------
    async createVoucher({ tenantId, fy, input, idempotencyKey, user, audit }) {
      return runTxn(tenantId, async (session) => {
        const existing = await ExpenseVoucher.findOne({ tenantId, idempotencyKey })
          .session(session)
          .lean();
        if (existing) return { voucher: existing, replay: true };
        checkVoucherInput(input);
        const head = await ExpenseHead.findOne({ tenantId, _id: input.headId, active: true })
          .session(session)
          .lean();
        if (!head) fail('HEAD_NOT_FOUND', 'Choose an active expense head.', 'headId');
        const seq = await nextSeq(tenantId, `voucher:${fy}`, session);
        const [created] = await ExpenseVoucher.create(
          [
            {
              tenantId,
              fy,
              seq,
              number: voucherNumber(fy, seq),
              date: input.date,
              headId: head._id,
              headName: head.name,
              payeeName: input.payeeName.trim(),
              particulars: input.particulars.trim(),
              amountPaise: input.amountPaise,
              status: 'pending',
              idempotencyKey,
              ...byUser(user),
            },
          ],
          { session },
        );
        const voucher = created.toObject();
        if (audit) await audit(voucher, session);
        return { voucher, replay: false };
      });
    },
    /** Principal decision. Only a pending voucher can be decided, and only once. */
    async decideVoucher({ tenantId, id, decision, reason, user, audit }) {
      if (decision === 'reject') checkReason(reason, 'Write the reason for rejecting.');
      return runTxn(tenantId, async (session) => {
        const voucher = await ExpenseVoucher.findOneAndUpdate(
          { tenantId, _id: id, status: 'pending' },
          {
            $set: {
              status: decision === 'approve' ? 'approved' : 'rejected',
              decidedBy: String(user.id),
              decidedByName: user.name,
              decidedAt: new Date(),
              ...(decision === 'reject' && { rejectionReason: reason.trim() }),
            },
          },
          { returnDocument: 'after', session },
        ).lean();
        if (!voucher) return null;
        if (audit) await audit(voucher, session);
        return voucher;
      });
    },
    async addAdjustment({ tenantId, id, input, user, audit }) {
      return runTxn(tenantId, async (session) => {
        const voucher = await ExpenseVoucher.findOne({ tenantId, _id: id }).session(session).lean();
        if (!voucher) return null;
        const payments = await ExpensePayment.find({ tenantId, voucherId: id })
          .session(session)
          .lean();
        checkAdjustment({ voucher, payments, input });
        const saved = await ExpenseVoucher.findOneAndUpdate(
          { tenantId, _id: id },
          {
            $push: {
              adjustments: {
                amountPaise: input.amountPaise,
                reason: input.reason.trim(),
                remark: input.remark.trim(),
                by: String(user.id),
                byName: user.name,
                at: new Date(),
              },
            },
          },
          { returnDocument: 'after', session },
        ).lean();
        if (audit) await audit(saved, session);
        return saved;
      });
    },
    async listVouchers({ tenantId, status, q, from, to, page, pageSize }) {
      const match = { tenantId, ...dateRange('date', from, to) };
      if (status) match.status = status;
      if (q?.trim()) {
        const rx = { $regex: escapeRegex(q.trim()), $options: 'i' };
        match.$or = [{ number: rx }, { payeeName: rx }, { headName: rx }, { particulars: rx }];
      }
      const [rows, total, sums] = await Promise.all([
        ExpenseVoucher.find(match)
          .sort({ date: -1, seq: -1 })
          .skip(pageOf(page, pageSize).skip)
          .limit(pageSize)
          .lean(),
        ExpenseVoucher.countDocuments(match),
        ExpenseVoucher.aggregate([
          { $match: { ...match, status: { $in: ['pending', 'approved'] } } },
          { $group: { _id: '$status', paise: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
        ]),
      ]);
      const paidRows = await ExpensePayment.aggregate([
        { $match: { tenantId, voucherId: { $in: rows.map((r) => r._id) }, status: 'active' } },
        { $group: { _id: '$voucherId', paise: { $sum: '$amountPaise' } } },
      ]);
      const paid = new Map(paidRows.map((p) => [String(p._id), p.paise]));
      return {
        rows: rows.map((v) => {
          const f = voucherFigures({
            voucher: v,
            payments: [{ amountPaise: paid.get(String(v._id)) ?? 0 }],
          });
          return { ...v, ...f };
        }),
        total,
        totals: Object.fromEntries(sums.map((s) => [s._id, { paise: s.paise, count: s.count }])),
      };
    },
    async getVoucher(tenantId, id) {
      const voucher = await ExpenseVoucher.findOne({ tenantId, _id: id }).lean();
      if (!voucher) return null;
      const [payments, reversals] = await Promise.all([
        ExpensePayment.find({ tenantId, voucherId: id }).sort({ seq: 1 }).lean(),
        ExpenseReversal.find({ tenantId, voucherId: id }).sort({ createdAt: -1 }).lean(),
      ]);
      return { ...voucher, ...voucherFigures({ voucher, payments }), payments, reversals };
    },

    // ---------- payments ----------
    async createPayment({ tenantId, fy, voucherId, input, idempotencyKey, user, audit }) {
      return runTxn(tenantId, async (session) => {
        const existing = await ExpensePayment.findOne({ tenantId, idempotencyKey })
          .session(session)
          .lean();
        if (existing) return { payment: existing, replay: true };
        const voucher = await ExpenseVoucher.findOne({ tenantId, _id: voucherId })
          .session(session)
          .lean();
        if (!voucher) return null;
        const payments = await ExpensePayment.find({ tenantId, voucherId }).session(session).lean();
        const { balances } = await computeBalances(tenantId, session);
        const { account } = checkPayment({ voucher, payments, input, balances });
        let bank = null;
        if (input.mode === 'bank') {
          bank = await BankAccount.findOne({ tenantId, _id: input.bankId, active: true })
            .session(session)
            .lean();
          if (!bank) fail('BANK_NOT_FOUND', 'Choose an active bank account.', 'bankId');
        }
        const seq = await nextSeq(tenantId, `exppay:${fy}`, session);
        const [created] = await ExpensePayment.create(
          [
            {
              tenantId,
              fy,
              seq,
              voucherId,
              voucherNumber: voucher.number,
              date: input.date,
              headName: voucher.headName,
              payeeName: voucher.payeeName,
              details: (input.details ?? '').trim(),
              mode: input.mode,
              bankId: bank ? String(bank._id) : undefined,
              bankName: bank?.name,
              amountPaise: input.amountPaise,
              authorisedBy: input.authorisedBy,
              approvedByName: voucher.decidedByName,
              remark: (input.remark ?? '').trim(),
              idempotencyKey,
              ...byUser(user),
            },
          ],
          { session },
        );
        const payment = created.toObject();
        await LedgerEntry.create(
          ledger(tenantId, user, [
            {
              account,
              amountPaise: -input.amountPaise,
              type: 'expense_payment',
              refId: String(payment._id),
              note: voucher.number,
            },
          ]),
          { session, ordered: true },
        );
        if (audit) await audit(payment, session);
        return { payment, replay: false };
      });
    },
    async listPayments({ tenantId, q, from, to, page, pageSize }) {
      const match = { tenantId, ...dateRange('date', from, to) };
      if (q?.trim()) {
        const rx = { $regex: escapeRegex(q.trim()), $options: 'i' };
        match.$or = [{ voucherNumber: rx }, { payeeName: rx }, { headName: rx }, { details: rx }];
      }
      const [rows, total] = await Promise.all([
        ExpensePayment.find(match)
          .sort({ date: -1, seq: -1 })
          .skip(pageOf(page, pageSize).skip)
          .limit(pageSize)
          .lean(),
        ExpensePayment.countDocuments(match),
      ]);
      return { rows, total };
    },

    // ---------- reversals (Admin asks, Principal decides) ----------
    async requestReversal({ tenantId, kind, targetId, reason, user, audit }) {
      checkReason(reason, 'Write the reason for the reversal.');
      return runTxn(tenantId, async (session) => {
        let voucherId;
        let voucherNumberText;
        let amountPaise;
        if (kind === 'payment') {
          const p = await ExpensePayment.findOne({ tenantId, _id: targetId })
            .session(session)
            .lean();
          if (!p) return null;
          if (p.status !== 'active') fail('ALREADY_REVERSED', 'This payment is already reversed.');
          voucherId = p.voucherId;
          voucherNumberText = p.voucherNumber;
          amountPaise = p.amountPaise;
        } else {
          const v = await ExpenseVoucher.findOne({ tenantId, _id: targetId })
            .session(session)
            .lean();
          if (!v) return null;
          const active = await ExpensePayment.countDocuments({
            tenantId,
            voucherId: targetId,
            status: 'active',
          }).session(session);
          if (v.status !== 'approved' || active > 0 || v.adjustments.length > 0)
            fail(
              'NOT_CANCELLABLE',
              'Only an approved voucher with no payments and no adjustments can be cancelled. Reverse its payments first.',
            );
          voucherId = v._id;
          voucherNumberText = v.number;
          amountPaise = v.amountPaise;
        }
        const open = await ExpenseReversal.findOne({
          tenantId,
          kind,
          targetId,
          status: { $in: ['requested', 'approved'] },
        })
          .session(session)
          .lean();
        if (open) fail('ALREADY_REQUESTED', 'A reversal request already exists for this entry.');
        const [created] = await ExpenseReversal.create(
          [
            {
              tenantId,
              kind,
              targetId,
              voucherId,
              voucherNumber: voucherNumberText,
              amountPaise,
              status: 'requested',
              reason: reason.trim(),
              requestedBy: String(user.id),
              requestedByName: user.name,
            },
          ],
          { session },
        );
        const row = created.toObject();
        if (audit) await audit(row, session);
        return row;
      });
    },
    async decideReversal({ tenantId, id, decision, note, user, audit }) {
      if (decision === 'reject') checkReason(note, 'Write the reason for rejecting.');
      return runTxn(tenantId, async (session) => {
        const req = await ExpenseReversal.findOne({ tenantId, _id: id, status: 'requested' })
          .session(session)
          .lean();
        if (!req) return null;
        if (decision === 'approve') {
          if (req.kind === 'payment') {
            const p = await ExpensePayment.findOneAndUpdate(
              { tenantId, _id: req.targetId, status: 'active' },
              { $set: { status: 'reversed' } },
              { returnDocument: 'after', session },
            ).lean();
            if (!p) fail('ALREADY_REVERSED', 'This payment is already reversed.');
            await LedgerEntry.create(
              ledger(tenantId, user, [
                {
                  account: p.mode === 'bank' ? `bank:${p.bankId}` : 'cash',
                  amountPaise: p.amountPaise,
                  type: 'payment_reversal',
                  refId: String(p._id),
                  note: `Reversal of ${p.voucherNumber}`,
                },
              ]),
              { session, ordered: true },
            );
          } else {
            const active = await ExpensePayment.countDocuments({
              tenantId,
              voucherId: req.voucherId,
              status: 'active',
            }).session(session);
            if (active > 0)
              fail('NOT_CANCELLABLE', 'The voucher has payments again. Reverse them first.');
            const v = await ExpenseVoucher.findOneAndUpdate(
              { tenantId, _id: req.targetId, status: 'approved' },
              { $set: { status: 'cancelled' } },
              { session },
            );
            if (!v) fail('NOT_CANCELLABLE', 'The voucher can no longer be cancelled.');
          }
        }
        const saved = await ExpenseReversal.findOneAndUpdate(
          { tenantId, _id: id },
          {
            $set: {
              status: decision === 'approve' ? 'approved' : 'rejected',
              decidedBy: String(user.id),
              decidedByName: user.name,
              decidedAt: new Date(),
              ...(note && { decisionNote: note.trim() }),
            },
          },
          { returnDocument: 'after', session },
        ).lean();
        if (audit) await audit(saved, session);
        return saved;
      });
    },
    async listReversals({ tenantId, status }) {
      return ExpenseReversal.find({ tenantId, ...(status && { status }) })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
    },
    async pendingCounts(tenantId) {
      const [vouchers, reversals] = await Promise.all([
        ExpenseVoucher.countDocuments({ tenantId, status: 'pending' }),
        ExpenseReversal.countDocuments({ tenantId, status: 'requested' }),
      ]);
      return { vouchers, reversals };
    },

    // ---------- petty cash ----------
    async createPetty({ tenantId, fy, input, idempotencyKey, user, audit }) {
      return runTxn(tenantId, async (session) => {
        const existing = await PettyEntry.findOne({ tenantId, idempotencyKey })
          .session(session)
          .lean();
        if (existing) return { entry: existing, replay: true };
        const { balances } = await computeBalances(tenantId, session);
        checkPettyEntry({ ...input, pettyBalance: balances.petty ?? 0 });
        let head = null;
        if (input.headId) {
          head = await ExpenseHead.findOne({ tenantId, _id: input.headId, active: true })
            .session(session)
            .lean();
          if (!head) fail('HEAD_NOT_FOUND', 'Choose an active expense head.', 'headId');
        }
        const seq = await nextSeq(tenantId, `petty:${fy}`, session);
        const [created] = await PettyEntry.create(
          [
            {
              tenantId,
              fy,
              seq,
              date: input.date,
              headId: head?._id,
              headName: head?.name,
              payeeName: input.payeeName.trim(),
              particulars: input.particulars.trim(),
              amountPaise: input.amountPaise,
              idempotencyKey,
              ...byUser(user),
            },
          ],
          { session },
        );
        const entry = created.toObject();
        await LedgerEntry.create(
          ledger(tenantId, user, [
            {
              account: 'petty',
              amountPaise: -input.amountPaise,
              type: 'petty_entry',
              refId: String(entry._id),
              note: `Petty #${seq}`,
            },
          ]),
          { session, ordered: true },
        );
        if (audit) await audit(entry, session);
        return { entry, replay: false };
      });
    },
    async reversePetty({ tenantId, id, reason, user, audit }) {
      checkReason(reason, 'Write the reason for the reversal.');
      return runTxn(tenantId, async (session) => {
        const e = await PettyEntry.findOneAndUpdate(
          { tenantId, _id: id, status: 'active' },
          {
            $set: {
              status: 'reversed',
              reversalReason: reason.trim(),
              reversedBy: String(user.id),
              reversedByName: user.name,
              reversedAt: new Date(),
            },
          },
          { returnDocument: 'after', session },
        ).lean();
        if (!e) return null;
        await LedgerEntry.create(
          ledger(tenantId, user, [
            {
              account: 'petty',
              amountPaise: e.amountPaise,
              type: 'petty_reversal',
              refId: String(e._id),
              note: `Reversal of petty #${e.seq}`,
            },
          ]),
          { session, ordered: true },
        );
        if (audit) await audit(e, session);
        return e;
      });
    },
    async listPetty({ tenantId, from, to, page, pageSize }) {
      const match = { tenantId, ...dateRange('date', from, to) };
      const [rows, total] = await Promise.all([
        PettyEntry.find(match)
          .sort({ fy: -1, seq: -1 })
          .skip(pageOf(page, pageSize).skip)
          .limit(pageSize)
          .lean(),
        PettyEntry.countDocuments(match),
      ]);
      return { rows, total };
    },
    /** What the Cashier may see: the balance and the last 5 entries, nothing more. */
    async pettySummary(tenantId) {
      const [{ balances }, last] = await Promise.all([
        computeBalances(tenantId),
        PettyEntry.find({ tenantId }).sort({ createdAt: -1 }).limit(5).lean(),
      ]);
      return { balancePaise: balances.petty ?? 0, last };
    },

    // ---------- transfers (cash <-> bank, bank <-> bank, cash -> petty) ----------
    async createTransfer({ tenantId, from, to, amountPaise, note, idempotencyKey, user, audit }) {
      return runTxn(tenantId, async (session) => {
        const done = await LedgerEntry.find({ tenantId, transferId: idempotencyKey })
          .session(session)
          .lean();
        if (done.length) return { transferId: idempotencyKey, replay: true };
        for (const key of [from, to]) {
          if (key.startsWith('bank:')) {
            const bank = await BankAccount.findOne({ tenantId, _id: key.slice(5), active: true })
              .session(session)
              .lean();
            if (!bank) fail('BANK_NOT_FOUND', 'Choose active bank accounts.', 'from');
          } else if (key !== 'cash' && key !== 'petty')
            fail('BAD_ACCOUNT', 'Unknown account.', 'from');
        }
        const { balances } = await computeBalances(tenantId, session);
        checkTransfer({ from, to, amountPaise, balances });
        await LedgerEntry.create(
          ledger(tenantId, user, [
            {
              account: from,
              amountPaise: -amountPaise,
              type: 'transfer',
              transferId: idempotencyKey,
              refId: idempotencyKey,
              note,
            },
            {
              account: to,
              amountPaise,
              type: 'transfer',
              transferId: idempotencyKey,
              refId: idempotencyKey,
              note,
            },
          ]),
          { session, ordered: true },
        );
        const result = { transferId: idempotencyKey, from, to, amountPaise, note: note ?? '' };
        if (audit) await audit(result, session);
        return { ...result, replay: false };
      });
    },
    async listTransfers({ tenantId, page, pageSize }) {
      const match = { tenantId, type: 'transfer', amountPaise: { $lt: 0 } };
      const [outs, total] = await Promise.all([
        LedgerEntry.find(match)
          .sort({ createdAt: -1 })
          .skip(pageOf(page, pageSize).skip)
          .limit(pageSize)
          .lean(),
        LedgerEntry.countDocuments(match),
      ]);
      const ins = await LedgerEntry.find({
        tenantId,
        type: 'transfer',
        amountPaise: { $gt: 0 },
        transferId: { $in: outs.map((o) => o.transferId) },
      }).lean();
      const to = new Map(ins.map((i) => [i.transferId, i.account]));
      return {
        rows: outs.map((o) => ({
          transferId: o.transferId,
          date: o.entryDate,
          from: o.account,
          to: to.get(o.transferId) ?? '',
          amountPaise: -o.amountPaise,
          note: o.note ?? '',
          byName: o.createdByName,
        })),
        total,
      };
    },

    // ---------- cashier PIN ----------
    async setPin({ tenantId, pin, user, audit }) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
      await CashierPin.updateOne(
        { tenantId },
        {
          $set: { hash, salt, failed: 0, locked: false, setBy: String(user.id), setAt: new Date() },
        },
        { upsert: true },
      );
      if (audit) await audit({ set: true });
    },
    async pinStatus(tenantId) {
      const p = await CashierPin.findOne({ tenantId }).lean();
      return { isSet: !!p, locked: !!p?.locked, setAt: p?.setAt ?? null };
    },
    /** Returns { ok } or { ok:false, reason: 'NOT_SET' | 'LOCKED' | 'WRONG', attemptsLeft }. */
    async verifyPin({ tenantId, pin }) {
      const p = await CashierPin.findOne({ tenantId }).lean();
      if (!p) return { ok: false, reason: 'NOT_SET' };
      if (p.locked || p.failed >= PIN_MAX_ATTEMPTS) return { ok: false, reason: 'LOCKED' };
      const given = crypto.scryptSync(pin, p.salt, 32);
      if (crypto.timingSafeEqual(given, Buffer.from(p.hash, 'hex'))) {
        if (p.failed > 0) await CashierPin.updateOne({ tenantId }, { $set: { failed: 0 } });
        return { ok: true };
      }
      // Atomic count so parallel guesses cannot all slip under the limit.
      const after = await CashierPin.findOneAndUpdate(
        { tenantId },
        { $inc: { failed: 1 } },
        { returnDocument: 'after' },
      ).lean();
      if (after.failed >= PIN_MAX_ATTEMPTS)
        await CashierPin.updateOne({ tenantId }, { $set: { locked: true } });
      return {
        ok: false,
        reason: after.failed >= PIN_MAX_ATTEMPTS ? 'LOCKED' : 'WRONG',
        attemptsLeft: Math.max(0, PIN_MAX_ATTEMPTS - after.failed),
      };
    },
  };
}
export { accountKey };
