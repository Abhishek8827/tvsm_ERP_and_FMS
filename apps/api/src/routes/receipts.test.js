import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCharges, receiptNumber } from '@erp/shared';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const TENANT = 'tvsm';
const env = loadEnv({
  MONGODB_URI: 'mongodb://unused',
  NODE_ENV: 'test',
  DEFAULT_TENANT_ID: TENANT,
});
const users = Object.fromEntries(
  ['admin', 'principal', 'cashier'].map((r) => [
    r,
    {
      _id: r,
      firebaseUid: r,
      email: `${r}@x.com`,
      name: r,
      role: r,
      tenantId: TENANT,
      isActive: true,
    },
  ]),
);
const S1 = 'a'.repeat(23) + '1';
const S2 = 'a'.repeat(23) + '2';
const rs = (n) => n * 100;

function build({ withOld = false } = {}) {
  const audit = [];
  const receipts = [];
  const cancellations = [];
  const counters = {};
  const students = {
    [S1]: {
      _id: S1,
      name: 'Aarav',
      admissionNo: '10',
      classKey: '1',
      status: 'active',
      contactNo: '9876543210',
    },
    [S2]: { _id: S2, name: 'Left', admissionNo: '11', classKey: '1', status: 'inactive' },
  };
  const charges = [
    ...buildCharges({
      fy: '2026-27',
      classFee: { tuition: rs(1000), admission: 0, form: 0 },
      transportMonthly: rs(500),
    }),
    ...(withOld
      ? [{ head: 'old_fees', period: 'opening', dueDate: '2026-04-01', amount: rs(2000) }]
      : []),
  ].map((c, i) => ({ ...c, _id: `c${i}`, amountPaise: c.amount }));
  const auth = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: { findByFirebaseUid: async (_t, uid) => users[uid], touchLogin: async () => {} },
    auditStore: { append: async (e) => audit.push(e) },
    studentStore: { findById: async (_t, id) => students[id] ?? null },
    feeStore: { get: async () => null },
    chargeStore: { listForStudent: async () => charges },
    // Only the bank lookup is needed here: the bank "b1" is active, anything else is unknown.
    moneyStore: {
      findActiveBank: async (_t, id) => (id === BANK ? { _id: BANK, name: 'IDFC' } : null),
    },
    // Same behaviour as the real store: same key = same receipt, numbers per kind, rules re-checked.
    receiptStore: {
      issue: async ({ studentId, fy, kind, idempotencyKey, build: make, audit: log }) => {
        const again = receipts.find((r) => r.idempotencyKey === idempotencyKey);
        if (again) return { receipt: again, replay: true };
        const doc = await make(receipts.filter((r) => String(r.studentId) === String(studentId)));
        const k = `${kind}:${fy}`;
        counters[k] = (counters[k] ?? 0) + 1;
        const saved = {
          ...doc,
          _id: `${'c'.repeat(23)}${receipts.length + 1}`,
          kind,
          fy,
          studentId,
          idempotencyKey,
          seq: counters[k],
          number: receiptNumber(kind, fy, counters[k]),
          issuedAt: new Date(),
        };
        if (log) await log(saved);
        receipts.push(saved);
        return { receipt: saved, replay: false };
      },
      findById: async (_t, id) => {
        const r = receipts.find((x) => x._id === id);
        return r
          ? { ...r, cancellation: cancellations.find((c) => c.receiptId === id) ?? null }
          : null;
      },
      list: async ({ kind, page, pageSize }) => {
        const rows = receipts
          .filter((r) => !kind || r.kind === kind)
          .map((r) => ({
            ...r,
            status: cancellations.some((c) => c.receiptId === r._id && c.status === 'cancelled')
              ? 'cancelled'
              : 'valid',
          }));
        const groups = {};
        for (const r of rows.filter((x) => x.status === 'valid')) {
          const k = `${r.kind}|${r.mode}`;
          groups[k] = groups[k] ?? { kind: r.kind, mode: r.mode, paise: 0, count: 0 };
          groups[k].paise += r.totalPaise;
          groups[k].count += 1;
        }
        return {
          rows: rows.slice((page - 1) * pageSize, page * pageSize),
          total: rows.length,
          groups: Object.values(groups),
        };
      },
      listAll: async () => receipts.map((r) => ({ ...r, status: 'valid' })),
      requestCancel: async ({ receipt, reason, user, audit: log }) => {
        if (cancellations.some((c) => c.receiptId === String(receipt._id))) return null;
        const c = {
          _id: `q${cancellations.length + 1}`,
          receiptId: String(receipt._id),
          status: 'requested',
          reason,
          requestedByName: user.name,
        };
        if (log) await log(c);
        cancellations.push(c);
        return c;
      },
      cancelDirect: async ({ receipt, reason, user, audit: log }) => {
        const live = cancellations.find((c) => c.receiptId === String(receipt._id));
        if (live?.status === 'cancelled') return null;
        const c = live ?? {
          _id: `q${cancellations.length + 1}`,
          receiptId: String(receipt._id),
          reason,
        };
        Object.assign(c, { status: 'cancelled', decidedByName: user.name });
        if (log) await log(c);
        if (!live) cancellations.push(c);
        return c;
      },
      listForStudent: async (_t, id) => receipts.filter((r) => String(r.studentId) === id),
    },
  };
  return { app: createApp(env, createLogger('silent'), auth), audit, receipts };
}
const as = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
const key = () => `key-${Date.now()}-${(n += 1)}`;
const BANK = 'b'.repeat(24);
const collect = (app, body, who = 'cashier', idem = key()) =>
  request(app)
    .post('/api/receipts')
    .set(as(who))
    .set('Idempotency-Key', idem)
    .send({ studentId: S1, kind: 'school', mode: 'cash', ...body });

