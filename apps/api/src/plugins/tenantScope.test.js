import mongoose, { Schema } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerGlobalPlugins } from '../db.js';
/**
 * The "two-tenant leak test" (TDD 4.1 rule 3). Uses a real in-memory MongoDB replica set so
 * the hooks run against the real driver, not mocks.
 */
let repl;
// Some sandboxes cannot download the mongod binary. The guard tests below reject BEFORE any
// I/O, so they still run; only tests that need real data are skipped, loudly.
try {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
} catch (err) {
  console.warn('[tenantScope.test] no mongod available, DB-backed tests skipped:', err.message);
}
const haveDb = repl !== undefined;
registerGlobalPlugins(); // must happen before the model is compiled
const Thing = mongoose.model('Thing', new Schema({ name: String, amount: Number }));
beforeAll(async () => {
  if (!repl) return;
  await mongoose.connect(repl.getUri(), { dbName: 'test' });
  await Thing.insertMany([
    { tenantId: 'A', name: 'a1', amount: 100 },
    { tenantId: 'A', name: 'a2', amount: 200 },
    { tenantId: 'B', name: 'b1', amount: 999 },
  ]);
}, 120_000);
afterAll(async () => {
  if (!repl) return;
  await mongoose.disconnect();
  await repl.stop();
});
describe('tenantScope plugin', () => {
  it.skipIf(!haveDb)('scoped reads only see their own tenant', async () => {
    const a = await Thing.find({ tenantId: 'A' }).lean();
    expect(a.map((d) => d.name).sort()).toEqual(['a1', 'a2']);
    expect(await Thing.countDocuments({ tenantId: 'B' })).toBe(1);
  });
  it.each([
    ['find', () => Thing.find({})],
    ['findOne', () => Thing.findOne({ name: 'b1' })],
    ['countDocuments', () => Thing.countDocuments({})],
    ['distinct', () => Thing.distinct('name', {})],
    ['updateOne', () => Thing.updateOne({ name: 'a1' }, { amount: 1 })],
    ['updateMany', () => Thing.updateMany({}, { amount: 1 })],
    ['deleteOne', () => Thing.deleteOne({ name: 'a1' })],
    ['deleteMany', () => Thing.deleteMany({})],
    ['findOneAndUpdate', () => Thing.findOneAndUpdate({ name: 'a1' }, { amount: 1 })],
    ['replaceOne', () => Thing.replaceOne({ name: 'a1' }, { name: 'x' })],
  ])('rejects unscoped %s', async (_name, run) => {
    await expect(run()).rejects.toThrow(/tenantId/);
  });
  it('rejects a tenantId that is an operator, not a concrete value', async () => {
    await expect(Thing.find({ tenantId: { $ne: 'A' } })).rejects.toThrow(/tenantId/);
    await expect(Thing.find({ tenantId: { $exists: true } })).rejects.toThrow(/tenantId/);
  });
  it('rejects unscoped aggregates', async () => {
    await expect(
      Thing.aggregate([{ $group: { _id: null, t: { $sum: '$amount' } } }]),
    ).rejects.toThrow(/tenantId/);
  });
  it.skipIf(!haveDb)('accepts scoped aggregates without leaking another tenant', async () => {
    const [row] = await Thing.aggregate([
      { $match: { tenantId: 'A' } },
      { $group: { _id: null, t: { $sum: '$amount' } } },
    ]);
    expect(row.t).toBe(300); // tenant B's 999 never leaks in
  });
  it('rejects insertMany and save without tenantId', async () => {
    await expect(Thing.insertMany([{ name: 'orphan' }])).rejects.toThrow(/tenantId/);
    await expect(new Thing({ name: 'orphan' }).save()).rejects.toThrow(/tenantId/);
  });
  it('rejects bulkWrite operations without tenant scope', async () => {
    await expect(
      Thing.bulkWrite([{ updateOne: { filter: { name: 'a1' }, update: { amount: 5 } } }]),
    ).rejects.toThrow(/tenantId/);
  });
  it('cannot move a document to another tenant through an update', async () => {
    await expect(
      Thing.updateOne({ tenantId: 'A', name: 'a1' }, { $set: { tenantId: 'B' } }),
    ).rejects.toThrow(/cannot be modified/);
  });
  it.skipIf(!haveDb)('allows the explicit script-only escape hatch', async () => {
    const all = await Thing.find({}, null, { _skipTenantCheck: true }).lean();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });
});
