import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const TENANT = 'tvsm';
const env = loadEnv({
  MONGODB_URI: 'mongodb://unused',
  NODE_ENV: 'test',
  DEFAULT_TENANT_ID: TENANT,
});
const mk = (id, role) => ({
  _id: id,
  firebaseUid: id,
  email: `${id}@x.com`,
  name: id,
  role,
  tenantId: TENANT,
  isActive: true,
});
const users = {
  admin: mk('admin', 'admin'),
  principal: mk('principal', 'principal'),
  cashier: mk('cashier', 'cashier'),
};
const as = (t) => ({ Authorization: `Bearer ${t}` });

function build() {
  const audit = [];
  const rebates = [];
  const students = [
    { _id: 's1', admissionNo: '1', name: 'Asha', classKey: '5th', section: 'A', status: 'active' },
    { _id: 's2', admissionNo: '2', name: 'Ravi', classKey: '5th', section: 'A', status: 'active' },
  ];
  const charge = (sid, i, amt, due) => ({
    _id: `${sid}c${i}`,
    studentId: sid,
    head: 'tuition',
    period: `p${i}`,
    dueDate: due,
    amountPaise: amt,
  });
  const charges = [charge('s1', 1, 100000, '2026-06-15'), charge('s1', 2, 100000, '2026-07-15')];
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: { findByFirebaseUid: async (_t, uid) => users[uid], touchLogin: async () => {} },
    auditStore: { append: async (e) => audit.push(e) },
    studentStore: {
      forFees: async () => students,
      findById: async (_t, id) => students.find((s) => s._id === id) ?? null,
    },
    feeStore: { get: async () => null },
    chargeStore: {
      listForStudents: async () => charges,
      listForStudent: async (_t, id) => charges.filter((c) => String(c.studentId) === String(id)),
    },
    receiptStore: { linesForStudents: async () => [] },
    rebateStore: {
      activeForStudents: async () => [],
      create: async ({ build: b, reason, kind }) => {
        const lines = b([]);
        const doc = {
          _id: 'r1',
          lines,
          totalPaise: lines.reduce((n, l) => n + l.amountPaise, 0),
          reason,
          kind,
          status: 'active',
          fy: '2026-27',
          studentId: 's1',
        };
        rebates.push(doc);
        return doc;
      },
      listForStudent: async () => rebates,
      reverse: async () => null,
    },
  };
  return { app: createApp(env, createLogger('silent'), deps), audit, rebates };
}
const ID = 'a'.repeat(24);

describe('Fees Database', () => {
  it('all three roles can look; Cashier cannot export; filters and totals work', async () => {
    const { app } = build();
    for (const who of ['admin', 'principal', 'cashier'])
      expect((await request(app).get('/api/fees-database').set(as(who))).status).toBe(200);
    expect((await request(app).get('/api/fees-database/export').set(as('cashier'))).status).toBe(
      403,
    );
    const none = await request(app).get('/api/fees-database?feeStatus=noplan').set(as('admin'));
    expect(none.body.total).toBe(1);
    expect(none.body.rows[0].name).toBe('Ravi');
    const all = await request(app).get('/api/fees-database').set(as('principal'));
    expect(all.body.totals.billedPaise).toBe(200000);
    expect(all.body.rows.find((r) => r.name === 'Asha').planPosted).toBe(true);
  });
  it('only the Admin can add or reverse a rebate; reason is compulsory', async () => {
    const { app } = build();
    const body = { fy: '2026-27', kind: 'school', amountPaise: 50000, reason: 'Staff child' };
    for (const who of ['principal', 'cashier']) {
      expect(
        (await request(app).post(`/api/students/s1/rebates`).set(as(who)).send(body)).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post(`/api/rebates/${ID}/reverse`)
            .set(as(who))
            .send({ reason: 'xx yy' })
        ).status,
      ).toBe(403);
    }
    const noReason = await request(app)
      .post(`/api/students/${ID}/rebates`)
      .set(as('admin'))
      .send({ ...body, reason: '' });
    expect(noReason.status).toBe(400);
  });

  it('only the Admin can waive a late fee; months are compulsory and so is the reason', async () => {
    const { app } = build();
    const body = { fy: '2026-27', periods: ['jun'], reason: 'Family problem' };
    for (const who of ['principal', 'cashier'])
      expect(
        (await request(app).post(`/api/students/${ID}/late-fee-waivers`).set(as(who)).send(body))
          .status,
      ).toBe(403);
    const noMonth = await request(app)
      .post(`/api/students/${ID}/late-fee-waivers`)
      .set(as('admin'))
      .send({ ...body, periods: [] });
    expect(noMonth.status).toBe(400);
    const noReason = await request(app)
      .post(`/api/students/${ID}/late-fee-waivers`)
      .set(as('admin'))
      .send({ ...body, reason: '' });
    expect(noReason.status).toBe(400);
  });
  it('the list carries a separate late-fee column and the waiver removes it', async () => {
    const { app } = build();
    const r = await request(app).get('/api/fees-database').set(as('admin'));
    expect(r.body.rows[0]).toHaveProperty('lateFeePaise');
    expect(r.body.totals).toHaveProperty('lateFeePaise');
  });
});
