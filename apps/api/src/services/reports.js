/**
 * Statement builders (pure, no database) so every figure can be tested. Cash basis (PRD 4.7.1):
 * income = fee money actually received (cancelled receipts never count), expenditure = money
 * actually paid out. Fee receivables and approved-but-unpaid expenses are shown as memo items,
 * outside the totals (decision of the school, Step 12).
 */
const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);

/** Receipt heads -> the income lines of the statement. Anything unknown falls in the last line. */
export const INCOME_GROUPS = [
  {
    key: "tuition",
    label: "Tuition fees (including old fees)",
    heads: ["tuition", "old_fees"],
  },
  {
    key: "transport",
    label: "Transport fees (including old transport fees)",
    heads: ["transport", "transport_old"],
  },
  {
    key: "admission",
    label: "Admission and form fees",
    heads: ["admission", "form"],
  },
  { key: "late", label: "Late fees and other", heads: [] },
];
const groupOf = (head) =>
  INCOME_GROUPS.find((g) => g.heads.includes(head))?.key ??
  INCOME_GROUPS.at(-1).key;

/** `byHead` = { tuition: paise, ... } of receipt lines; `latePaise` = late fees charged. */
export function incomeLines({ byHead = {}, latePaise = 0 }) {
  const totals = Object.fromEntries(INCOME_GROUPS.map((g) => [g.key, 0]));
  for (const [head, paise] of Object.entries(byHead))
    totals[groupOf(head)] += paise;
  totals.late += latePaise;
  return INCOME_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    paise: totals[g.key],
  }));
}

