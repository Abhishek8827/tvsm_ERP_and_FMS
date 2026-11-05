import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { StudentFeeDetails } from "./StudentFeeDetails";

vi.mock("../api/client", () => ({ api: vi.fn() }));
let mockRole = "admin";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from "../api/client";

const group = (b, c, p, o) => ({
  billedPaise: b,
  concessionPaise: c,
  paidPaise: p,
  outstandingPaise: o,
});
const details = (over = {}) => ({
  fy: '2026-27',
  student: {
    id: 's1',
    name: 'Aarav Sharma',
    admissionNo: '10',
    fatherName: 'Rajesh',
    classKey: '1',
    section: 'A',
    address: 'SANJAY NAGAR',
    contactNo: '9876543210',
    status: 'active',
    usesTransport: true,
    transportFrom: '2026-06',
    transportUntil: null,
  },
  planPosted: true,
  summary: {
    oldSchool: group(200000, 0, 0, 200000),
    oldTransport: group(50000, 0, 0, 50000),
    currentSchool: group(1000000, 100000, 300000, 600000),
    currentTransport: group(300000, 0, 100000, 200000),
    totals: { billedPaise: 1550000, concessionPaise: 100000, paidPaise: 400000, outstandingPaise: 1050000, lateFeePaise: 50000 },
  },
  payments: [
    { id: 'r2', number: 'S-FY2026-27/0002', issuedAt: '2026-07-10T05:00:00Z', status: 'cancelled', totalPaise: 50000, schoolPaise: 50000, transportPaise: 0, otherPaise: 0, mode: 'cash', reference: null, cancellation: { status: 'cancelled', reason: 'Wrong amount', decidedByName: 'Principal' } },
    { id: 'r1', number: 'S-FY2026-27/0001', issuedAt: '2026-06-10T05:00:00Z', status: 'valid', totalPaise: 400000, schoolPaise: 300000, transportPaise: 100000, otherPaise: 0, mode: 'upi', reference: 'UPI998877', cancellation: null },
  ],
  paymentTotals: { count: 1, totalPaise: 400000 },
  ...over,
}); // prettier-ignore

