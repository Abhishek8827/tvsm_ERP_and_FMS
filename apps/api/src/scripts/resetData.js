/**
 * DATA CLEANER: removes all test data so the application starts new (pre-launch, once).
 * What is kept / wiped / reset is listed in src/services/dataReset.js (PLAN).
 *
 *  1) Look first (changes NOTHING):      pnpm --filter @erp/api data:reset
 *  2) Take an Atlas backup / snapshot of the database.
 *  3) Really wipe (all four guards):
 *       ALLOW_DATA_RESET=yes pnpm --filter @erp/api data:reset -- --wipe --db=<DATABASE NAME> --phrase="DELETE ALL TEST DATA"
 *  4) Remove ALLOW_DATA_RESET again. Never run this after real fees have been collected.
 */
import { loadEnv } from "../config/env.js";
import { connectDb, disconnectDb } from "../db.js";
import {
  countPlan,
  parseArgs,
  runWipe,
  wipeBlockedReason,
} from "../services/dataReset.js";

const env = loadEnv();
const args = parseArgs(process.argv.slice(2));
const tenantId = env.DEFAULT_TENANT_ID;
const dbName = env.MONGODB_DB_NAME;

const show = (rows) => {
  for (const r of rows)
    console.log(
      `${r.action.toUpperCase().padEnd(6)} ${r.name.padEnd(22)} ${String(r.count).padStart(7)} row(s)${r.why ? `   - ${r.why}` : ""}`,
    );
};
let code = 0;
try {
  await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME);
  console.log(`Database: ${dbName}   School (tenant): ${tenantId}\n`);
  if (!args.wipe) {
    show(await countPlan(tenantId));
    console.log(
      "\nDRY RUN: nothing was changed. See the top of this file for the real command.",
    );
  } else {
    const blocked = wipeBlockedReason({ args, env: process.env, dbName });
    if (blocked) {
      console.error(`NOT WIPED. ${blocked}`);
      code = 2;
    } else {
      const out = await runWipe(tenantId, { by: "data-reset script" });
      show(out.before);
      console.log("\nDONE. Wiped:", out.removed, "\nReset:", out.reset);
      console.log(
        "Now: remove ALLOW_DATA_RESET, import the real students, set real opening balances.",
      );
    }
  }
} catch (err) {
  console.error("Could not finish:", err.message);
  code = 1;
} finally {
  await disconnectDb();
}
process.exit(code);
