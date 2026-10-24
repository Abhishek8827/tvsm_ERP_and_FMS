import { Router } from 'express';
import writeXlsxFile from 'write-excel-file/node';
import { z } from 'zod';
import { classLabel, rupeesToPaise, todayIst } from '@erp/shared';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import { buildCashbook } from '../services/cashbook.js';
import { AppError } from '../utils/errors.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const dayQuery = z.object({ date: date.optional() });
const settingsBody = z.object({
  openingRupees: z.string().trim().min(1, 'Enter the opening amount'),
  startDate: date,
  heads: z.array(z.string().trim().min(1).max(80)).max(20),
  reason: z.string().trim().min(3, 'Write the reason').max(300),
});

/**
 * Cashbook: the school's daily notebook as a report. Everyone signed in can look at any date;
 * only the Admin changes the settings (the transport vendor account). Nothing here is typed in
 * by hand: every figure comes from receipts, expense payments and the money ledger.
 */
export function cashbookRouter(deps, authenticate) {
  const router = Router();
  const view = [authenticate, requireRole('admin', 'principal', 'cashier')];
  const adminOnly = [authenticate, requireRole('admin')];
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
  async function build(req) {
    const q = dayQuery.parse(req.query);
    const today = todayIst();
    const d = q.date ?? today;
    if (d > today) throw new AppError('FUTURE_DATE', 422, 'A future date has no cashbook yet.');
    const tenantId = req.user.tenantId;
    const settings = await deps.cashbookStore.getSettings(tenantId);
    const [raw, banks] = await Promise.all([
      deps.cashbookStore.gather(tenantId, d, settings),
      deps.moneyStore.listBanks(tenantId),
    ]);
    return buildCashbook({ date: d, banks, settings, ...raw });
  }

  router.get(
    '/cashbook',
    ...view,
    wrap(async (req, res) => res.json(await build(req))),
  );

  router.get(
    '/cashbook/export',
    ...view,
    wrap(async (req, res) => {
      const c = await build(req);
      const R = (p) => p / 100;
      const bold = (value) => ({ value, fontWeight: 'bold' });
      const rows = [[bold(`Cashbook ${c.date}${c.closed ? '  (Day closed)' : ''}`)], []];
      for (const [title, s] of [
        ['1. School fees receipts', c.school],
        ['2. Bus fees receipts', c.bus],
      ]) {
        rows.push([bold(title)]);
        rows.push(
          ['Receipt', 'Scholar', 'Class', 'Student name', 'Cash', 'Online', 'Due'].map(bold),
        );
        for (const r of s.rows)
          rows.push([
            r.number,
            r.admissionNo,
            r.classKey ? `${classLabel(r.classKey)}${r.section ? ` - ${r.section}` : ''}` : '',
            r.name,
            R(r.cashPaise),
            R(r.onlinePaise),
            R(r.duePaise),
          ]);
        rows.push([bold('Total'), '', '', '', bold(R(s.cashPaise)), bold(R(s.onlinePaise)), '']);
        rows.push([]);
      }
      rows.push([bold('3. Expense summary')]);
      rows.push(['Voucher no', 'Head', 'Payee', 'Paid from', 'Amount', 'By'].map(bold));
      for (const e of c.expenses.rows)
        rows.push([
          e.voucherNo + (e.reversal ? ' (reversal)' : ''),
          e.head,
          e.payee,
          e.mode,
          R(e.amountPaise),
          e.by,
        ]);
      rows.push([bold('Total'), '', '', '', bold(R(c.expenses.totalPaise))]);
      rows.push([]);
      const blockRows = (b) => [
        ['Opening balance', R(b.openingPaise)],
        ["Add: today's receipts", R(b.receiptsPaise)],
        ['Add/less: transfers and other', R(b.otherPaise)],
        ["Less: today's expense", R(b.expensePaise)],
        [bold('Closing balance'), bold(R(b.closingPaise))],
      ];
      rows.push([bold('4. Cash balance')], ...blockRows(c.cash), []);
      rows.push([bold('5. Online balance')]);
      for (const b of c.online.banks) rows.push([bold(b.name)], ...blockRows(b));
      rows.push([]);
      rows.push([bold('6. Transport account')]);
      if (!c.transport.configured) rows.push(['Not set up yet']);
      else {
        rows.push(
          ['Opening balance', R(c.transport.openingPaise)],
          ['Income: cash', R(c.transport.incomeCashPaise)],
          ['Income: online', R(c.transport.incomeOnlinePaise)],
          ['Less: expense', R(c.transport.expensePaise)],
          [bold('Closing balance'), bold(R(c.transport.closingPaise))],
        );
      }
      const buffer = await writeXlsxFile(rows).toBuffer();
      await recordAudit(deps, req, {
        action: 'export',
        entity: 'cashbook',
        newValue: { date: c.date },
      });
      res
        .set('Content-Type', XLSX)
        .set('Content-Disposition', `attachment; filename="cashbook-${c.date}.xlsx"`)
        .send(buffer);
    }),
  );

  router.get(
    '/cashbook/settings',
    ...view,
    wrap(async (req, res) => {
      const tenantId = req.user.tenantId;
      const [s, heads] = await Promise.all([
        deps.cashbookStore.getSettings(tenantId),
        deps.moneyStore.listHeads(tenantId),
      ]);
      res.json({
        transportOpeningPaise: s?.transportOpeningPaise ?? 0,
        transportStartDate: s?.transportStartDate ?? null,
        transportHeads: s?.transportHeads ?? [],
        history: (s?.history ?? []).slice(-10).reverse(),
        expenseHeads: heads.map((h) => h.name),
      });
    }),
  );

  router.put(
    '/cashbook/settings',
    ...adminOnly,
    wrap(async (req, res) => {
      const b = settingsBody.parse(req.body);
      let openingPaise;
      try {
        openingPaise = rupeesToPaise(b.openingRupees);
      } catch {
        throw new AppError('BAD_AMOUNT', 422, 'Enter a valid opening amount.', {
          openingRupees: 'Enter a valid amount',
        });
      }
      if (openingPaise < 0)
        throw new AppError('BAD_AMOUNT', 422, 'Opening amount cannot be negative.');
      const tenantId = req.user.tenantId;
      const known = (await deps.moneyStore.listHeads(tenantId)).map((h) => h.name.toLowerCase());
      const unknown = b.heads.filter((h) => !known.includes(h.toLowerCase()));
      if (unknown.length)
        throw new AppError('UNKNOWN_HEAD', 422, `Expense head not found: ${unknown.join(', ')}.`);
      const before = await deps.cashbookStore.getSettings(tenantId);
      await deps.cashbookStore.saveSettings({
        tenantId,
        openingPaise,
        startDate: b.startDate,
        heads: b.heads,
        reason: b.reason,
        user: req.user,
      });
      await recordAudit(
        deps,
        req,
        {
          action: 'update',
          entity: 'cashbook_settings',
          reason: b.reason,
          oldValue: before && {
            openingPaise: before.transportOpeningPaise,
            startDate: before.transportStartDate,
            heads: before.transportHeads,
          },
          newValue: { openingPaise, startDate: b.startDate, heads: b.heads },
        },
        { critical: true },
      );
      res.json({ ok: true });
    }),
  );

  return router;
}
