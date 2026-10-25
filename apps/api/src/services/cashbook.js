/**
 * Builds the Cashbook of ONE day from the day's raw records. Pure (no database), so every figure
 * can be tested. The page follows the school's notebook:
 *  1 school fee receipts, 2 bus fee receipts, 3 expense summary, 4 cash balance, 5 online balance
 *  (per bank), 6 transport vendor account.
 * Identity that always holds for an account:  closing = opening + receipts + other - expenses.
 */
const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);
const EXPENSE_TYPES = ["expense_payment", "payment_reversal"];

export function buildCashbook({
  date,
  receipts,
  ledgerDay,
  opening,
  payments,
  banks,
  settings,
  transportBefore,
  dayClose,
  cancelledToday = 0,
}) {
  const bankName = new Map(banks.map((b) => [String(b._id), b.name]));
  const pay = new Map(payments.map((p) => [String(p._id), p]));

  const receiptRow = (r) => ({
    id: String(r._id),
    number: r.number,
    admissionNo: r.student?.admissionNo ?? "",
    classKey: r.student?.classKey ?? "",
    section: r.student?.section ?? "",
    name: r.student?.name ?? "",
    cashPaise: r.mode === "cash" ? r.totalPaise : 0,
    onlinePaise: r.mode === "cash" ? 0 : r.totalPaise,
    mode: r.mode,
    bankName:
      r.mode === "cash"
        ? null
        : (r.bankName ?? bankName.get(String(r.bankId)) ?? null),
    duePaise: r.dueAfterPaise ?? 0,
  });
  const section = (kind) => {
    const rows = receipts.filter((r) => r.kind === kind).map(receiptRow);
    return {
      rows,
      cashPaise: sum(rows, (r) => r.cashPaise),
      onlinePaise: sum(rows, (r) => r.onlinePaise),
      totalPaise: sum(rows, (r) => r.cashPaise + r.onlinePaise),
    };
  };
  const school = section("school");
  const bus = section("transport");

  const accountLabel = (a) =>
    a === "cash" ? "Cash" : (bankName.get(a.replace("bank:", "")) ?? "Bank");
  const expenseEntries = ledgerDay.filter((e) =>
    EXPENSE_TYPES.includes(e.type),
  );
  const expenseRows = expenseEntries.map((e) => {
    const p = pay.get(String(e.refId));
    const reversal = e.type === "payment_reversal";
    return {
      id: String(e._id),
      voucherNo: p?.voucherNumber ?? e.note ?? "",
      head: p?.headName ?? "",
      payee: p?.payeeName ?? "",
      // Positive = money spent; a reversal is shown as a negative expense (money came back).
      amountPaise: -e.amountPaise,
      reversal,
      by: p?.authorisedBy ?? "",
      account: e.account,
      mode: accountLabel(e.account),
    };
  });
  const expenseTotal = sum(expenseRows, (r) => r.amountPaise);

  // One account block: opening + the day's receipts + other movements - expenses = closing.
  const block = (account, receiptPaise) => {
    const open = opening[account] ?? 0;
    const spent = sum(
      expenseRows.filter((r) => r.account === account),
      (r) => r.amountPaise,
    );
    const other = sum(
      ledgerDay.filter(
        (e) => e.account === account && !EXPENSE_TYPES.includes(e.type),
      ),
      (e) => e.amountPaise,
    );
    return {
      openingPaise: open,
      receiptsPaise: receiptPaise,
      otherPaise: other, // transfers, petty cash top-ups, opening-balance entries of this day
      expensePaise: spent,
      closingPaise: open + receiptPaise + other - spent,
    };
  };
  const cashReceipts = sum(
    receipts.filter((r) => r.mode === "cash"),
    (r) => r.totalPaise,
  );
  const cash = block("cash", cashReceipts);

  // Every active bank, plus any bank that has money movements even if it was switched off.
  const bankIds = new Set(banks.map((b) => String(b._id)));
  for (const k of Object.keys(opening))
    if (k.startsWith("bank:")) bankIds.add(k.slice(5));
  for (const e of ledgerDay)
    if (e.account.startsWith("bank:")) bankIds.add(e.account.slice(5));
  for (const r of receipts)
    if (r.mode !== "cash" && r.bankId) bankIds.add(String(r.bankId));
  const banksOut = [...bankIds].map((id) => {
    const rec = sum(
      receipts.filter((r) => r.mode !== "cash" && String(r.bankId) === id),
      (r) => r.totalPaise,
    );
    return {
      id,
      name: bankName.get(id) ?? "Bank",
      ...block(`bank:${id}`, rec),
    };
  });
  const online = {
    banks: banksOut,
    // UPI / QR receipts with no bank chosen (old receipts) are not in any bank's balance.
    unassignedPaise: sum(
      receipts.filter((r) => r.mode !== "cash" && !r.bankId),
      (r) => r.totalPaise,
    ),
    openingPaise: sum(banksOut, (b) => b.openingPaise),
    receiptsPaise: sum(banksOut, (b) => b.receiptsPaise),
    otherPaise: sum(banksOut, (b) => b.otherPaise),
    expensePaise: sum(banksOut, (b) => b.expensePaise),
    closingPaise: sum(banksOut, (b) => b.closingPaise),
  };

  // Transport vendor account (needs the Admin's settings).
  const heads = (settings?.transportHeads ?? []).map((h) => h.toLowerCase());
  const tExpenseRows = expenseRows.filter((r) =>
    heads.includes(r.head.toLowerCase()),
  );
  const configured = !!settings?.transportStartDate;
  const started = configured && date >= settings.transportStartDate;
  const tIncomeCash = bus.cashPaise;
  const tIncomeOnline = bus.onlinePaise;
  const tExpense = sum(tExpenseRows, (r) => r.amountPaise);
  const tOpening = started
    ? date === settings.transportStartDate
      ? (settings.transportOpeningPaise ?? 0)
      : (transportBefore ?? 0)
    : 0;
  const transport = {
    configured,
    started,
    startDate: settings?.transportStartDate ?? null,
    heads: settings?.transportHeads ?? [],
    openingPaise: tOpening,
    incomeCashPaise: tIncomeCash,
    incomeOnlinePaise: tIncomeOnline,
    incomePaise: tIncomeCash + tIncomeOnline,
    expenseRows: tExpenseRows,
    expensePaise: tExpense,
    closingPaise: tOpening + tIncomeCash + tIncomeOnline - tExpense,
  };

  return {
    date,
    closed: dayClose?.status === "closed",
    closedBy:
      dayClose?.status === "closed" ? (dayClose.closedByName ?? null) : null,
    cancelledToday,
    school,
    bus,
    expenses: { rows: expenseRows, totalPaise: expenseTotal },
    cash,
    online,
    transport,
    // Grand picture for the top cards.
    totals: {
      receiptsPaise: school.totalPaise + bus.totalPaise,
      expensePaise: expenseTotal,
      closingPaise: cash.closingPaise + online.closingPaise,
    },
  };
}
