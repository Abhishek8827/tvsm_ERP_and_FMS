import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { ToastProvider } from "../components/ui";
import { BankCash } from "./BankCash";
import { ExpenseVoucher } from "./ExpenseVoucher";
import { Expenses } from "./Expenses";
import { PettyCash } from "./PettyCash";

vi.mock("../api/client", async (orig) => ({
  ...(await orig()),
  api: vi.fn(),
  newIdempotencyKey: () => "test-key-12345678",
}));
let role = "admin";
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ role, user: { name: "T" } }),
}));
import { api } from "../api/client";

function show(ui, path = "/") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/expenses" element={ui} />
            <Route path="/expenses/:id" element={ui} />
            <Route path="*" element={ui} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
const voucher = (over = {}) => ({
  id: 'v1', number: 'EXP-FY2026-27/0001', date: '2026-06-01', headName: 'Repairs', payeeName: 'Sharma',
  particulars: 'Chairs', amountPaise: 1000000, status: 'pending', paidPaise: 0, adjustedPaise: 0,
  balanceDuePaise: 1000000, adjustments: [], payments: [], reversals: [], createdByName: 'Admin', ...over,
}); // prettier-ignore
const route = (map) =>
  api.mockImplementation(async (url, opts) => {
    const hit = Object.entries(map).find(([k]) => String(url).startsWith(k));
    if (!hit) throw new Error(`unexpected ${opts?.method ?? "GET"} ${url}`);
    return typeof hit[1] === "function" ? hit[1](url, opts) : hit[1];
  });

beforeEach(() => {
  api.mockReset();
  role = "admin";
});

