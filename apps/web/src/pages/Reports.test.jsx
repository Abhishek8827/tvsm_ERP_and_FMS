import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { Reports } from "./Reports";

vi.mock("../api/client", () => ({ api: vi.fn() }));
vi.mock("../lib/printHtml", () => ({ printHtml: vi.fn().mockResolvedValue() }));
let mockRole = "admin";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from "../api/client";
import { printHtml } from "../lib/printHtml";

const ie = {
  from: '2026-04-01', to: '2026-10-13', basis: 'cash', compare: null,
  income: [{ key: 'tuition', label: 'Tuition fees (including old fees)', paise: 600000 }],
  expenditure: [{ key: 'salaries', label: 'Salaries', paise: 250000 }],
  totalIncomePaise: 600000, totalExpenditurePaise: 250000, surplusPaise: 350000,
}; // prettier-ignore
const bs = {
  asOn: '2026-10-13', basis: 'cash',
  assets: [{ key: 'cash', label: 'Cash in hand', paise: 300000 }],
  funds: [{ key: 'capital', label: 'Capital / reserve fund (opening)', paise: 100000 }],
  totalAssetsPaise: 300000, totalFundsPaise: 100000, differencePaise: 200000,
  memo: { feeReceivablePaise: 900000, payablesPaise: 4000 },
}; // prettier-ignore
const tb = {
  from: '2026-04-01', to: '2026-10-13',
  rows: [{ label: 'Cash in hand', debitPaise: 500, creditPaise: 0 }, { label: 'Income: X', debitPaise: 0, creditPaise: 500 }],
  totalDebitPaise: 500, totalCreditPaise: 500, differencePaise: 0,
}; // prettier-ignore
const db = {
  from: '2026-04-01', to: '2026-10-13', total: 1, page: 1, pageSize: 50, totalInPaise: 1000, totalOutPaise: 0,
  rows: [{ id: 'r1', at: '2026-10-01T05:00:00Z', type: 'Fee receipt', ref: 'S-1', particulars: 'Asha (7)', account: 'Cash', inPaise: 1000, outPaise: 0 }],
}; // prettier-ignore

function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <Reports />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRole = "admin";
  api.mockReset();
  api.mockImplementation(async (url) => {
    if (url.startsWith("/api/reports/income-expenditure")) return ie;
    if (url.startsWith("/api/reports/balance-sheet")) return bs;
    if (url.startsWith("/api/reports/trial-balance")) return tb;
    if (url.startsWith("/api/reports/day-book")) return db;
    if (url.startsWith("/api/reports/settings"))
      return {
        set: true,
        fixedAssetsPaise: 100000,
        capitalPaise: 200000,
        history: [],
      };
    return {};
  });
});

describe("Reports screen", () => {
  it("opens on Income & Expenditure with the surplus and both columns", async () => {
    show();
    expect(
      await screen.findByText("Tuition fees (including old fees)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Salaries")).toBeInTheDocument();
    expect(screen.getByText("Surplus for the period")).toBeInTheDocument();
    expect(api.mock.calls[0][0]).toContain("compare=none");
  });

  it("Compare with asks the server for the previous period", async () => {
    show();
    await screen.findByText("Salaries");
    await userEvent.selectOptions(
      screen.getByLabelText("Compare with"),
      "previous",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Update report" }),
    );
    await waitFor(() =>
      expect(api.mock.calls.at(-1)[0]).toContain("compare=previous"),
    );
  });

  it("Balance Sheet shows the difference warning and the memo items", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Balance Sheet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("differ by");
    expect(
      screen.getByText("Approved expenses not yet paid"),
    ).toBeInTheDocument();
    expect(api.mock.calls.at(-1)[0]).toContain("asOn=");
  });

  it("Trial Balance and Day Book load", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Trial Balance" }));
    expect(await screen.findByText("Income: X")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Day Book" }));
    expect(await screen.findByText("Asha (7)")).toBeInTheDocument();
    expect(screen.getByText("Money in (whole period)")).toBeInTheDocument();
  });

  it("a backwards date range cannot be applied", async () => {
    show();
    await screen.findByText("Salaries");
    const from = screen.getByLabelText("From");
    await userEvent.clear(from);
    await userEvent.type(from, "2999-01-01");
    expect(
      screen.getByRole("button", { name: "Update report" }),
    ).toBeDisabled();
  });

  it("shows an error with Try again when the server fails", async () => {
    api.mockRejectedValue(new Error("Server down"));
    show();
    expect(await screen.findByText(/Server down/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("prints the statement and exports to Excel", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    show();
    await screen.findByText("Salaries");
    await userEvent.click(screen.getByRole("button", { name: "Print (A4)" }));
    await waitFor(() => expect(printHtml).toHaveBeenCalled());
    expect(printHtml.mock.calls[0][0].html).toContain("Total expenditure");
    await userEvent.click(
      screen.getByRole("button", { name: "Export to Excel" }),
    );
    await waitFor(() =>
      expect(
        api.mock.calls.some(
          (c) =>
            c[0].includes("/api/reports/export?") &&
            c[0].includes("type=income-expenditure"),
        ),
      ).toBe(true),
    );
  });

  it("only the Admin sees Opening balances, and saving needs a reason", async () => {
    show();
    await screen.findByText("Salaries");
    await userEvent.click(
      screen.getByRole("button", { name: "Opening balances" }),
    );
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save" });
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Fixed assets (₹)")).toHaveValue(
        "1000.00",
      ),
    );
    expect(save).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText("Reason for this entry"),
      "Opening figures",
    );
    await userEvent.click(save);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/reports/settings",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });

  it("the Principal has no Opening balances button", async () => {
    mockRole = "principal";
    show();
    await screen.findByText("Salaries");
    expect(
      screen.queryByRole("button", { name: "Opening balances" }),
    ).not.toBeInTheDocument();
  });
});
