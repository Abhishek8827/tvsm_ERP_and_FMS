import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { Approvals } from "./Approvals";

vi.mock("../api/client", () => ({ api: vi.fn() }));
import { api } from "../api/client";

const cancels = {
  total: 1,
  rows: [
    {
      id: 'c1', status: 'requested', reason: 'Wrong amount typed', requestedByName: 'Ravi',
      receiptNumber: 'S-FY2026-27/0001',
      receipt: { id: 'r1', number: 'S-FY2026-27/0001', mode: 'cash', totalPaise: 150000, studentName: 'Asha', admissionNo: '7' },
    },
  ],
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
          <Approvals />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Principal approvals", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation(async (url) => {
      if (url.startsWith("/api/receipt-cancellations?")) return cancels;
      if (url.startsWith("/api/vouchers")) return { total: 0, rows: [] };
      if (url === "/api/money/pending") return { vouchers: 0, reversals: 2 };
      return { ok: true };
    });
  });

  it("lists requests with the receipt facts, and shows the other waiting items", async () => {
    show();
    expect(await screen.findByText("Wrong amount typed")).toBeInTheDocument();
    expect(screen.getByText("Asha (7)")).toBeInTheDocument();
    expect(await screen.findByText("No vouchers waiting")).toBeInTheDocument();
    expect(await screen.findByText(/waiting\./)).toBeInTheDocument();
  });

  it("allows retrying a failed reversal request without automatic retrying", async () => {
    let attempts = 0;
    api.mockImplementation(async (url) => {
      if (url.startsWith("/api/receipt-cancellations?")) return cancels;
      if (url.startsWith("/api/vouchers")) return { total: 0, rows: [] };
      if (url === "/api/money/pending") {
        attempts += 1;
        if (attempts === 1) throw new Error("Temporary server error");
        return { vouchers: 0, reversals: 2 };
      }
      return { ok: true };
    });
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );
    expect(await screen.findByText(/waiting\./)).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("approve asks first, then calls the approve endpoint", async () => {
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Approve" }),
    );
    expect(api.mock.calls.some((c) => String(c[0]).endsWith("/approve"))).toBe(
      false,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Cancel the receipt" }),
    );
    expect(
      api.mock.calls.some(
        (c) => c[0] === "/api/receipt-cancellations/c1/approve",
      ),
    ).toBe(true);
  });

  it("reject needs a reason before it can be sent", async () => {
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Reject" }),
    );
    const dialog = screen.getByRole("dialog");
    const send = within(dialog).getByRole("button", { name: "Reject request" });
    expect(send).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText(/Reason/),
      "Receipt is correct",
    );
    await userEvent.click(send);
    const call = api.mock.calls.find(
      (c) => c[0] === "/api/receipt-cancellations/c1/reject",
    );
    expect(call[1].body).toEqual({ reason: "Receipt is correct" });
  });
});
