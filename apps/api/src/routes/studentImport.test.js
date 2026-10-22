import request from 'supertest';
import writeXlsxFile from 'write-excel-file/node';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { TEMPLATE_HEADERS } from '../services/studentImport.js';
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
function build(existing = []) {
  const saved = [];
  const audit = [];
  const auth = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: { findByFirebaseUid: async (_t, uid) => users[uid], touchLogin: async () => {} },
    auditStore: { append: async (e) => audit.push(e) },
    feeStore: { get: async () => null },
    chargeStore: { postMany: async () => 0 },
    studentStore: {
      existingAdmissionNos: async () => new Set(existing),
      findByAdmissionNos: async (_t, list) =>
        saved.filter((d) => list.includes(d.admissionNo)).map((d, i) => ({ ...d, _id: `s${i}` })),
      createMany: async (_t, docs) => {
        saved.push(...docs);
        return docs.length;
      },
    },
  };
  return { app: createApp(env, createLogger('silent'), auth), saved, audit };
}
const as = (t) => ({ Authorization: `Bearer ${t}` });

// Build a real .xlsx file in memory, like the school's sheet.
async function xlsx(rows, headers = TEMPLATE_HEADERS) {
  return writeXlsxFile([headers, ...rows]).toBuffer();
}
const row = (o) => TEMPLATE_HEADERS.map((h) => o[h] ?? null);
const send = (app, buf, commit, who = 'admin') =>
  request(app)
    .post(`/api/students/import?commit=${commit}`)
    .set(as(who))
    .set('Content-Type', 'application/octet-stream')
    .send(buf);

describe('student Excel import', () => {
  it('403 for Principal and Cashier (template and upload)', async () => {
    const { app } = build();
    for (const r of ['principal', 'cashier']) {
      expect((await request(app).get('/api/students/import-template').set(as(r))).status).toBe(403);
      expect((await send(app, await xlsx([]), false, r)).status).toBe(403);
    }
  });

  it('Admin can download the template: an .xlsx with the school headers and no fake rows', async () => {
    const { app } = build();
    const res = await request(app)
      .get('/api/students/import-template')
      .set(as('admin'))
      .buffer(true)
      .parse((r, cb) => {
        const parts = [];
        r.on('data', (c) => parts.push(c));
        r.on('end', () => cb(null, Buffer.concat(parts)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    // The template must be accepted by the importer itself, with zero rows in it.
    const { app: app2 } = build();
    const check = await send(app2, res.body, false);
    expect(check.status).toBe(200);
    expect(check.body.rowsInFile).toBe(0);
  });

  it('preview saves nothing; commit saves only the good rows and lists the bad ones', async () => {
    const { app, saved, audit } = build();
    const file = await xlsx([
      row({
        'SCH.': 1053,
        "STUDENT'S NAME": 'Aarav',
        CLASS: 'NURSERY',
        SEC: 'A',
        GENDER: 'MALE',
        STATUS: 'ACTIVE',
        'CONTACT NO.': 9876543210,
        'AADHAAR NO.': 123456789012,
        TRANSPORT: 'YES',
        ADDRESS: 'Siwal',
        REMARK: 'RTE',
      }),
      row({
        'SCH.': 1054,
        "STUDENT'S NAME": 'Bhumi',
        CLASS: '9TH',
        STATUS: 'INACTIVE',
        'INACTIVE STATUS': 'LEFT WITHOUT TC',
      }),
      row({ 'SCH.': 1055, "STUDENT'S NAME": '', CLASS: 'Mars' }),
    ]);
    const preview = await send(app, file, false);
    expect(preview.body).toMatchObject({ committed: false, ready: 2, created: 0, skipped: 1 });
    expect(saved).toHaveLength(0);
    expect(preview.body.errors[0].row).toBe(4);

    const done = await send(app, file, true);
    expect(done.body).toMatchObject({ committed: true, created: 2, skipped: 1 });
    const [a, b] = saved;
    expect(a).toMatchObject({
      admissionNo: '1053',
      classKey: 'NURSERY',
      usesTransport: true,
      village: 'SIWAL',
      isRTE: true,
      isNewAdmission: false,
      aadhaar: '123456789012',
    });
    expect(b).toMatchObject({
      classKey: '9',
      status: 'inactive',
      inactiveReason: 'left_without_tc',
    });
    expect(audit.at(-1)).toMatchObject({ entity: 'student_import', newValue: { created: 2 } });
  });

  it('students that already exist are skipped, never changed (safe to run twice)', async () => {
    const { app, saved } = build(['1053']);
    const file = await xlsx([row({ 'SCH.': 1053, "STUDENT'S NAME": 'Aarav', CLASS: 'LKG' })]);
    const res = await send(app, file, true);
    expect(res.body).toMatchObject({ created: 0, skipped: 1 });
    expect(res.body.errors[0].message).toMatch(/already exists/);
    expect(saved).toHaveLength(0);
  });

  it('rejects a file without the required columns and a non-Excel file', async () => {
    const { app } = build();
    const noCols = await xlsx([['x']], ['FOO']);
    const r1 = await send(app, noCols, false);
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe('BAD_TEMPLATE');
    const r2 = await send(app, Buffer.from('not excel'), false);
    expect(r2.body.error.code).toBe('BAD_FILE');
  });
});
