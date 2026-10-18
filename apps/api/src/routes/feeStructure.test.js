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
function build() {
  const audit = [];
  const saved = {};
  const auth = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: { findByFirebaseUid: async (_t, uid) => users[uid], touchLogin: async () => {} },
    auditStore: { append: async (e) => audit.push(e) },
    feeStore: {
      get: async (_t, fy) => saved[fy] ?? null,
      save: async (_t, fy, d) => (saved[fy] = { fy, ...d }),
    },
  };
  return { app: createApp(env, createLogger('silent'), auth), audit };
}
const as = (t) => ({ Authorization: `Bearer ${t}` });
const chart = {
  classFees: [{ classKey: 'NURSERY', monthlyTuitionPaise: 70000, admissionPaise: 100000 }],
  formFeePaise: 10000,
  villages: [{ name: 'Siwal', monthlyPaise: 70000 }],
};

describe('fee structure API', () => {
  it('404 when the year has no chart yet', async () => {
    expect(
      (await request(build().app).get('/api/fee-structure/2026-27').set(as('cashier'))).status,
    ).toBe(404);
  });
  it('403 when Principal or Cashier tries to change it', async () => {
    const { app } = build();
    for (const r of ['principal', 'cashier'])
      expect(
        (await request(app).put('/api/fee-structure/2026-27').set(as(r)).send(chart)).status,
      ).toBe(403);
  });
  it('Admin saves it, defaults apply, audit written, Cashier can read', async () => {
    const { app, audit } = build();
    const res = await request(app).put('/api/fee-structure/2026-27').set(as('admin')).send(chart);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dueDay: 15, graceDays: 10, lateFeePaise: 10000 });
    expect(audit.at(-1)).toMatchObject({ action: 'create', entity: 'fee_structure' });
    expect((await request(app).get('/api/fee-structure/2026-27').set(as('cashier'))).status).toBe(
      200,
    );
  });
  it('rejects rupee decimals (money must be whole paise)', async () => {
    const { app } = build();
    const bad = { ...chart, formFeePaise: 100.5 };
    expect(
      (await request(app).put('/api/fee-structure/2026-27').set(as('admin')).send(bad)).status,
    ).toBe(400);
  });
});
