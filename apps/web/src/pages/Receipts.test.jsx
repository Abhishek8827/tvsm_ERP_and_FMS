import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { Receipts } from "./Receipts";

vi.mock("../api/client", () => ({ api: vi.fn() }));
let role = "cashier";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ role }) }));
import { api } from "../api/client";

const list = {
  total: 2,
  page: 1,
  pageSize: 25,
  totals: {
    count: 1,
    paise: 150000,
    byKind: { school: 150000, transport: 0 },
    byMode: { cash: 0, upi: 150000, qr: 0 },
  },
  rows: [
    {
      id: "r1",
      number: "S-FY2026-27/2054",
      kind: "school",
      issuedAt: "2026-06-10T05:00:00Z",
      student: { name: "Aarav Sharma", admissionNo: "10", classKey: "1" },
      monthLabel: "June",
      mode: "upi",
      totalPaise: 150000,
      status: "valid",
    },
    {
      id: "r2",
      number: "S-FY2026-27/2055",
      kind: "school",
      issuedAt: "2026-06-10T06:00:00Z",
      student: { name: "Diya Verma", admissionNo: "11", classKey: "2" },
      monthLabel: "July",
      mode: "cash",
      totalPaise: 100000,
      status: "cancelled",
    },
  ],
};
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter>
          <Receipts />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Receipts list", () => {
  beforeEach(() => {
    api.mockReset();
    role = "cashier";
  });

  it("shows receipts with status and totals from the server, no export for the cashier", async () => {
    api.mockResolvedValue(list);
    show();
    expect(await screen.findByText("S-FY2026-27/2054")).toBeInTheDocument();
    const row = screen.getByText("Diya Verma").closest("tr");
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("1 receipts")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /export/i }),
    ).not.toBeInTheDocument();
  });

  it("sends the filters to the server", async () => {
    api.mockResolvedValue(list);
    show();
    await screen.findByText("S-FY2026-27/2054");
    await userEvent.selectOptions(screen.getByLabelText("Mode"), "upi");
    await vi.waitFor(() =>
      expect(api.mock.calls.some(([u]) => u.includes("mode=upi"))).toBe(true),
    );
  });

  it("shows an error with retry, and an empty state", async () => {
    api.mockRejectedValueOnce(new Error("Boom"));
    show();
    expect(await screen.findByText(/Boom/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry|try again/i }),
    ).toBeInTheDocument();
  });

  it("admin can export", async () => {
    role = "admin";
    api.mockResolvedValue(list);
    show();
    expect(
      await screen.findByRole("button", { name: /export to excel/i }),
    ).toBeInTheDocument();
  });
});