/** `rows` = [{ head, paise }] (a head can repeat). Sorted by head name. */
export function expenseLines(rows) {
  const m = new Map();
  for (const r of rows) {
    const head = r.head && r.head.trim() ? r.head.trim() : "Other (no head)";
    m.set(head, (m.get(head) ?? 0) + r.paise);
  }
  return [...m.entries()]
    .map(([label, paise]) => ({ key: label.toLowerCase(), label, paise }))
    .filter((l) => l.paise !== 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Income & Expenditure; `compare` (optional) is the same period shape for the earlier period. */
export function buildIncomeExpenditure({
  from,
  to,
  income,
  expenses,
  compare,
}) {
  const inc = incomeLines(income);
  const exp = expenseLines(expenses);
  const totalIncome = sum(inc, (l) => l.paise);
  const totalExpense = sum(exp, (l) => l.paise);
  const out = {
    from,
    to,
    basis: "cash",
    income: inc,
    expenditure: exp,
    totalIncomePaise: totalIncome,
    totalExpenditurePaise: totalExpense,
    surplusPaise: totalIncome - totalExpense,
    compare: null,
  };
  if (compare) {
    const cInc = incomeLines(compare.income);
    const cExp = expenseLines(compare.expenses);
    // Heads that exist in only one of the two periods still get a row.
    const labels = [...new Set([...exp, ...cExp].map((l) => l.label))].sort(
      (a, b) => a.localeCompare(b),
    );
    const pick = (lines, label) =>
      lines.find((l) => l.label === label)?.paise ?? 0;
    const cTotalIncome = sum(cInc, (l) => l.paise);
    const cTotalExpense = sum(cExp, (l) => l.paise);
    out.expenditure = labels.map((label) => ({
      key: label.toLowerCase(),
      label,
      paise: pick(exp, label),
      comparePaise: pick(cExp, label),
    }));
    out.income = inc.map((l, i) => ({ ...l, comparePaise: cInc[i].paise }));
    out.compare = {
      from: compare.from,
      to: compare.to,
      totalIncomePaise: cTotalIncome,
      totalExpenditurePaise: cTotalExpense,
      surplusPaise: cTotalIncome - cTotalExpense,
    };
  }
  return out;
}

/**
 * Money the school holds on `asOn`. `accounts` = { cash, petty, 'bank:<id>': paise,
 * 'online:unassigned': paise }. Capital + surplus should equal the assets; when the opening
 * balances do not agree the difference is shown (never hidden) so the accountant can fix them.
 */
export function buildBalanceSheet({
  asOn,
  accounts,
  banks,
  settings,
  surplusToDatePaise,
  receivablePaise,
  payablePaise,
}) {
  const bankName = new Map(banks.map((b) => [String(b._id), b.name]));
  const bankKeys = Object.keys(accounts).filter((k) => k.startsWith("bank:"));
  const bankLines = bankKeys
    .map((k) => ({
      key: k,
      label: bankName.get(k.slice(5)) ?? "Bank",
      paise: accounts[k],
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const assets = [
    { key: "cash", label: "Cash in hand", paise: accounts.cash ?? 0 },
    ...bankLines,
    ...(accounts["online:unassigned"]
      ? [
          {
            key: "online:unassigned",
            label: "Online receipts with no bank chosen",
            paise: accounts["online:unassigned"],
          },
        ]
      : []),
    { key: "petty", label: "Petty cash", paise: accounts.petty ?? 0 },
    {
      key: "fixed",
      label: "Fixed assets (opening balance)",
      paise: settings.fixedAssetsPaise ?? 0,
    },
  ];
  const funds = [
    {
      key: "capital",
      label: "Capital / reserve fund (opening)",
      paise: settings.capitalPaise ?? 0,
    },
    {
      key: "surplus",
      label: "Surplus / (deficit) to date",
      paise: surplusToDatePaise,
    },
  ];
  const totalAssets = sum(assets, (l) => l.paise);
  const totalFunds = sum(funds, (l) => l.paise);
  return {
    asOn,
    basis: "cash",
    assets,
    funds,
    totalAssetsPaise: totalAssets,
    totalFundsPaise: totalFunds,
    // assets - funds. Not zero = the opening balances entered do not match the money held.
    differencePaise: totalAssets - totalFunds,
    memo: { feeReceivablePaise: receivablePaise, payablesPaise: payablePaise },
    settingsSet: !!settings.set,
  };
}

/**
 * Trial Balance as on `to`: income and expenditure of `from`..`to`, assets as on `to`, and the
 * capital brought forward (capital + surplus before `from`). Debits = credits, except for the
 * opening-balance difference, which is shown on its own line.
 */
export function buildTrialBalance({
  from,
  to,
  income,
  expenses,
  accounts,
  banks,
  settings,
  surplusBeforePaise,
}) {
  const bs = buildBalanceSheet({
    asOn: to,
    accounts,
    banks,
    settings,
    surplusToDatePaise: 0,
    receivablePaise: 0,
    payablePaise: 0,
  });
  const inc = incomeLines(income);
  const exp = expenseLines(expenses);
  const rows = [];
  for (const a of bs.assets) rows.push({ label: a.label, debitPaise: a.paise });
  for (const e of exp)
    rows.push({ label: `Expenditure: ${e.label}`, debitPaise: e.paise });
  rows.push({
    label: "Capital / reserve fund brought forward",
    creditPaise: (settings.capitalPaise ?? 0) + surplusBeforePaise,
  });
  for (const i of inc)
    rows.push({ label: `Income: ${i.label}`, creditPaise: i.paise });
  let debit = sum(rows, (r) => r.debitPaise ?? 0);
  let credit = sum(rows, (r) => r.creditPaise ?? 0);
  const difference = debit - credit;
  if (difference > 0)
    rows.push({
      label: "Difference in opening balances",
      creditPaise: difference,
    });
  if (difference < 0)
    rows.push({
      label: "Difference in opening balances",
      debitPaise: -difference,
    });
  debit = sum(rows, (r) => r.debitPaise ?? 0);
  credit = sum(rows, (r) => r.creditPaise ?? 0);
  return {
    from,
    to,
    rows: rows.map((r) => ({
      label: r.label,
      debitPaise: r.debitPaise ?? 0,
      creditPaise: r.creditPaise ?? 0,
    })),
    totalDebitPaise: debit,
    totalCreditPaise: credit,
    differencePaise: difference,
  };
}

/** Day Book: every money movement (in or out) in date order, with running totals over the range. */
export function buildDayBook({ from, to, entries, page = 1, pageSize = 50 }) {
  const sorted = [...entries].sort(
    (a, b) => a.at - b.at || String(a.ref).localeCompare(String(b.ref)),
  );
  const inPaise = sum(sorted, (e) => e.inPaise);
  const outPaise = sum(sorted, (e) => e.outPaise);
  const start = (page - 1) * pageSize;
  return {
    from,
    to,
    total: sorted.length,
    page,
    pageSize,
    totalInPaise: inPaise,
    totalOutPaise: outPaise,
    rows: sorted.slice(start, start + pageSize),
  };
}
export const dayBookAll = (entries) =>
  [...entries].sort(
    (a, b) => a.at - b.at || String(a.ref).localeCompare(String(b.ref)),
  );
