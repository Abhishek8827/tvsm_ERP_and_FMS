import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const as = (t) => ({ Authorization: `Bearer ${t}` });
const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const chart = {
  fy: '2026-27', formFeePaise: 10000, dueDay: 15, graceDays: 10, lateFeePaise: 10000,
  classFees: [{ classKey: '7', monthlyTuitionPaise: 70000, admissionPaise: 100000 }],
  villages: [],
}; // prettier-ignore

const full = {
  fatherName: 'Rajesh', motherName: 'Sunita', category: 'General',
  dateOfBirth: new Date('2014-03-14T00:00:00Z'), firstAdmissionDate: new Date('2019-07-04T00:00:00Z'),
  firstAdmissionClass: '1', nationality: 'Indian',
}; // prettier-ignore
const body = (o = {}) => ({
  studentId: A, lastExam: 'Annual 2025-26, Passed', failedInSameClass: 'No',
  subjects: 'English, Hindi', qualifiedForPromotion: 'Yes, to next class', workingDays: 220,
  daysPresent: 198, conduct: 'Good', dateOfApplication: '2026-10-12', dateOfIssue: '2026-10-13',
  reason: 'Parent Request', ...o,
}); // prettier-ignore

function build({ charges = [] } = {}) {
  const audit = [];
  const students = {
    [A]: { _id: A, name: 'Aarav', admissionNo: '412', classKey: '7', section: 'A', status: 'active', gender: 'MALE', ...full },
    [B]: { _id: B, name: 'Bare', admissionNo: '9', classKey: '7', status: 'active' },
    ['c'.repeat(24)]: { _id: 'c'.repeat(24), name: 'Left', admissionNo: '3', classKey: '7', status: 'inactive', ...full },
  }; // prettier-ignore
  const tcs = [];
  const bons = [];
  let sl = 0;
  const settings = { tcBookNo: '7', tcStartSl: 143 };
  const certificateStore = {
    getSettings: async () => settings,
    saveSettings: async ({ tcBookNo, tcStartSl }) => Object.assign(settings, { tcBookNo, tcStartSl }),
    countTcInFy: async () => tcs.length,
    activeTcForStudent: async (_t, id) => tcs.find((t) => t.studentId === id && t.status === 'issued'),
    findTcByKey: async (_t, k) => tcs.find((t) => t.idempotencyKey === k),
    findBonafideByKey: async (_t, k) => bons.find((t) => t.idempotencyKey === k),
    async issueTc({ studentId, fy, startSl, idempotencyKey, prepare, audit: au }) {
      const student = students[studentId];
      const { doc, studentPatch } = await prepare(student, tcs.some((t) => t.studentId === studentId && t.status === 'issued'));
      sl = sl === 0 ? startSl : sl + 1;
      const tc = { ...doc, _id: `${'0'.repeat(21)}${sl}`, fy, slNo: sl, studentId, status: 'issued', idempotencyKey, duplicateCount: 0 };
      tcs.push(tc);
      Object.assign(student, studentPatch);
      await au(tc);
      return { tc, replay: false };
    },
    listTc: async () => ({ rows: tcs, total: tcs.length }),
    getTc: async (_t, id) => tcs.find((t) => t._id === id),
    reprintTc: async (_t, id) => {
      const t = tcs.find((x) => x._id === id && x.status === 'issued');
      if (t) t.duplicateCount += 1;
      return t;
    },
    async cancelTc({ id, reason, audit: au }) {
      const t = tcs.find((x) => x._id === id && x.status === 'issued');
      if (!t) return null;
      Object.assign(t, { status: 'cancelled', cancelReason: reason });
      Object.assign(students[t.studentId], { status: 'active', inactiveReason: null });
      await au(t);
      return t;
    },
    async issueBonafide({ studentId, fy, idempotencyKey, prepare, audit: au }) {
      const { makeNumber, ...doc } = await prepare(students[studentId]);
      const seq = bons.length + 1;
      const b = { ...doc, _id: `${'1'.repeat(23)}${seq}`, fy, seq, number: makeNumber(seq), studentId, status: 'issued', idempotencyKey };
      bons.push(b);
      await au(b);
      return { bonafide: b, replay: false };
    },
    listBonafide: async () => ({ rows: bons, total: bons.length }),
    getBonafide: async (_t, id) => bons.find((t) => t._id === id),
    reprintBonafide: async (_t, id) => {
      const b = bons.find((x) => x._id === id);
      if (b) b.duplicateCount = (b.duplicateCount ?? 0) + 1;
      return b;
    },
  }; // prettier-ignore
  const auth = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: { findByFirebaseUid: async (_t, uid) => users[uid], touchLogin: async () => {} },
    auditStore: { append: async (e) => audit.push(e) },
    studentStore: { findById: async (_t, id) => students[id] ?? null },
    feeStore: { get: async () => chart },
    receiptStore: { listForStudent: async () => [] },
    chargeStore: { listForStudent: async () => charges.map((c, i) => ({ ...c, _id: `c${i}` })) },
    rebateStore: {
      listForStudent: async () => [
        { status: 'active', fy: '2026-27', kind: 'school', category: 'bc', reason: 'Sibling 2' },
      ],
    },
    certificateStore,
  };
  return { app: createApp(env, createLogger('silent'), auth), audit, students, tcs, settings };
}
const dueCharge = [
  { head: 'tuition', period: '2026-04', dueDate: '2026-04-15', amountPaise: 70000 },
];
const post = (app, who, key, b) =>
  request(app).post('/api/tc').set(as(who)).set('Idempotency-Key', key).send(b);

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-13T06:00:00Z') }));
afterEach(() => vi.useRealTimers());

