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
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: { findByFirebaseUid: async (_t, uid) => users[uid], touchLogin: async () => {} },
    auditStore: { append: async () => {} },
    moneyStore: {
      overview: async () => ({ cashPaise: 1000, pettyPaise: 500, banks: [] }),
      pendingCounts: async () => ({ vouchers: 1, reversals: 2 }),
    },
    studentStore: {
      forFees: async () => [
        { _id: 's1', admissionNo: '1', name: 'Asha', classKey: '5', status: 'active' },
      ],
    },
    feeStore: { get: async () => null },
    chargeStore: { listForStudents: async () => [] },
    rebateStore: { activeForStudents: async () => [] },
    receiptStore: {
      linesForStudents: async () => [],
      list: async () => ({
        rows: [],
        total: 3,
        groups: [
          { kind: 'school', mode: 'cash', paise: 300000, count: 2 },
          { kind: 'transport', mode: 'upi', paise: 50000, count: 1 },
        ],
      }),
      countPendingCancellations: async () => 4,
    },
  };
  return createApp(env, createLogger('silent'), deps);
}

describe('dashboard overview', () => {
  it('Admin and Principal get real totals; Cashier is refused', async () => {
    const app = build();
    expect((await request(app).get('/api/dashboard/overview').set(as('cashier'))).status).toBe(403);
    for (const who of ['admin', 'principal']) {
      const r = await request(app).get('/api/dashboard/overview').set(as(who));
      expect(r.status).toBe(200);
      expect(r.body.today).toEqual({ paise: 350000, count: 3 });
      expect(r.body.pending).toEqual({ vouchers: 1, reversals: 2, cancellations: 4 });
      expect(r.body.noPlanStudents).toBe(1);
      expect(r.body.classes).toHaveLength(1);
    }
  });
});
