import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Student } from '../models/Student.js';
import { TransferCertificate } from '../models/TransferCertificate.js';
import { makeCertificateStore } from './certificateStore.js';

/**
 * Real-database tests of TC and Bonafide numbering: gap-free Sl. No. / Bonafide numbers,
 * idempotent retries, one TC per student, rollback when the audit write fails, cancel.
 * Needs an in-memory MongoDB replica set (transactions); skipped loudly where none is available.
 */
let repl;
try {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
} catch (err) {
  console.warn('[certificateStore.db.test] no mongod available, DB tests skipped:', err.message);
}
const haveDb = repl !== undefined;
const store = makeCertificateStore();
const FY = '2026-27';
const user = { id: 'u1', name: 'Admin' };
let n = 0;
const fresh = () => `t${(n += 1)}-${Date.now()}`;
const key = () => `key-${(n += 1)}-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  if (!repl) return;
  await mongoose.connect(repl.getUri(), { dbName: 'test' });
  await mongoose.syncIndexes();
}, 120_000);
afterAll(async () => {
  if (!repl) return;
  await mongoose.disconnect();
  await repl.stop();
});

const mkStudent = (T, no) =>
  Student.create({
    tenantId: T,
    admissionNo: String(no),
    name: `Student ${no}`,
    nameLower: `student ${no}`,
    classKey: '7',
    status: 'active',
  });
const issueTc = (T, student, extra = {}) =>
  store.issueTc({
    tenantId: T,
    studentId: student._id,
    fy: FY,
    startSl: 143,
    idempotencyKey: extra.key ?? key(),
    user,
    prepare: async (fresh, hasActive) => {
      if (hasActive) throw new Error('TC_EXISTS');
      return {
        doc: {
          bookNo: '7',
          snapshot: { admissionNo: fresh.admissionNo, name: fresh.name },
          entered: {},
        },
        studentPatch: { status: 'inactive', inactiveReason: 'left_with_tc' },
      };
    },
    audit: extra.audit,
  });
const issueBon = (T, student, k = key()) =>
  store.issueBonafide({
    tenantId: T,
    studentId: student._id,
    fy: FY,
    idempotencyKey: k,
    user,
    prepare: async (s) => ({
      snapshot: { admissionNo: s.admissionNo, name: s.name },
      academicYear: FY,
      purpose: 'Passport',
      dateOfIssue: '2026-10-13',
      makeNumber: (seq) => `BON/FY${FY}/${String(seq).padStart(3, '0')}`,
    }),
  });

describe.skipIf(!haveDb)('certificate store on a real database', () => {
  it('Sl. No. starts at the configured number and then has no gaps', async () => {
    const T = fresh();
    const a = await issueTc(T, await mkStudent(T, 1));
    const b = await issueTc(T, await mkStudent(T, 2));
    const c = await issueTc(T, await mkStudent(T, 3));
    expect([a.tc.slNo, b.tc.slNo, c.tc.slNo]).toEqual([143, 144, 145]);
  });

  it('the same Idempotency-Key returns the first TC and uses no number', async () => {
    const T = fresh();
    const s = await mkStudent(T, 1);
    const k = key();
    const one = await issueTc(T, s, { key: k });
    const two = await issueTc(T, s, { key: k });
    expect(two.replay).toBe(true);
    expect(String(two.tc._id)).toBe(String(one.tc._id));
    const next = await issueTc(T, await mkStudent(T, 2));
    expect(next.tc.slNo).toBe(144);
  });

  it('a student can have only one valid TC; a refused attempt uses no number', async () => {
    const T = fresh();
    const s = await mkStudent(T, 1);
    await issueTc(T, s);
    await expect(issueTc(T, s)).rejects.toThrow('TC_EXISTS');
    const next = await issueTc(T, await mkStudent(T, 2));
    expect(next.tc.slNo).toBe(144);
  });

  it('issuing makes the student inactive (left_with_tc)', async () => {
    const T = fresh();
    const s = await mkStudent(T, 1);
    await issueTc(T, s);
    const after = await Student.findOne({ tenantId: T, _id: s._id }).lean();
    expect(after).toMatchObject({ status: 'inactive', inactiveReason: 'left_with_tc' });
  });

  it('a failing audit rolls everything back: no TC, student unchanged, number not used', async () => {
    const T = fresh();
    const s = await mkStudent(T, 1);
    await expect(
      issueTc(T, s, {
        audit: async () => {
          throw new Error('audit down');
        },
      }),
    ).rejects.toThrow('audit down');
    expect(await TransferCertificate.countDocuments({ tenantId: T })).toBe(0);
    expect((await Student.findOne({ tenantId: T, _id: s._id }).lean()).status).toBe('active');
    expect((await issueTc(T, s)).tc.slNo).toBe(143);
  });

  it('parallel TCs for different students get different, consecutive numbers', async () => {
    const T = fresh();
    const students = await Promise.all([1, 2, 3, 4].map((i) => mkStudent(T, i)));
    const done = await Promise.all(students.map((s) => issueTc(T, s)));
    expect(done.map((d) => d.tc.slNo).sort((x, y) => x - y)).toEqual([143, 144, 145, 146]);
  });

  it('two parallel requests for ONE student make exactly one TC', async () => {
    const T = fresh();
    const s = await mkStudent(T, 1);
    const results = await Promise.allSettled([issueTc(T, s), issueTc(T, s)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await TransferCertificate.countDocuments({ tenantId: T, status: 'issued' })).toBe(1);
  });

  it('cancel keeps the number, reactivates the student and cannot be done twice', async () => {
    const T = fresh();
    const s = await mkStudent(T, 1);
    const { tc } = await issueTc(T, s);
    const cancelled = await store.cancelTc({ tenantId: T, id: tc._id, reason: 'mistake', user });
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'mistake', slNo: 143 });
    expect(await Student.findOne({ tenantId: T, _id: s._id }).lean()).toMatchObject({
      status: 'active',
      inactiveReason: null,
    });
    expect(await store.cancelTc({ tenantId: T, id: tc._id, reason: 'again', user })).toBeNull();
    // the number stays used: the next TC is 144, not 143
    expect((await issueTc(T, await mkStudent(T, 2))).tc.slNo).toBe(144);
  });

  it('a printed TC cannot be edited (immutable fields)', async () => {
    const T = fresh();
    const { tc } = await issueTc(T, await mkStudent(T, 1));
    await TransferCertificate.updateOne({ tenantId: T, _id: tc._id }, { $set: { slNo: 999 } });
    expect((await TransferCertificate.findOne({ tenantId: T, _id: tc._id }).lean()).slNo).toBe(143);
  });

  it('duplicate copies are counted', async () => {
    const T = fresh();
    const { tc } = await issueTc(T, await mkStudent(T, 1));
    expect((await store.reprintTc(T, tc._id)).duplicateCount).toBe(1);
    expect((await store.reprintTc(T, tc._id)).duplicateCount).toBe(2);
  });

  it('Bonafide numbers run 001, 002 ... per year and a retry reuses the first', async () => {
    const T = fresh();
    const s = await mkStudent(T, 1);
    const k = key();
    const a = await issueBon(T, s, k);
    const again = await issueBon(T, s, k);
    const b = await issueBon(T, s);
    expect(a.bonafide.number).toBe('BON/FY2026-27/001');
    expect(again.replay).toBe(true);
    expect(b.bonafide.number).toBe('BON/FY2026-27/002');
  });

  it('the TC and Bonafide series are independent', async () => {
    const T = fresh();
    const s = await mkStudent(T, 1);
    await issueBon(T, s);
    expect((await issueTc(T, s)).tc.slNo).toBe(143);
  });
});
