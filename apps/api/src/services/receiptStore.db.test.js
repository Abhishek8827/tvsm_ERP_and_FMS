import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Receipt } from '../models/Receipt.js';
import { makeReceiptStore } from './stores.js';

/**
 * Real-database test of the riskiest code in the system: issuing a receipt inside a transaction
 * (gap-free numbers, idempotency, rollback, immutability). Uses an in-memory MongoDB replica set
 * (transactions need one). Where no mongod can be downloaded the tests are skipped, loudly.
 */
let repl;
try {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
} catch (err) {
  console.warn('[receiptStore.db.test] no mongod available, DB tests skipped:', err.message);
}
const haveDb = repl !== undefined;
const store = makeReceiptStore();
const T = 'tvsm';
const FY = '2026-27';

beforeAll(async () => {
  if (!repl) return;
  await mongoose.connect(repl.getUri(), { dbName: 'test' });
  // Make sure indexes exist (unique number / key) before the first insert.
  await Receipt.init();
}, 120_000);
afterAll(async () => {
  if (!repl) return;
  await mongoose.disconnect();
  await repl.stop();
});

const doc = (extra = {}) => ({
  lines: [{ head: 'tuition', amountPaise: 100000 }],
  totalPaise: 100000,
  dueAfterPaise: 0,
  mode: 'cash',
  cashierId: 'c1',
  student: { admissionNo: '1', name: 'A' },
  ...extra,
});
const issue = (studentId, kind, key, build = async () => doc(), audit) =>
  store.issue({ tenantId: T, studentId, fy: FY, kind, idempotencyKey: key, build, audit });

describe.skipIf(!haveDb)('receipt store on a real database', () => {
  it('gives gap-free numbers per kind, in order', async () => {
    const sid = new mongoose.Types.ObjectId();
    const a = await issue(sid, 'school', 'k-seq-1');
    const b = await issue(sid, 'school', 'k-seq-2');
    const t = await issue(sid, 'transport', 'k-seq-3');
    expect(a.receipt.seq + 1).toBe(b.receipt.seq);
    expect(b.receipt.number).toBe(`S-FY${FY}/${String(b.receipt.seq).padStart(4, '0')}`);
    expect(t.receipt.number).toBe(`T-FY${FY}/0001`);
  });

  it('the same Idempotency-Key returns the same receipt and creates nothing new', async () => {
    const sid = new mongoose.Types.ObjectId();
    const first = await issue(sid, 'school', 'k-idem');
    const again = await issue(sid, 'school', 'k-idem');
    expect(again.replay).toBe(true);
    expect(String(again.receipt._id)).toBe(String(first.receipt._id));
    expect(await Receipt.countDocuments({ tenantId: T, idempotencyKey: 'k-idem' })).toBe(1);
  });

  it('a refused payment (build throws) saves nothing and does not use up a number', async () => {
    const sid = new mongoose.Types.ObjectId();
    const before = await issue(sid, 'school', 'k-before');
    await expect(
      issue(sid, 'school', 'k-refused', async () => {
        throw new Error('rule broken');
      }),
    ).rejects.toThrow('rule broken');
    const after = await issue(sid, 'school', 'k-after');
    expect(after.receipt.seq).toBe(before.receipt.seq + 1);
    expect(await Receipt.countDocuments({ tenantId: T, idempotencyKey: 'k-refused' })).toBe(0);
  });

  it('if the audit entry cannot be saved, the receipt is rolled back too', async () => {
    const sid = new mongoose.Types.ObjectId();
    await expect(
      issue(
        sid,
        'school',
        'k-noaudit',
        async () => doc(),
        async () => {
          throw new Error('audit down');
        },
      ),
    ).rejects.toThrow('audit down');
    expect(await Receipt.countDocuments({ tenantId: T, idempotencyKey: 'k-noaudit' })).toBe(0);
  });

  it('five payments at the same moment get five different numbers with no gaps', async () => {
    const sid = new mongoose.Types.ObjectId();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => issue(sid, 'school', `k-par-${n}`)),
    );
    const seqs = results.map((r) => r.receipt.seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(5);
    expect(seqs[4] - seqs[0]).toBe(4);
  });

  it('an issued receipt can never be changed or deleted', async () => {
    const sid = new mongoose.Types.ObjectId();
    const { receipt } = await issue(sid, 'school', 'k-immutable');
    await expect(
      Receipt.updateOne({ tenantId: T, _id: receipt._id }, { totalPaise: 1 }).exec(),
    ).rejects.toThrow(/immutable/);
    await expect(Receipt.deleteMany({ tenantId: T }).exec()).rejects.toThrow(/immutable/);
  });

  it('a cancelled receipt stops counting; a request can become the Admin cancellation; no double cancel', async () => {
    const sid = new mongoose.Types.ObjectId();
    const { receipt } = await issue(sid, 'school', 'k-cancel');
    const user = { id: 'u1', name: 'Cashier' };
    const asked = await store.requestCancel({ tenantId: T, receipt, reason: 'Wrong amount', user });
    expect(asked.status).toBe('requested');
    expect(await store.requestCancel({ tenantId: T, receipt, reason: 'again', user })).toBeNull();
    expect((await store.findById(T, receipt._id)).cancellation.status).toBe('requested');
    expect(await store.listForStudent(T, sid, FY)).toHaveLength(1); // still counts until cancelled
    const done = await store.cancelDirect({
      tenantId: T,
      receipt,
      reason: 'Wrong amount',
      user: { id: 'a1', name: 'Admin' },
    });
    expect(done.status).toBe('cancelled');
    expect(await store.cancelDirect({ tenantId: T, receipt, reason: 'again', user })).toBeNull();
    expect(await store.listForStudent(T, sid, FY)).toHaveLength(0);
    const list = await store.list({ tenantId: T, status: 'cancelled', page: 1, pageSize: 50 });
    expect(list.rows.some((r) => String(r._id) === String(receipt._id))).toBe(true);
  });
});