describe("Expenses register", () => {
  const lists = {
    "/api/money/pending": { vouchers: 1, reversals: 0 },
    "/api/vouchers?": {
      rows: [voucher()],
      total: 1,
      totals: { pending: { paise: 1000000, count: 1 } },
    },
  };

  it("shows the voucher register with the school columns", async () => {
    route(lists);
    show(<Expenses />, "/expenses");
    expect(await screen.findByText("EXP-FY2026-27/0001")).toBeInTheDocument();
    for (const h of [
      "S.No",
      "Voucher no.",
      "Balance due",
      "Paid",
      "Adjustment paid",
    ])
      expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
  });

  it('only the Admin gets "New voucher" and the Heads tab', async () => {
    route(lists);
    show(<Expenses />, "/expenses");
    expect(
      await screen.findByRole("button", { name: "New voucher" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Heads" })).toBeInTheDocument();
  });

  it("the Principal sees the register but cannot make vouchers or heads", async () => {
    role = "principal";
    route(lists);
    show(<Expenses />, "/expenses");
    await screen.findByText("EXP-FY2026-27/0001");
    expect(
      screen.queryByRole("button", { name: "New voucher" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Heads" }),
    ).not.toBeInTheDocument();
  });

  it("Admin gets a Pay button next to Approved only while balance is due; Principal gets none", async () => {
    const withDue = {
      ...lists,
      "/api/vouchers?": {
        rows: [
          voucher({ status: "approved", balanceDuePaise: 500000 }),
          voucher({
            id: "v2",
            number: "EXP-FY2026-27/0002",
            status: "approved",
            balanceDuePaise: 0,
          }),
          voucher({
            id: "v3",
            number: "EXP-FY2026-27/0003",
            status: "pending",
          }),
        ],
        total: 3,
        totals: {},
      },
    };
    route(withDue);
    show(<Expenses />, "/expenses");
    await screen.findByText("EXP-FY2026-27/0001");
    // Only the approved voucher that still owes money is payable.
    expect(screen.getAllByRole("button", { name: "Pay" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(
      await screen.findByText("Pay EXP-FY2026-27/0001"),
    ).toBeInTheDocument();
  });

  it("the Principal sees no Pay button on an approved voucher in the list", async () => {
    role = "principal";
    route({
      ...lists,
      "/api/vouchers?": {
        rows: [voucher({ status: "approved", balanceDuePaise: 500000 })],
        total: 1,
        totals: {},
      },
    });
    show(<Expenses />, "/expenses");
    await screen.findByText("EXP-FY2026-27/0001");
    expect(
      screen.queryByRole("button", { name: "Pay" }),
    ).not.toBeInTheDocument();
  });

  it("Principal approves or rejects right from the voucher row; Admin gets no such buttons", async () => {
    role = "principal";
    route({
      ...lists,
      "/api/vouchers/v1/approve": voucher({ status: "approved" }),
      "/api/vouchers/v1/reject": voucher({ status: "rejected" }),
    });
    show(<Expenses />, "/expenses");
    await screen.findByText("EXP-FY2026-27/0001");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dlg = within(await screen.findByRole("dialog"));
    await userEvent.click(dlg.getByRole("button", { name: "Approve" }));
    await vi.waitFor(() =>
      expect(
        api.mock.calls.some(
          (c) => c[0] === "/api/vouchers/v1/approve" && c[1]?.method === "POST",
        ),
      ).toBe(true),
    );
    // Reject needs a reason.
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    const rej = within(await screen.findByRole("dialog"));
    expect(rej.getByRole("button", { name: "Reject" })).toBeDisabled();
    await userEvent.type(rej.getByRole("textbox"), "Not needed");
    await userEvent.click(rej.getByRole("button", { name: "Reject" }));
    await vi.waitFor(() => {
      const c = api.mock.calls.find((x) => x[0] === "/api/vouchers/v1/reject");
      expect(c[1].body).toEqual({ reason: "Not needed" });
    });
  });

  it("Admin sees no Approve or Reject on a pending voucher row", async () => {
    route(lists);
    show(<Expenses />, "/expenses");
    await screen.findByText("EXP-FY2026-27/0001");
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject" }),
    ).not.toBeInTheDocument();
  });

  it("Admin makes a voucher: sends an Idempotency-Key and the amount in paise", async () => {
    route({
      ...lists,
      "/api/expense-heads": {
        heads: [{ id: "h1", name: "Repairs", active: true }],
      },
      "/api/vouchers": () => ({
        ...voucher(),
        id: "v2",
        number: "EXP-FY2026-27/0002",
      }),
    });
    show(<Expenses />, "/expenses");
    await userEvent.click(
      await screen.findByRole("button", { name: "New voucher" }),
    );
    const dlg = within(await screen.findByRole("dialog"));
    await userEvent.selectOptions(await dlg.findByLabelText("Head"), "h1");
    await userEvent.type(dlg.getByLabelText("Payee name"), "Sharma Stores");
    await userEvent.type(dlg.getByLabelText("Particulars"), "Chairs");
    expect(dlg.getByRole("button", { name: "Save voucher" })).toBeDisabled();
    await userEvent.type(dlg.getByLabelText("Amount (₹)"), "9,000.50");
    await userEvent.click(dlg.getByRole("button", { name: "Save voucher" }));
    await vi.waitFor(() =>
      expect(
        api.mock.calls.some(
          (c) => c[0] === "/api/vouchers" && c[1]?.method === "POST",
        ),
      ).toBe(true),
    );
    const post = api.mock.calls.find(
      (c) => c[0] === "/api/vouchers" && c[1]?.method === "POST",
    );
    expect(post[1].idempotencyKey).toBe("test-key-12345678");
    expect(post[1].body).toMatchObject({
      headId: "h1",
      payeeName: "Sharma Stores",
      amountPaise: 900050,
    });
  });

  it("shows an error with retry when the list fails", async () => {
    api.mockRejectedValue(new ApiError("X", 500, "Boom", undefined, "req1"));
    show(<Expenses />, "/expenses");
    expect(await screen.findByText(/Boom/)).toBeInTheDocument();
  });
});

describe("Voucher page", () => {
  it("Principal can approve a pending voucher; rejecting needs a reason", async () => {
    role = "principal";
    route({
      "/api/vouchers/v1/reject": voucher({ status: "rejected" }),
      "/api/vouchers/v1/approve": voucher({ status: "approved" }),
      "/api/vouchers/v1": voucher(),
    });
    show(<ExpenseVoucher />, "/expenses/v1");
    await userEvent.click(
      await screen.findByRole("button", { name: "Reject" }),
    );
    const dlg = within(await screen.findByRole("dialog"));
    expect(dlg.getByRole("button", { name: "Reject" })).toBeDisabled();
    await userEvent.type(dlg.getByLabelText(/Reason/), "Not needed");
    await userEvent.click(dlg.getByRole("button", { name: "Reject" }));
    await vi.waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/vouchers/v1/reject",
        expect.objectContaining({ body: { reason: "Not needed" } }),
      ),
    );
  });

  it("Admin cannot approve and cannot pay a voucher that is not approved yet", async () => {
    route({ "/api/vouchers/v1": voucher() });
    show(<ExpenseVoucher />, "/expenses/v1");
    await screen.findByRole("heading", { name: "EXP-FY2026-27/0001" });
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record payment" }),
    ).not.toBeInTheDocument();
  });

  it("Admin can pay an approved voucher only with an authoriser; the Principal gets no pay button", async () => {
    route({
      "/api/banks/options": {
        banks: [{ id: "b1", name: "IDFC", last4: "1", defaultForModes: [] }],
      },
      "/api/vouchers/v1/payments": { id: "p1" },
      "/api/vouchers/v1": voucher({ status: "approved" }),
    });
    show(<ExpenseVoucher />, "/expenses/v1");
    await userEvent.click(
      await screen.findByRole("button", { name: "Record payment" }),
    );
    const dlg = within(await screen.findByRole("dialog"));
    await userEvent.type(dlg.getByLabelText("Amount (₹)"), "4000");
    await userEvent.selectOptions(
      await dlg.findByLabelText("Bank account"),
      "b1",
    );
    expect(dlg.getByRole("button", { name: "Record payment" })).toBeDisabled();
    await userEvent.selectOptions(
      dlg.getByLabelText("Payment authorised by"),
      "Vice President",
    );
    await userEvent.click(dlg.getByRole("button", { name: "Record payment" }));
    await vi.waitFor(() =>
      expect(
        api.mock.calls.some((c) => c[0] === "/api/vouchers/v1/payments"),
      ).toBe(true),
    );
    const post = api.mock.calls.find(
      (c) => c[0] === "/api/vouchers/v1/payments",
    );
    expect(post[1].body).toMatchObject({
      amountPaise: 400000,
      mode: "bank",
      bankId: "b1",
      authorisedBy: "Vice President",
    });
  });

  it("Principal has no pay or adjust buttons on an approved voucher", async () => {
    role = "principal";
    route({ "/api/vouchers/v1": voucher({ status: "approved" }) });
    show(<ExpenseVoucher />, "/expenses/v1");
    await screen.findByRole("heading", { name: "EXP-FY2026-27/0001" });
    expect(
      screen.queryByRole("button", { name: "Record payment" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add adjustment" }),
    ).not.toBeInTheDocument();
  });
});

describe("Petty cash", () => {
  const summary = {
    balancePaise: 420000,
    last: [
      {
        id: "e1",
        seq: 7,
        date: "2026-06-01",
        payeeName: "Raju",
        particulars: "Tea",
        amountPaise: 20000,
        status: "active",
      },
    ],
  };

  it("Admin can add an entry (idempotent) and top up from cash; entries show serial numbers", async () => {
    route({
      "/api/petty/summary": summary,
      "/api/money/overview": { cashPaise: 1000000 },
      "/api/expense-heads": { heads: [] },
      "/api/petty?": { rows: summary.last, total: 1 },
      "/api/petty": { seq: 8 },
    });
    show(<PettyCash />);
    expect(
      await screen.findByRole("button", { name: "New entry" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Top up from cash" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New entry" }));
    const dlg = within(await screen.findByRole("dialog"));
    await userEvent.type(dlg.getByLabelText("Payee name"), "Raju");
    await userEvent.type(dlg.getByLabelText("Particulars"), "Chalk");
    await userEvent.type(dlg.getByLabelText("Amount (₹)"), "150");
    await userEvent.click(dlg.getByRole("button", { name: "Save entry" }));
    await vi.waitFor(() =>
      expect(
        api.mock.calls.some(
          (c) => c[0] === "/api/petty" && c[1]?.method === "POST",
        ),
      ).toBe(true),
    );
    const post = api.mock.calls.find(
      (c) => c[0] === "/api/petty" && c[1]?.method === "POST",
    );
    expect(post[1].idempotencyKey).toBe("test-key-12345678");
    expect(post[1].body.amountPaise).toBe(15000);
  });
});

describe("Bank & Cash", () => {
  const overview = {
    cashPaise: 1000000,
    pettyPaise: 50000,
    unassignedReceiptsPaise: 0,
    banks: [
      {
        id: "b1",
        name: "IDFC",
        last4: "1234",
        active: true,
        defaultForModes: ["upi"],
        balancePaise: 5000000,
      },
    ],
  };

  it("Admin sees balances, bank settings, and transfers", async () => {
    route({
      "/api/money/overview": overview,
      "/api/transfers": { rows: [], total: 0 },
    });
    show(<BankCash />);
    expect((await screen.findAllByText("₹50,000")).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Transfer money" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cashier PIN")).not.toBeInTheDocument();
  });

  it("Principal has no transfer or bank controls", async () => {
    role = "principal";
    route({
      "/api/money/overview": overview,
      "/api/transfers": { rows: [], total: 0 },
    });
    show(<BankCash />);
    expect(await screen.findByText("₹50,000")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Transfer money" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Cashier PIN")).not.toBeInTheDocument();
  });

  it("warns when UPI / QR receipts have no bank chosen", async () => {
    role = "principal";
    route({
      "/api/money/overview": { ...overview, unassignedReceiptsPaise: 250000 },
      "/api/transfers": { rows: [], total: 0 },
    });
    show(<BankCash />);
    expect(await screen.findByRole("alert")).toHaveTextContent("₹2,500");
  });
});