describe('Transfer Certificate', () => {
  it('only the Admin may generate, reprint, cancel or open the draft (others get 403)', async () => {
    const { app } = build();
    for (const who of ['principal', 'cashier']) {
      expect((await post(app, who, 'key-12345678', body())).status).toBe(403);
      expect((await request(app).get(`/api/tc/draft/${A}`).set(as(who))).status).toBe(403);
      expect(
        (await request(app).post('/api/tc/000000000000000000000001/reprint').set(as(who))).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/tc/000000000000000000000001/cancel')
            .set(as(who))
            .send({ reason: 'abc' })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .put('/api/certificates/settings')
            .set(as(who))
            .send({ tcBookNo: '1', tcStartSl: 1 })
        ).status,
      ).toBe(403);
    }
  });

  it('Principal and Cashier can list and view', async () => {
    const { app } = build();
    await post(app, 'admin', 'key-12345678', body());
    for (const who of ['principal', 'cashier']) {
      const l = await request(app).get('/api/tc').set(as(who));
      expect(l.status).toBe(200);
      expect(l.body.rows).toHaveLength(1);
      expect((await request(app).get('/api/tc/000000000000000000000143').set(as(who))).status).toBe(
        200,
      );
    }
  });

  it('issues with the first Sl. No. from settings, prints the snapshot and makes the student inactive', async () => {
    const { app, students, audit } = build();
    const r = await post(app, 'admin', 'key-12345678', body());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ slNo: 143, bookNo: '7', status: 'issued' });
    expect(r.body.snapshot).toMatchObject({
      name: 'Aarav',
      dob: '2014-03-14',
      dobInWords: 'Fourteenth March Two Thousand Fourteen',
      lastClassInWords: '7 (Seventh)',
      firstAdmissionClass: '1st',
      duesPaidUpto: 'Nil',
      feeConcession: 'BC (sibling) - Sibling 2',
    });
    expect(students[A]).toMatchObject({ status: 'inactive', inactiveReason: 'left_with_tc' });
    expect(audit.some((a) => a.action === 'issue' && a.entity === 'transfer_certificate')).toBe(
      true,
    );
  });

  it('a retry with the same Idempotency-Key returns the same TC, not a second one', async () => {
    const { app, tcs } = build();
    const one = await post(app, 'admin', 'key-12345678', body());
    const two = await post(app, 'admin', 'key-12345678', body());
    expect(two.status).toBe(200);
    expect(two.body).toMatchObject({ id: one.body.id, replay: true });
    expect(tcs).toHaveLength(1);
  });

  it('needs the Idempotency-Key header', async () => {
    const { app } = build();
    expect((await request(app).post('/api/tc').set(as('admin')).send(body())).status).toBe(400);
  });

  it('a second TC for the same student is refused', async () => {
    const { app } = build();
    await post(app, 'admin', 'key-12345678', body());
    const r = await post(app, 'admin', 'key-87654321', body());
    expect(r.status).toBe(409);
    expect(r.body.error?.code ?? r.body.code).toBe('TC_EXISTS');
  });

  it('blocks when fees are due and lets the Admin override with a reason (audited)', async () => {
    const { app, audit } = build({ charges: dueCharge });
    const blocked = await post(app, 'admin', 'key-12345678', body());
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain('DUES_PENDING');
    const shortReason = await post(
      app,
      'admin',
      'key-22222222',
      body({ duesOverrideReason: 'ok' }),
    );
    expect(shortReason.status).toBe(400);
    const done = await post(
      app,
      'admin',
      'key-33333333',
      body({ duesOverrideReason: 'Principal allowed' }),
    );
    expect(done.status).toBe(201);
    expect(done.body.duesOverride).toMatchObject({ reason: 'Principal allowed' });
    expect(done.body.duesOverride.duePaise).toBeGreaterThan(0);
    expect(audit.find((a) => a.action === 'override')?.reason).toBe('Principal allowed');
  });

  it('draft shows pending dues and the defaults; missing fields are listed', async () => {
    const { app } = build({ charges: dueCharge });
    const d = await request(app).get(`/api/tc/draft/${A}`).set(as('admin'));
    expect(d.status).toBe(200);
    expect(d.body.pendingPaise).toBeGreaterThan(0);
    expect(d.body).toMatchObject({ bookNo: '7', nextSl: 143, missing: [] });
    expect(d.body.defaults.qualifiedForPromotion).toBe('Yes, to next class');
    const bare = await request(app).get(`/api/tc/draft/${B}`).set(as('admin'));
    expect(bare.body.missing.map((m) => m.key)).toEqual(
      expect.arrayContaining([
        'fatherName',
        'motherName',
        'dateOfBirth',
        'category',
        'firstAdmissionDate',
      ]),
    );
  });

  it('refuses while student details are missing, then saves what the Admin typed back to the student', async () => {
    const { app, students } = build();
    const miss = await post(app, 'admin', 'key-12345678', body({ studentId: B }));
    expect(miss.status).toBe(400);
    expect(Object.keys(miss.body.error?.fields ?? miss.body.fields ?? {})).toContain('fatherName');
    const filled = await post(
      app,
      'admin',
      'key-11111111',
      body({
        studentId: B,
        fatherName: 'Ram',
        motherName: 'Sita',
        category: 'OBC',
        dateOfBirth: '2013-05-01',
        firstAdmissionDate: '2018-07-01',
        firstAdmissionClass: '1',
      }),
    );
    expect(filled.status).toBe(201);
    expect(filled.body.snapshot).toMatchObject({
      fatherName: 'Ram',
      dob: '2013-05-01',
      nationality: 'Indian',
    });
    expect(students[B]).toMatchObject({ fatherName: 'Ram', category: 'OBC', status: 'inactive' });
    const r = await post(app, 'admin', 'key-87654321', body({ aparId: '1234-5678', pen: 'P1' }));
    expect(r.status).toBe(201);
    expect(students[A]).toMatchObject({ aparId: '1234-5678', pen: 'P1' });
  });

  it('days present cannot be more than working days; compulsory fields are enforced', async () => {
    const { app } = build();
    expect((await post(app, 'admin', 'key-12345678', body({ daysPresent: 300 }))).status).toBe(400);
    expect((await post(app, 'admin', 'key-12345679', body({ lastExam: '' }))).status).toBe(400);
    expect((await post(app, 'admin', 'key-12345670', body({ conduct: 'Bad' }))).status).toBe(400);
  });

  it('duplicate copy counts up and is audited; cancel reactivates the student and needs a reason', async () => {
    const { app, students, audit } = build();
    const tc = (await post(app, 'admin', 'key-12345678', body())).body;
    const dup = await request(app).post(`/api/tc/${tc.id}/reprint`).set(as('admin'));
    expect(dup.body).toMatchObject({ duplicateCount: 1, copyNo: 1 });
    expect(audit.some((a) => a.action === 'reprint')).toBe(true);
    expect(
      (await request(app).post(`/api/tc/${tc.id}/cancel`).set(as('admin')).send({ reason: 'x' }))
        .status,
    ).toBe(400);
    const c = await request(app)
      .post(`/api/tc/${tc.id}/cancel`)
      .set(as('admin'))
      .send({ reason: 'Issued by mistake' });
    expect(c.body).toMatchObject({ status: 'cancelled', cancelReason: 'Issued by mistake' });
    expect(students[A]).toMatchObject({ status: 'active', inactiveReason: null });
    expect((await request(app).post(`/api/tc/${tc.id}/reprint`).set(as('admin'))).status).toBe(404);
  });

  it('an already inactive student may still get a TC', async () => {
    const { app } = build();
    const r = await post(app, 'admin', 'key-12345678', body({ studentId: 'c'.repeat(24) }));
    expect(r.status).toBe(201);
  });
});

