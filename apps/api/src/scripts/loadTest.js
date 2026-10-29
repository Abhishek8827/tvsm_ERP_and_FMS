/**
 * Load test for fee collection: "500 receipts in 10 minutes" (go-live check).
 *
 * RUN THIS ONLY AGAINST A TEST / STAGING SERVER AND ITS OWN DATABASE. It creates REAL receipts.
 * Those receipts are test data and must be wiped with the data cleaner before real use.
 *
 *   LOAD_BASE_URL=https://your-staging-api.example  LOAD_TOKEN=<Cashier ID token>  \
 *   LOAD_CONFIRM=yes  pnpm --filter @erp/api loadtest
 *
 * Optional: LOAD_RECEIPTS (default 500), LOAD_MINUTES (default 10), LOAD_CONCURRENCY (default 6).
 * LOAD_TOKEN is a Firebase ID token of a Cashier (it lasts about 1 hour: copy a fresh one).
 * Every receipt is a small CASH payment, so no bank account is needed.
 *
 * It checks: speed (p50 / p95 / p99), errors, that a repeated Idempotency-Key gives the SAME
 * receipt (no duplicate), and that receipt numbers have no gap and no repeat.
 */
const BASE = (process.env.LOAD_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.LOAD_TOKEN ?? "";
const TOTAL = Number(process.env.LOAD_RECEIPTS ?? 500);
const MINUTES = Number(process.env.LOAD_MINUTES ?? 10);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 6);

if (!BASE || !TOKEN) {
  console.error(
    "Set LOAD_BASE_URL and LOAD_TOKEN (see the comment at the top of this file).",
  );
  process.exit(2);
}
if (process.env.LOAD_CONFIRM !== "yes") {
  console.error(
    `This creates ${TOTAL} REAL receipts on ${BASE}.\nOnly do this on a test server. Set LOAD_CONFIRM=yes to go on.`,
  );
  process.exit(2);
}

const lat = { list: [], dues: [], receipt: [], replay: [] };
const counts = { ok: 0, replayOk: 0, refused: 0, failed: 0, skipped: 0 };
const problems = [];
const numbers = [];

async function call(bucket, method, path, { body, key } = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    lat[bucket].push(performance.now() - t0);
    return { status: res.status, data };
  } catch (err) {
    lat[bucket].push(performance.now() - t0);
    return { status: 0, data: { error: { message: String(err.message) } } };
  }
}
const pct = (arr, p) => {
  if (arr.length === 0) return "-";
  const s = [...arr].sort((a, b) => a - b);
  return `${Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))])} ms`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = Date.now().toString(36);

// 1. Students to pay for.
const students = [];
for (let page = 1; students.length < TOTAL * 2 && page <= 50; page += 1) {
  const r = await call(
    "list",
    "GET",
    `/api/students?status=active&pageSize=100&page=${page}`,
  );
  if (r.status !== 200) {
    console.error(
      `Could not read students (HTTP ${r.status}): ${r.data?.error?.message ?? ""}`,
    );
    process.exit(1);
  }
  students.push(...r.data.rows.map((s) => s.id));
  if (r.data.rows.length < 100) break;
}
if (students.length === 0) {
  console.error("No active students found. Import students first.");
  process.exit(1);
}
console.log(
  `Found ${students.length} active students. Sending up to ${TOTAL} receipts in ${MINUTES} min...`,
);

// 2. One "customer" = look up dues, then pay a small cash amount.
async function oneCustomer(n, studentId) {
  const d = await call(
    "dues",
    "GET",
    `/api/students/${studentId}/dues?kind=school`,
  );
  if (d.status !== 200 || !d.data.planPosted) return void (counts.skipped += 1);
  const rem = d.data.remaining ?? {};
  const input = { lateFeePaise: d.data.lateFeeCalculatedPaise ?? 0 };
  if ((rem.old_fees ?? 0) > 0) input.oldPaise = Math.min(10_000, rem.old_fees);
  else {
    const current = Object.entries(rem)
      .filter(([h]) => h !== "old_fees")
      .reduce((a, [, v]) => a + v, 0);
    if (current <= 0) return void (counts.skipped += 1);
    input.newPaise = Math.min(10_000, current);
  }
  const key = `load-${run}-${n}`;
  const body = { studentId, kind: "school", input, mode: "cash" };
  const r = await call("receipt", "POST", "/api/receipts", { body, key });
  if (r.status === 201) {
    counts.ok += 1;
    numbers.push(r.data.number);
    // Every 20th: press the button twice (double click / network retry) -> must be the SAME receipt.
    if (n % 20 === 0) {
      const again = await call("replay", "POST", "/api/receipts", {
        body,
        key,
      });
      if (
        again.status === 200 &&
        again.data.id === r.data.id &&
        again.data.number === r.data.number
      )
        counts.replayOk += 1;
      else
        problems.push(
          `Retry of ${r.data.number} did not return the same receipt (HTTP ${again.status}).`,
        );
    }
  } else if (r.status >= 400 && r.status < 500) {
    counts.refused += 1; // a business rule said no (for example the Day Close is done)
    if (r.status === 409 || r.status === 401 || r.status === 403)
      problems.push(`HTTP ${r.status}: ${r.data?.error?.message ?? ""}`);
  } else {
    counts.failed += 1;
    problems.push(`HTTP ${r.status}: ${r.data?.error?.message ?? "no answer"}`);
  }
}

// 3. Spread the work over the minutes, with CONCURRENCY customers at a time.
const started = Date.now();
const gap = (MINUTES * 60_000) / TOTAL;
let next = 0;
async function worker() {
  while (next < TOTAL) {
    const n = next++;
    const due = started + n * gap;
    if (due > Date.now()) await sleep(due - Date.now());
    await oneCustomer(n, students[n % students.length]);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const seconds = (Date.now() - started) / 1000;

// 4. Numbers: no repeat, no gap (within this run, if nobody else was issuing receipts).
const seqOf = (num) => Number(String(num).split("/").pop());
const sorted = [...numbers].sort((a, b) => seqOf(a) - seqOf(b));
const dupes = numbers.length - new Set(numbers).size;
let gaps = 0;
for (let i = 1; i < sorted.length; i += 1)
  if (seqOf(sorted[i]) - seqOf(sorted[i - 1]) !== 1) gaps += 1;

console.log("\n===== RESULT =====");
console.log(
  `Time: ${seconds.toFixed(0)} s   Receipts made: ${counts.ok}   (target ${TOTAL})`,
);
console.log(
  `Refused by a rule: ${counts.refused}   Skipped (nothing due): ${counts.skipped}   Server errors: ${counts.failed}`,
);
console.log(`Retry check (same key twice): ${counts.replayOk} correct`);
console.log(
  `Receipt numbers: ${dupes} repeated, ${gaps} gap(s) ${numbers.length ? `(${sorted[0]} .. ${sorted.at(-1)})` : ""}`,
);
for (const [k, v] of Object.entries(lat))
  if (v.length)
    console.log(
      `${k.padEnd(8)} calls ${String(v.length).padStart(4)}   p50 ${pct(v, 50)}   p95 ${pct(v, 95)}   p99 ${pct(v, 99)}`,
    );
const pass =
  counts.failed === 0 &&
  dupes === 0 &&
  gaps === 0 &&
  problems.length === 0 &&
  counts.ok >= TOTAL * 0.9;
if (problems.length)
  console.log(
    `\nProblems (first 10):\n - ${[...new Set(problems)].slice(0, 10).join("\n - ")}`,
  );
console.log(pass ? "\nPASS" : "\nFAIL - read the lines above");
process.exit(pass ? 0 : 1);
