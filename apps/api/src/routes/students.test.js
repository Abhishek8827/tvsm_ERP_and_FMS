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

function build() {
  const audit = [];
  const db = [];
  const studentStore = {
    list: async ({ page, pageSize }) => ({
      rows: db.slice((page - 1) * pageSize, page * pageSize),
      total: db.length,
    }),
    findById: async (_t, id) => db.find((s) => String(s._id) === id) ?? null,
    create: async (_t, data) => {
      if (db.some((s) => s.admissionNo === data.admissionNo))
        throw Object.assign(new Error('dup'), { code: 11000 });
      const s = { ...data, _id: `s${db.length + 1}` };
      db.push(s);
      return s;
    },
    update: async (_t, id, data) =>
      Object.assign(
        db.find((s) => s._id === id),
        data,
      ),
  };
  const auth = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid] ?? null,
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    studentStore,
  };
  return { app: createApp(env, createLogger('silent'), auth), audit, db };
}
const as = (t) => ({ Authorization: `Bearer ${t}` });
const valid = {
  admissionNo: '1053',
  name: 'Aarav Sharma',
  classKey: 'NURSERY',
  aadhaar: '123412341234',
  bankAccount: '9988776655',
  ifsc: 'sbin0001',
  isNewAdmission: true,
};

describe('students API', () => {
  it('401 without a token', async () => {
    expect((await request(build().app).get('/api/students')).status).toBe(401);
  });
  it('403 when Principal or Cashier tries to create', async () => {
    const { app } = build();
    for (const r of ['principal', 'cashier'])
      expect((await request(app).post('/api/students').set(as(r)).send(valid)).status).toBe(403);
  });
  it('Admin creates, audit is written, duplicate admission no is 409', async () => {
    const { app, audit } = build();
    const ok = await request(app).post('/api/students').set(as('admin')).send(valid);
    expect(ok.status).toBe(201);
    expect(audit.at(-1)).toMatchObject({ action: 'create', entity: 'student' });
    const dup = await request(app).post('/api/students').set(as('admin')).send(valid);
    expect(dup.status).toBe(409);
  });
  it('field-level validation errors', async () => {
    const { app } = build();
    const res = await request(app)
      .post('/api/students')
      .set(as('admin'))
      .send({ ...valid, aadhaar: '12', classKey: '11', usesTransport: true });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['aadhaar']));
    const res2 = await request(app)
      .post('/api/students')
      .set(as('admin'))
      .send({ ...valid, classKey: '11', usesTransport: true });
    expect(res2.body.error.fields).toMatchObject({
      stream: expect.any(String),
      village: expect.any(String),
    });
  });
  it('inactive needs a reason (left with / without TC)', async () => {
    const { app } = build();
    const res = await request(app)
      .post('/api/students')
      .set(as('admin'))
      .send({ ...valid, status: 'inactive' });
    expect(res.body.error.fields.inactiveReason).toBeTruthy();
  });
  it('sensitive fields are hidden by role', async () => {
    const { app } = build();
    await request(app).post('/api/students').set(as('admin')).send(valid);
    const admin = (await request(app).get('/api/students/s1').set(as('admin'))).body;
    const principal = (await request(app).get('/api/students/s1').set(as('principal'))).body;
    const cashier = (await request(app).get('/api/students/s1').set(as('cashier'))).body;
    expect(admin).toMatchObject({ aadhaarLast4: '1234', bankAccount: '9988776655' });
    expect(principal.aadhaarLast4).toBe('1234');
    expect(principal.bankAccount).toBeUndefined();
    expect(cashier.aadhaarLast4).toBeUndefined();
    expect(JSON.stringify([admin, principal, cashier])).not.toContain('123412341234');
  });
  it('Admin edit: audit has no Aadhaar/bank, clearing inactive clears reason', async () => {
    const { app, audit } = build();
    await request(app).post('/api/students').set(as('admin')).send(valid);
    const res = await request(app)
      .patch('/api/students/s1')
      .set(as('admin'))
      .send({ status: 'inactive', inactiveReason: 'left_with_tc', bankAccount: '111111' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(audit.at(-1))).not.toContain('111111');
    const back = await request(app)
      .patch('/api/students/s1')
      .set(as('admin'))
      .send({ status: 'active' });
    expect(back.body.inactiveReason).toBeNull();
  });
});
