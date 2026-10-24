import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { buildCashbook } from '../services/cashbook.js';
import { createLogger } from '../utils/logger.js';

const TENANT = 'tvsm';
const env = loadEnv({
  MONGODB_URI: 'mongodb://unused',
  NODE_ENV: 'test',
  DEFAULT_TENANT_ID: TENANT,
});
const mk = (id, role) => ({
  _id: id, firebaseUid: id, email: `${id}@x.com`, name: id, role, tenantId: TENANT, isActive: true,
}); // prettier-ignore
const users = {
  admin: mk('admin', 'admin'),
  principal: mk('principal', 'principal'),
  cashier: mk('cashier', 'cashier'),
};
const as = (t) => ({ Authorization: `Bearer ${t}` });

const rec = (o) => ({
  _id: o.number, kind: 'school', mode: 'cash', totalPaise: 100000, dueAfterPaise: 0,
  student: { admissionNo: '7', name: 'Asha', classKey: '5th', section: 'A' }, ...o,
}); // prettier-ignore
const banks = [
  { _id: 'hdfc', name: 'HDFC' },
  { _id: 'kotak', name: 'Kotak' },
];
const day = {
  date: '2026-10-10',
  banks,
  receipts: [
    rec({ number: 'S-1', totalPaise: 150000, dueAfterPaise: 50000 }),
    rec({ number: 'S-2', mode: 'upi', bankId: 'hdfc', totalPaise: 200000 }),
    rec({ number: 'T-1', kind: 'transport', totalPaise: 60000 }),
    rec({ number: 'T-2', kind: 'transport', mode: 'qr', bankId: 'kotak', totalPaise: 40000 }),
    rec({ number: 'S-3', mode: 'upi', totalPaise: 5000 }), // no bank chosen (old receipt)
  ],
  ledgerDay: [
    { _id: 'e1', account: 'cash', type: 'expense_payment', amountPaise: -30000, refId: 'p1', note: 'EXP/1' },
    { _id: 'e2', account: 'bank:hdfc', type: 'expense_payment', amountPaise: -80000, refId: 'p2', note: 'EXP/2' },
    { _id: 'e3', account: 'cash', type: 'payment_reversal', amountPaise: 10000, refId: 'p1', note: 'EXP/1' },
    { _id: 'e4', account: 'cash', type: 'transfer', amountPaise: -20000, refId: 't' },
    { _id: 'e5', account: 'bank:kotak', type: 'transfer', amountPaise: 20000, refId: 't' },
  ],
  opening: { cash: 1000000, 'bank:hdfc': 500000 },
  payments: [
    { _id: 'p1', voucherNumber: 'EXP/1', headName: 'Stationery', payeeName: 'Shop', authorisedBy: 'President' },
    { _id: 'p2', voucherNumber: 'EXP/2', headName: 'Bus Diesel', payeeName: 'Pump', authorisedBy: 'Vice President' },
  ],
  settings: { transportStartDate: '2026-10-01', transportOpeningPaise: 300000, transportHeads: ['bus diesel'] },
  transportBefore: 450000,
  dayClose: { status: 'closed', closedByName: 'Cashier A' },
}; // prettier-ignore

