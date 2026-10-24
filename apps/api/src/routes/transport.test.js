import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { matchVillage } from '@erp/shared';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { chargesForStudent } from '../services/feePlan.js';
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
const ID = 'a'.repeat(24);
const chart = {
  fy: '2026-27',
  classFees: [{ classKey: '5th', monthlyTuitionPaise: 100000, admissionPaise: 0 }],
  villages: [
    { name: 'DHANORA', monthlyPaise: 50000 },
    { name: 'BORI', monthlyPaise: 70000 },
  ],
  formFeePaise: 0,
};

function build({ usedChargeIds = [] } = {}) {
  const audit = [];
  const charges = [];
  const student = {
    _id: ID, admissionNo: '7', name: 'Asha', classKey: '5th', status: 'active', address: 'Dhanora',
  }; // prettier-ignore
  const removed = [];
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: { findByFirebaseUid: async (_t, uid) => users[uid], touchLogin: async () => {} },
    auditStore: { append: async (e) => audit.push(e) },
    studentStore: {
      findById: async () => student,
      findByAdmissionNos: async (_t, nos) => (nos.includes('7') ? [student] : []),
      update: async (_t, _id, data) => Object.assign(student, data),
      listTransport: async () => ({ rows: [student], total: 1 }),
    },
    feeStore: { get: async () => chart },
    chargeStore: {
      listForStudent: async () => charges,
      postMany: async (_t, _s, _fy, list) => {
        let n = 0;
        for (const c of list)
          if (!charges.some((x) => x.period === c.period && x.head === c.head)) {
            charges.push({ ...c, _id: `c${charges.length}`, amountPaise: c.amount });
            n += 1;
          }
        return n;
      },
      deleteByIds: async (_t, ids) => {
        removed.push(...ids);
        for (const id of ids)
          charges.splice(
            charges.findIndex((c) => c._id === id),
            1,
          );
      },
    },
    receiptStore: {
      listForStudent: async () => [{ lines: usedChargeIds.map((c) => ({ chargeId: c })) }],
    },
    rebateStore: { listForStudent: async () => [] },
  };
  return { app: createApp(env, createLogger('silent'), deps), student, charges, audit, removed };
}

describe('villages from the address', () => {
  it('exact match wins; a part match counts only when exactly one village fits', () => {
    expect(matchVillage(' dhanora ', chart.villages).name).toBe('DHANORA');
    expect(matchVillage('Near Bori chowk', chart.villages).name).toBe('BORI');
    expect(matchVillage('Dhanora and Bori road', chart.villages)).toBeNull();
    expect(matchVillage('', chart.villages)).toBeNull();
  });
});

describe('Transport: permissions', () => {
  it('everyone can view; only the Admin can look up, enrol or stop', async () => {
    const { app } = build();
    for (const who of ['admin', 'principal', 'cashier'])
      expect((await request(app).get('/api/transport').set(as(who))).status).toBe(200);
    for (const who of ['principal', 'cashier']) {
      expect((await request(app).get('/api/transport/lookup/7').set(as(who))).status).toBe(403);
      expect((await request(app).post('/api/transport/enroll').set(as(who)).send({})).status).toBe(
        403,
      );
      expect((await request(app).post('/api/transport/stop').set(as(who)).send({})).status).toBe(
        403,
      );
    }
  });
});

