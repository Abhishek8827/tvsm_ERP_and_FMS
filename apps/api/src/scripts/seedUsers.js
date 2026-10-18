/**
 * Protected admin script: creates the school's login accounts and sets their Firebase custom
 * claims (role, tenantId). Run:  pnpm --filter @erp/api users:seed
 *
 * It reads emails/passwords ONLY from environment variables (SEED_*), never from code, and never
 * prints a password. Passwords must be strong and not reused from anywhere else.
 * In production it refuses to run unless you pass --confirm-production.
 */
import { initFirebaseAuth } from '../auth/firebase.js';
import { loadEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../db.js';
import { User } from '../models/User.js';

const env = loadEnv();
if (env.NODE_ENV === 'production' && !process.argv.includes('--confirm-production')) {
  console.error('Refusing to run in production without --confirm-production.');
  process.exit(1);
}

const ACCOUNTS = [
  { role: 'admin', name: 'Admin', key: 'SEED_ADMIN' },
  { role: 'principal', name: 'Principal', key: 'SEED_PRINCIPAL' },
  { role: 'cashier', name: 'Cashier (Counter 1)', key: 'SEED_CASHIER1' },
  { role: 'cashier', name: 'Cashier (Counter 2)', key: 'SEED_CASHIER2' },
].map((a) => ({
  ...a,
  email: process.env[`${a.key}_EMAIL`]?.trim().toLowerCase(),
  password: process.env[`${a.key}_PASSWORD`],
}));

function validate(account) {
  if (!account.email && !account.password) return 'skipped (no email and password set)';
  if (!account.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(account.email)) return 'invalid email';
  if (!account.password || account.password.length < 10)
    return 'password must be at least 10 characters';
  return null;
}

const auth = initFirebaseAuth(env);
if (!auth) {
  console.error(
    'Firebase is not configured (FIREBASE_PROJECT_ID + service account, or the emulator).',
  );
  process.exit(1);
}
await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME);

let failed = false;
for (const account of ACCOUNTS) {
  const problem = validate(account);
  if (problem) {
    console.log(`${account.role} <${account.email ?? 'not set'}>: ${problem}`);
    if (!problem.startsWith('skipped')) failed = true;
    continue;
  }
  let fbUser;
  try {
    fbUser = await auth.getUserByEmail(account.email);
    await auth.updateUser(fbUser.uid, {
      password: account.password,
      displayName: account.name,
      disabled: false,
    });
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
    fbUser = await auth.createUser({
      email: account.email,
      password: account.password,
      displayName: account.name,
    });
  }
  // The claims are what the API cross-checks against the database role on every request.
  await auth.setCustomUserClaims(fbUser.uid, {
    role: account.role,
    tenantId: env.DEFAULT_TENANT_ID,
  });
  await auth.revokeRefreshTokens(fbUser.uid); // so old tokens cannot keep an old role

  await User.updateOne(
    { tenantId: env.DEFAULT_TENANT_ID, firebaseUid: fbUser.uid },
    {
      $set: { email: account.email, name: account.name, role: account.role, isActive: true },
    },
    { upsert: true },
  );
  console.log(`${account.role} <${account.email}>: ready`);
}

await disconnectDb();
process.exit(failed ? 1 : 0);
