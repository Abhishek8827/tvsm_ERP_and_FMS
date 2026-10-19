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
  let lastList = {};
  const removedCharges = [];
  const studentStore = {
    list: async ({ page, pageSize, sort, dir }) => {
      lastList = { sort, dir };
      return {
        rows: db.slice((page - 1) * pageSize, page * pageSize),
        total: db.length,
        counts: { active: db.length, inactive: 0, total: db.length },
        sections: ['A', 'B'],
      };
    },
    findById: async (_t, id) => db.find((s) => String(s._id) === id) ?? null,
    findManyByIds: async (_t, ids) => db.filter((s) => ids.includes(String(s._id))),
    deleteMany: async (_t, ids) => {
      let n = 0;
      for (let i = db.length - 1; i >= 0; i -= 1)
        if (ids.includes(String(db[i]._id))) {
          db.splice(i, 1);
          n += 1;
        }
      return n;
    },
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
    chargeStore: {
      deleteForStudents: async (_t, ids) => {
        removedCharges.push(...ids);
      },
    },
  };
  return {
    app: createApp(env, createLogger('silent'), auth),
    audit,
    db,
    removedCharges,
    lastList: () => lastList,
  };
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
    expect(admin).toMatchObject({ aadhaar: '123412341234', bankAccount: '9988776655' });
    expect(principal.aadhaarLast4).toBe('1234');
    expect(principal.bankAccount).toBeUndefined();
    expect(cashier.aadhaarLast4).toBeUndefined();
    // Only the Admin response may contain the full numbers.
    expect(JSON.stringify([principal, cashier])).not.toMatch(/123412341234|9988776655/);
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
  it('list returns active / inactive / total counts and the sections, default sort is scholar number', async () => {
    const { app, lastList } = build();
    await request(app).post('/api/students').set(as('admin')).send(valid);
    const res = await request(app).get('/api/students').set(as('cashier'));
    expect(res.body.counts).toMatchObject({ active: 1, inactive: 0, total: 1 });
    expect(res.body.sections).toEqual(['A', 'B']);
    expect(lastList()).toMatchObject({ sort: 'admissionNo', dir: 'asc' });
    await request(app).get('/api/students?sort=name&dir=desc').set(as('cashier'));
    expect(lastList()).toMatchObject({ sort: 'name', dir: 'desc' });
    for (const field of ['class', 'section', 'village', 'status']) {
      expect(
        (await request(app).get(`/api/students?sort=${field}`).set(as('cashier'))).status,
      ).toBe(200);
      expect(lastList()).toMatchObject({ sort: field });
    }
    expect((await request(app).get('/api/students?sort=salary').set(as('cashier'))).status).toBe(
      400,
    );
  });

  it('bulk delete: 403 for Principal and Cashier', async () => {
    const { app } = build();
    for (const r of ['principal', 'cashier'])
      expect(
        (
          await request(app)
            .post('/api/students/bulk-delete')
            .set(as(r))
            .send({ ids: ['a'.repeat(24)], reason: 'test' })
        ).status,
      ).toBe(403);
  });

  it('bulk delete needs a reason and valid ids', async () => {
    const { app } = build();
    const noReason = await request(app)
      .post('/api/students/bulk-delete')
      .set(as('admin'))
      .send({ ids: ['a'.repeat(24)] });
    expect(noReason.status).toBe(400);
    const badId = await request(app)
      .post('/api/students/bulk-delete')
      .set(as('admin'))
      .send({ ids: ['x'], reason: 'duplicate entry' });
    expect(badId.status).toBe(400);
  });

  it('bulk delete removes the students for good, frees the scholar number, audits each one first, and is safe to repeat', async () => {
    const { app, audit, db, removedCharges } = build();
    await request(app).post('/api/students').set(as('admin')).send(valid);
    await request(app)
      .post('/api/students')
      .set(as('admin'))
      .send({ ...valid, admissionNo: '1054', name: 'Bhumi' });
    db[0]._id = 'a'.repeat(24);
    db[1]._id = 'b'.repeat(24);
    const ids = [db[0]._id, db[1]._id];
    const res = await request(app)
      .post('/api/students/bulk-delete')
      .set(as('admin'))
      .send({ ids, reason: 'duplicate entry' });
    expect(res.body).toEqual({ deleted: 2, requested: 2 });
    const entries = audit.filter((a) => a.action === 'delete');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      entity: 'student',
      reason: 'duplicate entry',
      oldValue: { admissionNo: '1053', name: 'Aarav Sharma' },
    });
    expect(removedCharges).toEqual(ids);
    expect(db).toHaveLength(0);
    expect((await request(app).get('/api/students').set(as('admin'))).body.total).toBe(0);
    expect((await request(app).get(`/api/students/${ids[0]}`).set(as('admin'))).status).toBe(404);
    // the same scholar number can be used again
    expect((await request(app).post('/api/students').set(as('admin')).send(valid)).status).toBe(
      201,
    );
    // asking again for the old ids: nothing left to delete
    expect(
      (
        await request(app)
          .post('/api/students/bulk-delete')
          .set(as('admin'))
          .send({ ids, reason: 'again' })
      ).status,
    ).toBe(404);
  });
});