describe('Transport: enrol and stop', () => {
  it('lookup suggests the village from the address and June as the start', async () => {
    const { app } = build();
    const res = await request(app).get('/api/transport/lookup/7').set(as('admin'));
    expect(res.body).toMatchObject({
      suggestedVillage: 'DHANORA',
      defaultFromMonth: '2026-06',
      state: 'none',
    });
    expect((await request(app).get('/api/transport/lookup/99').set(as('admin'))).status).toBe(404);
  });
  it('enrol saves the village + start month and posts the bus fee only from that month', async () => {
    const { app, student, charges, audit } = build();
    const res = await request(app)
      .post('/api/transport/enroll')
      .set(as('admin'))
      .send({ studentId: ID, village: 'dhanora', fromMonth: '2026-06' });
    expect(res.status).toBe(201);
    expect(student).toMatchObject({
      usesTransport: true,
      village: 'DHANORA',
      transportFrom: '2026-06',
    });
    const bus = charges.filter((c) => c.head === 'transport');
    expect(bus.length).toBeGreaterThan(0);
    expect(bus.every((c) => c.dueDate.slice(0, 7) >= '2026-06')).toBe(true);
    expect(bus[0].amountPaise).toBe(50000);
    expect(audit.some((a) => a.entity === 'student_transport')).toBe(true);
    const again = await request(app)
      .post('/api/transport/enroll')
      .set(as('admin'))
      .send({ studentId: ID, village: 'DHANORA', fromMonth: '2026-06' });
    expect(again.body.error.code).toBe('ALREADY_ON_BUS');
  });
  it('a village that is not in the fee chart is refused', async () => {
    const { app } = build();
    const res = await request(app)
      .post('/api/transport/enroll')
      .set(as('admin'))
      .send({ studentId: ID, village: 'NOWHERE', fromMonth: '2026-06' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_VILLAGE_FEE');
  });
  it('stop removes unpaid months from the stop month and keeps the earlier ones', async () => {
    const { app, student, charges } = build();
    await request(app)
      .post('/api/transport/enroll')
      .set(as('admin'))
      .send({ studentId: ID, village: 'BORI', fromMonth: '2026-06' });
    const before = charges.filter((c) => c.head === 'transport');
    const res = await request(app)
      .post('/api/transport/stop')
      .set(as('admin'))
      .send({ studentId: ID, fromMonth: '2026-08', reason: 'shifted' });
    expect(res.status).toBe(200);
    expect(student).toMatchObject({ usesTransport: false, transportUntil: '2026-07' });
    const after = charges.filter((c) => c.head === 'transport');
    expect(after.every((c) => c.period < '2026-08')).toBe(true);
    expect(res.body.removedMonths).toBe(before.length - after.length);
  });
  it('stop is refused when a month to be removed is already paid; needs a reason', async () => {
    const { app, charges } = build();
    await request(app)
      .post('/api/transport/enroll')
      .set(as('admin'))
      .send({ studentId: ID, village: 'BORI', fromMonth: '2026-06' });
    // Rebuild the app so the receipt fake knows which charge is paid.
    const paid = build({ usedChargeIds: [] });
    expect(charges.length).toBeGreaterThan(0);
    const t = build({ usedChargeIds: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'] });
    await request(t.app)
      .post('/api/transport/enroll')
      .set(as('admin'))
      .send({ studentId: ID, village: 'BORI', fromMonth: '2026-06' });
    const blocked = await request(t.app)
      .post('/api/transport/stop')
      .set(as('admin'))
      .send({ studentId: ID, fromMonth: '2026-06', reason: 'left' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('MONTH_ALREADY_PAID');
    expect(paid.removed).toEqual([]);
    const noReason = await request(app)
      .post('/api/transport/stop')
      .set(as('admin'))
      .send({ studentId: ID, fromMonth: '2026-08', reason: 'x' });
    expect(noReason.status).toBe(400);
  });
});

describe('the bus fee follows the Transport module', () => {
  const base = { _id: 's', classKey: '5th', village: 'DHANORA', usesTransport: true };
  const bus = (s) =>
    chargesForStudent({ student: s, chart, fy: '2026-27', kinds: ['transport'], asOf: null }).map(
      (c) => c.period,
    );
  it('a student flagged on the bus but not entered in the module is charged nothing', () => {
    expect(bus(base)).toEqual([]);
  });
  it('charges only from the start month to the stop month', () => {
    const all = bus({ ...base, transportFrom: '2026-06' });
    expect(all[0]).toBe('2026-06');
    const part = bus({ ...base, transportFrom: '2026-06', transportUntil: '2026-08' });
    expect(part.at(-1)).toBe('2026-08');
    expect(part.length).toBeLessThan(all.length);
  });
});
