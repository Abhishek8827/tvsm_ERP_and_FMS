/**
 * DEVELOPMENT ONLY: adds DEMO opening balances so you can try Bank & Cash, Petty Cash and
 * Expenses before the real opening figures are known: banks "IDFC (DEMO)" and "Kotak (DEMO)",
 * opening cash and petty cash. The amounts are made up. Refuses to run in production.
 * Before go-live: stop using the two demo banks and set the REAL opening balances (the opening
 * balance of an account can be set only once, so use a fresh database for go-live).
 * Run:  pnpm --filter @erp/api money:demo        (safe to run again: existing items are skipped)
 */
import { loadEnv } from "../config/env.js";
import { connectDb, disconnectDb } from "../db.js";
import { BankAccount } from "../models/BankAccount.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { makeMoneyStore } from "../services/moneyStore.js";

const env = loadEnv();
if (env.NODE_ENV === "production") {
  console.error("Refusing to add demo money in production.");
  process.exit(1);
}
await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME);
const tenantId = env.DEFAULT_TENANT_ID;
const store = makeMoneyStore();
const user = { id: "demo-seed", name: "Demo seed" };
const rs = (n) => n * 100;

for (const [name, last4, opening, modes] of [
  ["IDFC (DEMO)", "0001", rs(250000), ["upi"]],
  ["Kotak (DEMO)", "0002", rs(100000), ["qr"]],
]) {
  if (await BankAccount.exists({ tenantId, nameLower: name.toLowerCase() }))
    continue;
  await store.createBank({
    tenantId,
    input: { name, last4, openingPaise: opening, defaultForModes: modes },
    user,
  });
  console.log(`Added ${name}`);
}
for (const [account, amount] of [
  ["cash", rs(50000)],
  ["petty", rs(5000)],
]) {
  if (await LedgerEntry.exists({ tenantId, account, type: "opening" }))
    continue;
  await store.setOpening({ tenantId, account, amountPaise: amount, user });
  console.log(`Opening ${account}: demo ${amount / 100}`);
}
await disconnectDb();
console.log("Done. These are DEMO amounts.");