describe('Bonafide', () => {
  const bon = (app, who, key, b) =>
    request(app).post('/api/bonafide').set(as(who)).set('Idempotency-Key', key).send(b);
  it('Admin generates BON/FY2026-27/001 even with dues; Principal and Cashier cannot', async () => {
    const { app } = build({ charges: dueCharge });
    for (const who of ['principal', 'cashier'])
      expect(
        (await bon(app, who, 'key-12345678', { studentId: A, purpose: 'Passport' })).status,
      ).toBe(403);
    const r = await bon(app, 'admin', 'key-12345678', { studentId: A, purpose: 'Passport' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      number: 'BON/FY2026-27/001',
      academicYear: '2026-27',
      dateOfIssue: '2026-10-13',
    });
    expect(r.body.snapshot).toMatchObject({ name: 'Aarav', dob: '2014-03-14', gender: 'MALE' });
    const next = await bon(app, 'admin', 'key-87654321', { studentId: A, purpose: 'Bank' });
    expect(next.body.number).toBe('BON/FY2026-27/002');
  });
  it('only for active students', async () => {
    const { app } = build();
    const r = await bon(app, 'admin', 'key-12345678', {
      studentId: 'c'.repeat(24),
      purpose: 'Passport',
    });
    expect(r.status).toBe(409);
  });
  it('a purpose is required', async () => {
    const { app } = build();
    expect((await bon(app, 'admin', 'key-12345678', { studentId: A, purpose: '' })).status).toBe(
      400,
    );
  });
  it('everyone can list; only the Admin can print a duplicate', async () => {
    const { app } = build();
    const b = (await bon(app, 'admin', 'key-12345678', { studentId: A, purpose: 'Passport' })).body;
    expect((await request(app).get('/api/bonafide').set(as('cashier'))).body.total).toBe(1);
    expect(
      (await request(app).post(`/api/bonafide/${b.id}/reprint`).set(as('principal'))).status,
    ).toBe(403);
    expect(
      (await request(app).post(`/api/bonafide/${b.id}/reprint`).set(as('admin'))).body.copyNo,
    ).toBe(1);
  });
});

describe('TC settings', () => {
  it('Admin saves Book No. and start Sl. No.; the start is locked once a TC exists', async () => {
    const { app } = build();
    const put = (b) => request(app).put('/api/certificates/settings').set(as('admin')).send(b);
    expect((await put({ tcBookNo: '8', tcStartSl: 200 })).body).toMatchObject({
      tcBookNo: '8',
      tcStartSl: 200,
    });
    await post(app, 'admin', 'key-12345678', body());
    const locked = await put({ tcBookNo: '8', tcStartSl: 300 });
    expect(locked.status).toBe(409);
    expect((await put({ tcBookNo: '9', tcStartSl: 200 })).status).toBe(200); // Book No. may change
    const g = await request(app).get('/api/certificates/settings').set(as('cashier'));
    expect(g.body.startLocked).toBe(true);
  });
});
