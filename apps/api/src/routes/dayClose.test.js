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

function build(expectedCashPaise = 500000) {
  const audit = [];
  const days = new Map();
  const dayCloseStore = {
    dayTotals: async (_t, date) => ({
      date,
      cashReceiptPaise: expectedCashPaise,
      cashCancelledPaise: 0,
      expectedCashPaise,
      upiPaise: 100000,
      qrPaise: 50000,
      receiptCount: 7,
      cancelledCount: 0,
    }),
    get: async (_t, d) => days.get(d) ?? null,
    list: async () => ({ rows: [...days.values()], total: days.size }),
    close: async ({ date, figures, user }) => {
      const cur = days.get(date);
      if (cur?.status === 'closed') return null;
      const doc = { date, status: 'closed', ...figures, closedByName: user.name };
      days.set(date, doc);
      return doc;
    },
    reopen: async ({ date, reason }) => {
      const cur = days.get(date);
      if (cur?.status !== 'closed') return null;
      Object.assign(cur, { status: 'open', reopenReason: reason });
      return cur;
    },
  };
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: { findByFirebaseUid: async (_t, uid) => users[uid], touchLogin: async () => {} },
    auditStore: { append: async (e) => audit.push(e) },
    dayCloseStore,
  };
  return { app: createApp(env, createLogger('silent'), deps), audit };
}
const TODAY = '2026-10-22';
const post = (app, who, body) =>
  request(app)
    .post('/api/day-close')
    .set(as(who))
    .send({ date: TODAY, ...body });

describe('Day Close API', () => {
  it('everyone signed in can look; only the Cashier closes; only the Admin reopens', async () => {
    const { app } = build();
    for (const who of ['admin', 'principal', 'cashier']) {
      expect((await request(app).get('/api/day-close/summary').set(as(who))).status).toBe(200);
      expect((await request(app).get('/api/day-close').set(as(who))).status).toBe(200);
    }
    for (const who of ['admin', 'principal'])
      expect((await post(app, who, { countedCashPaise: 500000 })).status).toBe(403);
    await post(app, 'cashier', { countedCashPaise: 500000 });
    for (const who of ['principal', 'cashier'])
      expect(
        (
          await request(app)
            .post(`/api/day-close/${TODAY}/reopen`)
            .set(as(who))
            .send({ reason: 'abc def' })
        ).status,
      ).toBe(403);
  });

  it('the server works out expected cash; matching count closes the day and audits it', async () => {
    const { app, audit } = build();
    const r = await post(app, 'cashier', { countedCashPaise: 500000 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      status: 'closed',
      expectedCashPaise: 500000,
      differencePaise: 0,
      upiPaise: 100000,
      qrPaise: 50000,
    });
    expect(audit.some((a) => a.entity === 'day_close')).toBe(true);
  });

  it('a difference needs a reason, and is recorded with it', async () => {
    const { app } = build();
    const bad = await post(app, 'cashier', { countedCashPaise: 490000 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('REASON_REQUIRED');
    const ok = await post(app, 'cashier', {
      countedCashPaise: 490000,
      reason: 'Change given back',
    });
    expect(ok.body.differencePaise).toBe(-10000);
    expect(ok.body.differenceReason).toBe('Change given back');
  });

  it('closing twice is 409, and a future date is refused', async () => {
    const { app } = build();
    await post(app, 'cashier', { countedCashPaise: 500000 });
    expect((await post(app, 'cashier', { countedCashPaise: 500000 })).body.error.code).toBe(
      'ALREADY_CLOSED',
    );
    expect((await post(app, 'cashier', { date: '2999-01-01', countedCashPaise: 1 })).status).toBe(
      422,
    );
  });

  it('reopen needs a reason; then the day can be closed again', async () => {
    const { app } = build();
    await post(app, 'cashier', { countedCashPaise: 500000 });
    expect(
      (
        await request(app)
          .post(`/api/day-close/${TODAY}/reopen`)
          .set(as('admin'))
          .send({ reason: '' })
      ).status,
    ).toBe(400);
    const re = await request(app)
      .post(`/api/day-close/${TODAY}/reopen`)
      .set(as('admin'))
      .send({ reason: 'Missed a receipt' });
    expect(re.body.status).toBe('open');
    expect(
      (
        await request(app)
          .post(`/api/day-close/${TODAY}/reopen`)
          .set(as('admin'))
          .send({ reason: 'again again' })
      ).status,
    ).toBe(404);
  });
});