describe('buildCashbook (one day)', () => {
  const c = buildCashbook(day);
  it('splits receipts into school and bus with cash / online columns and the due', () => {
    expect(c.school.rows.map((r) => r.number)).toEqual(['S-1', 'S-2', 'S-3']);
    expect(c.school.cashPaise).toBe(150000);
    expect(c.school.onlinePaise).toBe(205000);
    expect(c.school.rows[0].duePaise).toBe(50000);
    expect(c.school.rows[1].bankName).toBe('HDFC'); // found from the bank id
    expect(c.bus.cashPaise).toBe(60000);
    expect(c.bus.onlinePaise).toBe(40000);
  });
  it('cash: opening + receipts + other - expense = closing (reversal brings money back)', () => {
    expect(c.cash).toMatchObject({
      openingPaise: 1000000,
      receiptsPaise: 210000,
      otherPaise: -20000,
      expensePaise: 20000, // 30000 paid, 10000 reversed
      closingPaise: 1000000 + 210000 - 20000 - 20000,
    });
  });
  it('online: per bank, and old UPI receipts without a bank are flagged, not added to a bank', () => {
    const h = c.online.banks.find((b) => b.id === 'hdfc');
    expect(h).toMatchObject({
      openingPaise: 500000,
      receiptsPaise: 200000,
      expensePaise: 80000,
      closingPaise: 620000,
    });
    const k = c.online.banks.find((b) => b.id === 'kotak');
    expect(k).toMatchObject({ receiptsPaise: 40000, otherPaise: 20000, closingPaise: 60000 });
    expect(c.online.unassignedPaise).toBe(5000);
  });
  it('expense summary lists voucher, head and who authorised; total nets the reversal', () => {
    expect(c.expenses.rows.map((r) => [r.voucherNo, r.head, r.amountPaise, r.by])).toEqual([
      ['EXP/1', 'Stationery', 30000, 'President'],
      ['EXP/2', 'Bus Diesel', 80000, 'Vice President'],
      ['EXP/1', 'Stationery', -10000, 'President'],
    ]);
    expect(c.expenses.totalPaise).toBe(100000);
  });
  it('transport account: opening + bus income (cash + online) - transport-head expense', () => {
    expect(c.transport).toMatchObject({
      openingPaise: 450000,
      incomeCashPaise: 60000,
      incomeOnlinePaise: 40000,
      expensePaise: 80000,
      closingPaise: 450000 + 100000 - 80000,
    });
  });
  it('on its start date the transport account starts from the Admin opening amount', () => {
    const first = buildCashbook({ ...day, date: '2026-10-01' });
    expect(first.transport.openingPaise).toBe(300000);
    const before = buildCashbook({ ...day, date: '2026-09-30' });
    expect(before.transport).toMatchObject({ started: false, openingPaise: 0 });
  });
  it('shows the Day closed tag only for a closed day', () => {
    expect(c.closed).toBe(true);
    expect(buildCashbook({ ...day, dayClose: { status: 'open' } }).closed).toBe(false);
    expect(buildCashbook({ ...day, dayClose: null }).closed).toBe(false);
  });
  it('an empty day is all zeros with the opening carried to the closing', () => {
    const e = buildCashbook({ ...day, receipts: [], ledgerDay: [], payments: [] });
    expect(e.cash.closingPaise).toBe(1000000);
    expect(e.expenses.totalPaise).toBe(0);
  });
});

function build() {
  const audit = [];
  let saved = null;
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: { findByFirebaseUid: async (_t, uid) => users[uid], touchLogin: async () => {} },
    auditStore: { append: async (e) => audit.push(e) },
    moneyStore: {
      listBanks: async () => banks,
      listHeads: async () => [{ name: 'Bus Diesel' }, { name: 'Stationery' }],
    },
    cashbookStore: {
      getSettings: async () => saved,
      gather: async () => {
        const { banks: _b, settings: _s, date: _d, ...raw } = day;
        return raw;
      },
      saveSettings: async (x) => {
        saved = {
          transportOpeningPaise: x.openingPaise,
          transportStartDate: x.startDate,
          transportHeads: x.heads,
          history: [],
        };
        return saved;
      },
    },
  };
  return { app: createApp(env, createLogger('silent'), deps), audit };
}

describe('Cashbook routes', () => {
  it('everyone can view a day and export it; a future date is refused', async () => {
    const { app } = build();
    for (const who of ['admin', 'principal', 'cashier']) {
      const r = await request(app).get('/api/cashbook?date=2026-10-10').set(as(who));
      expect(r.status).toBe(200);
      expect(r.body.cash.closingPaise).toBe(1170000);
    }
    const x = await request(app).get('/api/cashbook/export?date=2026-10-10').set(as('cashier'));
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toMatch(/spreadsheetml/);
    const future = await request(app).get('/api/cashbook?date=2999-01-01').set(as('admin'));
    expect(future.status).toBe(422);
  });
  it('only the Admin can change the settings (reason needed, head must exist), and it is audited', async () => {
    const { app, audit } = build();
    const body = {
      openingRupees: '3000',
      startDate: '2026-10-01',
      heads: ['Bus Diesel'],
      reason: 'start of account',
    };
    for (const who of ['principal', 'cashier'])
      expect(
        (await request(app).put('/api/cashbook/settings').set(as(who)).send(body)).status,
      ).toBe(403);
    expect(
      (
        await request(app)
          .put('/api/cashbook/settings')
          .set(as('admin'))
          .send({ ...body, reason: 'x' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put('/api/cashbook/settings')
          .set(as('admin'))
          .send({ ...body, heads: ['Nope'] })
      ).status,
    ).toBe(422);
    expect(
      (await request(app).put('/api/cashbook/settings').set(as('admin')).send(body)).status,
    ).toBe(200);
    expect(
      audit.some((a) => a.entity === 'cashbook_settings' && a.reason === 'start of account'),
    ).toBe(true);
    const s = await request(app).get('/api/cashbook/settings').set(as('cashier'));
    expect(s.body).toMatchObject({ transportOpeningPaise: 300000, transportHeads: ['Bus Diesel'] });
  });
});
