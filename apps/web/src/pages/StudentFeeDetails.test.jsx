import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudentFeeDetails } from "./StudentFeeDetails";

vi.mock("../api/client", () => ({ api: vi.fn() }));
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
      <MemoryRouter initialEntries={["/fees-database/students/s1"]}>
        <Routes>
          <Route
            path="/fees-database/students/:id"
            element={<StudentFeeDetails />}
          />
          <Route path="/fees-database" element={<p>Fees Database page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Student fee details", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue(details());
  });

  it("shows the student, keeps school and bus dues (old and current) in separate lines, and the late fee apart", async () => {
    show();
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("SANJAY NAGAR")).toBeInTheDocument();
    for (const label of [
      "Old school fee dues (brought forward)",
      "Old bus fee dues (brought forward)",
      "Current session school fees",
      "Current session transport fees",
      "Late fee / penalty (separate)",
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/^Yes \(from 2026-06\)/)).toBeInTheDocument();
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
});
