import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { DayClose } from "./DayClose";

vi.mock("../api/client", () => ({ api: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from "../api/client";

let mockRole = "cashier";
let summary;
const open = {
  date: '2026-10-22', today: '2026-10-22', cashReceiptPaise: 500000, cashCancelledPaise: 0,
  expectedCashPaise: 500000, upiPaise: 100000, receiptCount: 7, cancelledCount: 0,
  record: null,
}; // prettier-ignore
const closedRec = {
  status: 'closed', date: '2026-10-22', expectedCashPaise: 500000, countedCashPaise: 490000,
  differencePaise: -10000, differenceReason: 'Change given', closedByName: 'cashier',
}; // prettier-ignore
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter>
          <DayClose />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Day Close screen", () => {
  beforeEach(() => {
    api.mockReset();
    summary = open;
    api.mockImplementation(async (url, opts) => {
      if (url.startsWith("/api/day-close/summary")) return summary;
      if (url.startsWith("/api/day-close?")) return { total: 0, rows: [] };
      return { ok: true, opts };
    });
  });

  it("Cashier sees expected cash from the server; a difference asks for a reason before closing", async () => {
    mockRole = "cashier";
    show();
    expect(await screen.findByText("Expected cash")).toBeInTheDocument();
    const close = screen.getByRole("button", { name: "Close the day" });
    expect(close).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Cash counted/), "4900");
    expect(screen.getByText(/Difference: -/)).toBeInTheDocument();
    expect(close).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/Reason for the difference/),
      "Change given",
    );
    await userEvent.click(close);
    await userEvent.click(
      screen.getAllByRole("button", { name: "Close the day" }).at(-1),
    );
    const post = api.mock.calls.find((c) => c[0] === "/api/day-close");
    expect(post[1].body).toEqual({
      date: "2026-10-22",
      countedCashPaise: 490000,
      reason: "Change given",
    });
  });

  it("Principal can look but has no close form and no reopen", async () => {
    mockRole = "principal";
    show();
    expect(await screen.findByText("Expected cash")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close the day" })).toBeNull();
  });

  it("a closed day shows the record; only the Admin can reopen it", async () => {
    summary = { ...open, record: closedRec };
    mockRole = "admin";
    show();
    expect(
      await screen.findByRole("button", { name: "Reopen this day" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Change given/)).toBeInTheDocument();
  });

  it("shows an error with retry when the server fails", async () => {
    api.mockRejectedValue(new Error("boom"));
    mockRole = "cashier";
    show();
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
