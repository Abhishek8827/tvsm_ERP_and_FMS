/**
 * DEVELOPMENT ONLY: adds 12 clearly-marked demo students (admission numbers start with "DEMO-")
 * so you can try the screens before the real Excel import. Refuses to run in production.
 * Remove them later with the Students screen: search "DEMO", select all, Delete selected.
 * Run:  pnpm --filter @erp/api students:demo
 * Safe to run again: students that already exist are skipped.
 */
import { loadEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../db.js';
import { Student } from '../models/Student.js';

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('Refusing to add demo students in production.');
  process.exit(1);
}

const DEMO = [
  ['Aarav Demo', 'PG', 'A', null],
  ['Bhavna Demo', 'NURSERY', 'A', null],
  ['Chirag Demo', 'LKG', 'A', 'SIWAL'],
  ['Diya Demo', 'UKG', 'B', null],
  ['Eshan Demo', '1', 'A', 'NAWRA'],
  ['Falguni Demo', '2', 'A', null],
  ['Gaurav Demo', '3', 'B', 'BADNAPUR'],
  ['Hetal Demo', '4', 'A', null],
  ['Ishaan Demo', '6', 'A', 'SONUD'],
  ['Jiya Demo', '8', 'B', null],
  ['Kabir Demo', '9', 'A', 'PALASUR'],
  ['Lavanya Demo', '10', 'A', null],
];

await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME);
const tenantId = env.DEFAULT_TENANT_ID;
let added = 0;
for (const [i, [name, classKey, section, village]] of DEMO.entries()) {
  const admissionNo = `DEMO-${String(i + 1).padStart(3, '0')}`;
  if (await Student.exists({ tenantId, admissionNo })) continue;
  await Student.create({
    tenantId,
    admissionNo,
    name,
    nameLower: name.toLowerCase(),
    classKey,
    section,
    village: village ?? undefined,
    usesTransport: Boolean(village),
    address: village ?? 'NEPANAGAR',
    status: 'active',
  });
  added += 1;
}
console.log(`${added} demo students added (${DEMO.length - added} already existed).`);
await disconnectDb();