describe('collecting fees', () => {
  beforeEach(() => {
    // Only the clock is faked: 10 June 2026, 10:30 IST (June fee due, nothing overdue yet).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-10T05:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('only the Cashier can collect (Admin / Principal get 403, no token gets 401)', async () => {
    const { app } = build();
    for (const who of ['admin', 'principal'])
      expect((await collect(app, { input: { newPaise: rs(1000) } }, who)).status).toBe(403);
    expect((await request(app).post('/api/receipts').send({})).status).toBe(401);
  });

  it('needs an Idempotency-Key header', async () => {
    const { app } = build();
    const r = await request(app)
      .post('/api/receipts')
      .set(as('cashier'))
      .send({ studentId: S1, kind: 'school', mode: 'cash', input: { newPaise: rs(1000) } });
    expect(r.status).toBe(400);
  });

  it('issues a receipt with the S- number, month, audit entry; the same key again is a harmless replay', async () => {
    const { app, audit, receipts } = build();
    const k = key();
    const a = await collect(app, { input: { newPaise: rs(1000) } }, 'cashier', k);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      number: 'S-FY2026-27/0001',
      totalPaise: rs(1000),
      monthLabel: 'June',
      kind: 'school',
      student: { admissionNo: '10', name: 'Aarav' },
    });
    const again = await collect(app, { input: { newPaise: rs(1000) } }, 'cashier', k);
    expect(again.status).toBe(200);
    expect(again.body.number).toBe('S-FY2026-27/0001');
    expect(receipts).toHaveLength(1);
    expect(audit.filter((e) => e.entity === 'receipt' && e.action === 'create')).toHaveLength(1);
  });

  it('school and transport have separate numbers', async () => {
    const { app } = build();
    await collect(app, { input: { newPaise: rs(1000) } });
    const bus = await collect(app, { kind: 'transport', input: { newPaise: rs(500) } });
    expect(bus.body.number).toBe('T-FY2026-27/0001');
    const next = await collect(app, { input: { newPaise: rs(1000) } });
    expect(next.body.number).toBe('S-FY2026-27/0002');
  });

  it('a bus receipt cannot carry school-only heads', async () => {
    const { app } = build();
    const r = await collect(app, { kind: 'transport', input: { tcPaise: rs(50) } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('BAD_HEAD');
  });

  it('UPI and QR need a reference; cash keeps none', async () => {
    const { app } = build();
    const no = await collect(app, { mode: 'upi', input: { newPaise: rs(1000) } });
    expect(no.status).toBe(422);
    expect(no.body.error.code).toBe('REFERENCE_REQUIRED');
    const yes = await collect(app, {
      mode: 'qr',
      reference: 'UPI123456',
      bankId: BANK,
      input: { newPaise: rs(1000) },
    });
    expect(yes.body).toMatchObject({ mode: 'qr', reference: 'UPI123456', bankName: 'IDFC' });
    const cash = await collect(app, {
      mode: 'cash',
      reference: 'ignored',
      input: { newPaise: rs(1000) },
    });
    expect(cash.body.reference).toBeNull();
  });

  it('UPI and QR must name an active bank account; cash has none', async () => {
    const { app, receipts } = build();
    const none = await collect(app, {
      mode: 'upi',
      reference: 'UPI123456',
      input: { newPaise: rs(1000) },
    });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('BANK_REQUIRED');
    const wrong = await collect(app, {
      mode: 'upi',
      reference: 'UPI123456',
      bankId: 'c'.repeat(24),
      input: { newPaise: rs(1000) },
    });
    expect(wrong.body.error.code).toBe('BANK_REQUIRED');
    expect(receipts).toHaveLength(0);
    const cash = await collect(app, { mode: 'cash', input: { newPaise: rs(1000) } });
    expect(cash.status).toBe(201);
    expect(cash.body.bankName).toBeNull();
  });

  it('refuses new fees while old fees are pending, and a refused payment uses up no number', async () => {
    const { app, receipts } = build({ withOld: true });
    const bad = await collect(app, { input: { newPaise: rs(1000) } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('OLD_FEES_PENDING');
    expect(receipts).toHaveLength(0);
    const ok = await collect(app, { input: { oldPaise: rs(2000), newPaise: rs(1000) } });
    expect(ok.status).toBe(201);
    expect(ok.body.number).toBe('S-FY2026-27/0001');
  });

  it('late fee: reducing it needs a reason, and the reduction is audited with that reason', async () => {
    vi.setSystemTime(new Date('2026-06-30T05:00:00Z')); // 15 days after the due date
    const { app, audit } = build();
    const bad = await collect(app, { input: { newPaise: rs(1000), lateFeePaise: 0 } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('LATE_REMARK_REQUIRED');
    const ok = await collect(app, {
      input: { newPaise: rs(1000), lateFeePaise: rs(40), lateFeeRemark: 'Bank delay' },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.totalPaise).toBe(rs(1040));
    const override = audit.find((e) => e.action === 'override' && e.entity === 'late_fee');
    expect(override).toMatchObject({ reason: 'Bank delay', newValue: { chargedPaise: rs(40) } });
  });

  it('refuses an inactive student and unknown input', async () => {
    const { app } = build();
    expect((await collect(app, { studentId: S2, input: { newPaise: rs(1000) } })).status).toBe(409);
    expect((await collect(app, { input: { newPaise: 1.5 } })).status).toBe(400);
  });

  it('dues: every role can look, amounts come from the server', async () => {
    const { app } = build();
    for (const who of ['admin', 'principal', 'cashier']) {
      const r = await request(app).get(`/api/students/${S1}/dues?kind=school`).set(as(who));
      expect(r.status).toBe(200);
      expect(r.body.remaining.tuition).toBe(rs(10000));
      expect(r.body.dueNowPaise).toBe(0); // June is due only from the 15th
    }
    expect(
      (await request(app).get(`/api/students/${S1}/dues?kind=oops`).set(as('cashier'))).status,
    ).toBe(400);
  });

  it('a receipt can be read by all roles; reprint is audited and marked duplicate (not for Principal)', async () => {
    const { app, audit } = build();
    const made = await collect(app, { input: { newPaise: rs(1000) } });
    const id = made.body.id;
    expect((await request(app).get(`/api/receipts/${id}`).set(as('principal'))).status).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/receipts/${'b'.repeat(24)}`)
          .set(as('cashier'))
      ).status,
    ).toBe(404);
    expect(
      (await request(app).post(`/api/receipts/${id}/reprint`).set(as('principal'))).status,
    ).toBe(403);
    const dup = await request(app).post(`/api/receipts/${id}/reprint`).set(as('cashier'));
    expect(dup.status).toBe(200);
    expect(dup.body).toMatchObject({ duplicate: true, number: 'S-FY2026-27/0001' });
    expect(audit.some((e) => e.action === 'reprint' && e.entityId === id)).toBe(true);
  });

  it('the list shows all receipts with totals by type and mode, to every role', async () => {
    const { app } = build();
    await collect(app, { input: { newPaise: rs(1000) } });
    await collect(app, {
      mode: 'upi',
      reference: 'UPI123456',
      bankId: BANK,
      input: { newPaise: rs(1000) },
    });
    await collect(app, { kind: 'transport', input: { newPaise: rs(500) } });
    for (const who of ['admin', 'principal', 'cashier']) {
      const r = await request(app).get('/api/receipts').set(as(who));
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(3);
      expect(r.body.totals).toMatchObject({
        paise: rs(2500),
        count: 3,
        byKind: { school: rs(2000), transport: rs(500) },
        byMode: { cash: rs(1500), upi: rs(1000) },
      });
    }
    expect((await request(app).get('/api/receipts?from=oops').set(as('cashier'))).status).toBe(400);
  });

  it('Cashier can only ask for a cancellation (reason needed, once); Admin cancels directly; nobody else', async () => {
    const { app, audit } = build();
    const id = (await collect(app, { input: { newPaise: rs(1000) } })).body.id;
    const ask = (who, reason) =>
      request(app).post(`/api/receipts/${id}/cancel-request`).set(as(who)).send({ reason });
    expect((await ask('admin', 'wrong amount')).status).toBe(403);
    expect((await ask('principal', 'wrong amount')).status).toBe(403);
    expect((await ask('cashier', 'x')).status).toBe(400);
    expect((await ask('cashier', 'Wrong student')).status).toBe(201);
    expect((await ask('cashier', 'Wrong student')).status).toBe(409);
    expect((await request(app).get(`/api/receipts/${id}`).set(as('cashier'))).body.status).toBe(
      'cancel_requested',
    );
    expect(
      (
        await request(app)
          .post(`/api/receipts/${id}/cancel`)
          .set(as('cashier'))
          .send({ reason: 'ok ok' })
      ).status,
    ).toBe(403);
    const done = await request(app)
      .post(`/api/receipts/${id}/cancel`)
      .set(as('admin'))
      .send({ reason: 'Wrong student' });
    expect(done.status).toBe(200);
    expect((await request(app).get(`/api/receipts/${id}`).set(as('principal'))).body.status).toBe(
      'cancelled',
    );
    expect(
      (
        await request(app)
          .post(`/api/receipts/${id}/cancel`)
          .set(as('admin'))
          .send({ reason: 'again' })
      ).status,
    ).toBe(409);
    expect(
      audit.some(
        (e) => e.action === 'cancel' && e.entity === 'receipt' && e.reason === 'Wrong student',
      ),
    ).toBe(true);
  });

  it('only the Admin can export; it is audited', async () => {
    const { app, audit } = build();
    await collect(app, { input: { newPaise: rs(1000) } });
    expect((await request(app).get('/api/receipts/export').set(as('cashier'))).status).toBe(403);
    expect((await request(app).get('/api/receipts/export').set(as('principal'))).status).toBe(403);
    const r = await request(app).get('/api/receipts/export').set(as('admin')).buffer(true);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    expect(audit.some((e) => e.action === 'export' && e.entity === 'receipts')).toBe(true);
  });
});