function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter initialEntries={["/fees-database/students/s1"]}>
          <Routes>
            <Route
              path="/fees-database/students/:id"
              element={<StudentFeeDetails />}
            />
            <Route path="/fees-database" element={<p>Fees Database page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Student fee details", () => {
  beforeEach(() => {
    api.mockReset();
    mockRole = "admin";
    api.mockResolvedValue(details());
  });

  it("shows the student card and the fee summary: old dues, current session, and the totals", async () => {
    show();
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("SANJAY NAGAR")).toBeInTheDocument();
    for (const label of [
      "Old School Fee",
      "Old Bus Fee",
      "Total Old Due",
      "School Fee (Receivable)",
      "Bus Fee (Receivable)",
      "Total Current",
      "Total Billed",
      "Total Paid",
      "Outstanding",
      "Late Fee (Penalty)",
      "Amount to be Paid",
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Total Old Due").nextSibling).toHaveTextContent(
      "₹2,500",
    );
    expect(screen.getByText("Amount to be Paid").nextSibling).toHaveTextContent(
      "₹11,000",
    );
    expect(
      screen.getByText(/^Transport: Yes \(from 2026-06\)/),
    ).toBeInTheDocument();
  });

  it("the Fee Ledger tab keeps school and bus dues (old and current) in separate lines", async () => {
    show();
    await screen.findByText("Aarav Sharma");
    await userEvent.click(screen.getByRole("tab", { name: "Fee Ledger" }));
    for (const label of [
      "Old school fee dues (brought forward)",
      "Old bus fee dues (brought forward)",
      "Current session school fees",
      "Current session transport fees",
      "Late fee / penalty (separate)",
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("Admin and Cashier get Collect Fee (it opens with this student); the Principal does not", async () => {
    show();
    expect(
      await screen.findByRole("link", { name: /Collect Fee/ }),
    ).toHaveAttribute("href", "/collect-fee?student=s1");
    expect(
      screen.getByRole("link", { name: /Back to Fees Database/ }),
    ).toHaveAttribute("href", "/fees-database");
  });
  it("Principal has no Collect Fee button", async () => {
    mockRole = "principal";
    show();
    await screen.findByText("Aarav Sharma");
    expect(screen.queryByRole("link", { name: /Collect Fee/ })).toBeNull();
  });

  it("lists every receipt with its school / transport split; a cancelled one shows who cancelled and why and is not counted", async () => {
    show();
    const link = await screen.findByRole("link", { name: "S-FY2026-27/0001" });
    expect(link).toHaveAttribute("href", "/receipts/r1");
    const row = link.closest("tr");
    expect(within(row).getByText("₹3,000")).toBeInTheDocument(); // school part
    expect(within(row).getByText("₹1,000")).toBeInTheDocument(); // transport part
    expect(within(row).getByText(/UPI \/ QR/)).toBeInTheDocument();
    const gone = screen
      .getByRole("link", { name: "S-FY2026-27/0002" })
      .closest("tr");
    expect(within(gone).getByText("Cancelled")).toBeInTheDocument();
    expect(
      within(gone).getByText(/Wrong amount \(by Principal\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/in 1\s+receipts\. Cancelled receipts are not counted/),
    ).toBeInTheDocument();
  });

  it("shows imported vs corrected old fees and the correction history; only the Admin gets Edit Old Fees", async () => {
    api.mockResolvedValue(
      details({
        summary: {
          ...details().summary,
          oldSchool: { ...group(300000, 0, 0, 300000), importedPaise: 500000 },
        },
        oldFeeCorrections: [
          { id: 'a1', effectiveDate: '2026-06-01', label: 'Old school fee', previousPaise: 500000, newPaise: 300000, reason: 'Joined mid session', createdByName: 'Admin' },
        ],
      }),
    ); // prettier-ignore
    show();
    await screen.findByText("Aarav Sharma");
    await userEvent.click(screen.getByRole("tab", { name: "Fee Ledger" }));
    expect(
      await screen.findByText(/Imported ₹5,000, corrected by the Admin/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("tab", { name: "Adjustments & Edits" }),
    );
    expect(screen.getByText("Joined mid session")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Old Fees" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Admin only")).toBeInTheDocument();
  });

  it("Cashier does not see Edit Old Fees", async () => {
    mockRole = "cashier";
    show();
    await screen.findByText("Aarav Sharma");
    expect(screen.queryByRole("button", { name: "Edit Old Fees" })).toBeNull();
  });

  it("filters are sent to the server", async () => {
    show();
    await screen.findByText("Aarav Sharma");
    await userEvent.selectOptions(
      screen.getByLabelText("Fee category"),
      "transport",
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Payment mode"),
      "cash",
    );
    await vi.waitFor(() => {
      const url = String(api.mock.calls.at(-1)[0]);
      expect(url).toContain("category=transport");
      expect(url).toContain("mode=cash");
    });
  });

  it("shows an error state with Retry when the server fails", async () => {
    api.mockRejectedValue(new Error("Server is down"));
    show();
    expect(await screen.findByText(/Server is down/)).toBeInTheDocument();
  });

  const oldFee = (over = {}) => ({
    billedPaise: 500000,
    importedPaise: 500000,
    paidPaise: 100000,
    concessionPaise: 0,
    outstandingPaise: 400000,
    ...over,
  });
  const editReply = {
    fy: "2026-27",
    summary: {
      ...details().summary,
      oldSchool: oldFee(),
      oldTransport: oldFee({ billedPaise: 0, importedPaise: 0, paidPaise: 0 }),
    },
  };

  it("Admin edits the old fee: types the new total, a reason is compulsory, and the server gets paise", async () => {
    api.mockImplementation(async (url) => {
      if (String(url).includes("/fee-details"))
        return { ...details(), ...editReply };
      return { id: "a1" };
    });
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Old Fees" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(/Already paid or rebated/),
    ).toBeInTheDocument();
    const save = within(dialog).getByRole("button", {
      name: "Save correction",
    });
    expect(save).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText(/New total old fee/),
      "3000",
    );
    expect(save).toBeDisabled(); // reason missing
    await userEvent.type(
      within(dialog).getByLabelText(/Reason/),
      "Joined mid session",
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Fee category"),
      "transport",
    );
    await userEvent.click(save);
    const call = api.mock.calls.find((c) =>
      String(c[0]).endsWith("/old-fee-adjustments"),
    );
    expect(call[1].body).toMatchObject({
      fy: "2026-27",
      category: "transport",
      newTotalPaise: 300000,
      reason: "Joined mid session",
    });
  });

  it("shows the server message when the new total is below what was paid", async () => {
    api.mockImplementation(async (url, opts) => {
      if (String(url).includes("/fee-details"))
        return { ...details(), ...editReply };
      if (opts?.method === "POST")
        throw Object.assign(
          new Error("Rs 1,000 has already been paid against this old fee."),
          {
            status: 409,
            fields: { newTotalPaise: "Lower than already paid" },
          },
        );
      return {};
    });
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Old Fees" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      await within(dialog).findByLabelText(/New total old fee/),
      "500",
    );
    await userEvent.type(
      within(dialog).getByLabelText(/Reason/),
      "Wrong import",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save correction" }),
    );
    expect(
      await within(dialog).findByText("Lower than already paid"),
    ).toBeInTheDocument();
  });
});
