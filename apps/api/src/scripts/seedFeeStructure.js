/**
 * Loads the school's REAL fee chart (from the school's fee chart) for one financial year.
 * Run:  pnpm --filter @erp/api fees:seed            (default year 2026-27)
 *       pnpm --filter @erp/api fees:seed -- 2027-28
 * Safe to run again: it only fills the year if it does not exist yet, so it never overwrites
 * changes the Admin made on screen.
 */
import { loadEnv } from "../config/env.js";
import { connectDb, disconnectDb } from "../db.js";
import { FeeStructure } from "../models/FeeStructure.js";

const env = loadEnv();
const fy =
  process.argv.slice(2).find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-27";
const rs = (n) => n * 100; // rupees -> paise

// [class, monthly tuition, admission fee] (yearly tuition = monthly x 10 instalments)
const CLASS_ROWS = [
  ["PG", 700, 1000],
  ["NURSERY", 700, 1000],
  ["LKG", 770, 1000],
  ["UKG", 770, 1000],
  ["1", 1000, 2000],
  ["2", 1000, 2000],
  ["3", 1000, 2000],
  ["4", 1200, 2000],
  ["5", 1200, 2000],
  ["6", 1500, 2500],
  ["7", 1500, 2500],
  ["8", 1500, 2500],
  ["9", 1800, 3000],
  ["10", 1800, 3000],
];
// Monthly bus fee per village. More villages will be added by the Admin later.
const VILLAGES = {
  NAWRA: 1600,
  GHAGHARLA: 1400,
  HAIDARPUR: 1300,
  SIWAL: 700,
  BADNAPUR: 600,
  DABHIYA: 1300,
  BADIKHEDA: 1300,
  PANCHIMLI: 1400,
  PALASUR: 1100,
  SAIKHEDA: 1000,
  SONUD: 1400,
  NAWTHA: 1400,
  DAWALI: 800,
  SATPAYRI: 700,
  ANDHARWADI: 700,
  BHATKHEDA: 500,
  CHUNABHATTA: 500,
  BEED: 500,
  "SHIVAJI NAGAR": 500,
  BHUDHWARA: 500,
  "7NO. GATE": 500,
  "NEPA MILL GATE": 500,
  LALPADAWA: 1300,
};

await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME);
const tenantId = env.DEFAULT_TENANT_ID;
const exists = await FeeStructure.exists({ tenantId, fy });
if (exists) {
  console.log(`Fee structure for ${fy} already exists. Nothing changed.`);
} else {
  await FeeStructure.create({
    tenantId,
    fy,
    classFees: CLASS_ROWS.map(([classKey, t, a]) => ({
      classKey,
      monthlyTuitionPaise: rs(t),
      admissionPaise: rs(a),
    })),
    formFeePaise: rs(100),
    villages: Object.entries(VILLAGES).map(([name, r]) => ({
      name,
      monthlyPaise: rs(r),
    })),
  });
  console.log(
    `Fee structure for ${fy} created (14 classes, ${Object.keys(VILLAGES).length} villages).`,
  );
}
await disconnectDb();
