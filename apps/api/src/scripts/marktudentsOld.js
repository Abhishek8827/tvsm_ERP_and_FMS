/**
 * One-time: every student already in the system is an OLD student (owner's decision, 2026-11-01).
 * Sets isNewAdmission = false, so no admission fee or form fee is ever posted for them.
 * Fees that were ALREADY posted are not touched (money is never changed by a script); the count
 * is shown so the Admin can look at them.
 *   Run:  pnpm --filter @erp/api students:mark-old            (shows what it would do)
 *         pnpm --filter @erp/api students:mark-old -- --apply (does it)
 * Safe to run again.
 */
import { loadEnv } from "../config/env.js";
import { connectDb, disconnectDb } from "../db.js";
import { Charge } from "../models/Charge.js";
import { Student } from "../models/Student.js";

const env = loadEnv();
const apply = process.argv.includes("--apply");
const tenantId = env.DEFAULT_TENANT_ID;

await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME);
try {
  const flagged = await Student.countDocuments({
    tenantId,
    isNewAdmission: true,
  });
  const posted = await Charge.countDocuments({
    tenantId,
    head: { $in: ["admission", "form"] },
  });
  console.log(`Students marked "new admission": ${flagged}`);
  console.log(
    `Admission / form fee charges already posted (left as they are): ${posted}`,
  );
  if (!apply)
    console.log("Dry run. Add  -- --apply  to mark them all as old students.");
  else {
    const res = await Student.updateMany(
      { tenantId, isNewAdmission: true },
      { $set: { isNewAdmission: false } },
    );
    console.log(`Done: ${res.modifiedCount} student(s) are now old students.`);
  }
} finally {
  await disconnectDb();
}
