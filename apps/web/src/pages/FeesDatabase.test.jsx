import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { FeesDatabase } from "./FeesDatabase";

vi.mock("../api/client", () => ({ api: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from "../api/client";

let mockRole = "admin";
const row = (o) => ({
  id: '1', admissionNo: '7', name: 'Asha', fatherName: 'Ram', classKey: '5th', section: 'A',
  village: '', usesTransport: false, planPosted: true, billedPaise: 1000000, paidPaise: 200000,
  rebatePaise: 0, outstandingPaise: 800000, dueNowPaise: 300000, overduePaise: 0, lateFeePaise: 0,
  school: {}, transport: {}, status: 'active', address: 'Ward 4', contactNo: '9876543210',
  cols: { oldSchoolDue: 50000, oldBusDue: 0, newSchoolReceivable: 900000, newBusReceivable: 0, admReceivable: 0, formReceivable: 0, newSchoolPaid: 200000, newBusPaid: 0, admPaid: 0, formPaid: 0, schoolRebate: 0, transportRebate: 0, admissionRebate: 0, newSchoolDue: 250000, newBusDue: 0, admDue: 0, formDue: 0 },
  ...o,
}); // prettier-ignore
const data = {
  fy: '2026-27', page: 1, pageSize: 25, total: 2,
  totals: { students: 2, billedPaise: 1000000, paidPaise: 200000, rebatePaise: 0, outstandingPaise: 800000, dueNowPaise: 300000, overduePaise: 0, lateFeePaise: 0 },
  rows: [row({}), row({ id: '2', name: 'Ravi', planPosted: false })],
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
          <FeesDatabase />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Fees Database", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue(data);
  });
  it("Admin sees rows, totals and export; no Apply fees or Add rebate (fees post automatically)", async () => {
    mockRole = "admin";
    show();
    expect(await screen.findByText("Asha")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export to Excel" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Fees not posted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply fees/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add rebate/ })).toBeNull();
  });
  it("Cashier can only look: no export, no waive", async () => {
    mockRole = "cashier";
    show();
    expect(await screen.findByText("Asha")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export to Excel" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Apply fees/ })).toBeNull();
  });
  it("shows the school sheet columns; Address is hidden until ticked in Columns", async () => {
    mockRole = "admin";
    show();
    await screen.findByText("Asha");
    for (const h of [
      "S.No",
      "Sch. ID",
      "Old school due",
      "Old bus due",
      "Total dues",
      "Status",
    ])
      expect(
        screen.getByRole("columnheader", { name: new RegExp(`^${h}$`, "i") }),
      ).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Address" })).toBeNull();
    expect(
      screen.queryByRole("columnheader", { name: "Adm fees rec." }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(screen.getByLabelText("Address"));
    await userEvent.click(screen.getByLabelText("Adm fees rec."));
    expect(
      screen.getByRole("columnheader", { name: "Address" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Adm fees rec." }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Old bus due"));
    expect(
      screen.queryByRole("columnheader", { name: "Old bus due" }),
    ).toBeNull();
  });
  it("quick lists send the right filters: defaulters, school paid + bus pending, transport only", async () => {
    mockRole = "principal";
    show();
    await screen.findByText("Asha");
    const last = () => String(api.mock.calls.at(-1)[0]);
    await userEvent.click(screen.getByRole("button", { name: "Defaulters" }));
    await vi.waitFor(() => expect(last()).toContain("feeStatus=pending"));
    await userEvent.click(
      screen.getByRole("button", { name: "School paid, bus pending" }),
    );
    await vi.waitFor(() =>
      expect(last()).toContain("feeStatus=school_paid_bus_pending"),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Only transport students" }),
    );
    await vi.waitFor(() => expect(last()).toContain("transport=true"));
  });
  it('"Dues up to" month is sent as upto=YYYY-MM', async () => {
    mockRole = "admin";
    show();
    await screen.findByText("Asha");
    await userEvent.selectOptions(
      screen.getByLabelText("Dues up to"),
      "2026-09",
    );
    await vi.waitFor(() =>
      expect(
        api.mock.calls.some((c) => String(c[0]).includes("upto=2026-09")),
      ).toBe(true),
    );
  });
  it("advanced filters are sent to the server", async () => {
    mockRole = "principal";
    show();
    await screen.findByText("Asha");
    await userEvent.click(
      screen.getByRole("button", { name: "Advanced filters" }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Uses bus"), "true");
    expect(
      api.mock.calls.some((c) => String(c[0]).includes("transport=true")),
    ).toBe(true);
  });
  it("shows an error with retry when the server fails", async () => {
    mockRole = "admin";
    api.mockRejectedValue(new Error("boom"));
    show();
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });

  it("shows the late fee in its own column, and Admin can waive it with a reason", async () => {
    mockRole = "admin";
    api.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/fees-database"))
        return { ...data, rows: [row({ lateFeePaise: 10000 })], total: 1 };
      if (String(url).includes("/ledger"))
        return {
          instalments: [
            { period: "jun", lateFee: 10000 },
            { period: "jul", lateFee: 10000 },
          ],
        };
      return { ok: true };
    });
    show();
    expect(
      await screen.findByRole("columnheader", { name: "Late fee (penalty)" }),
    ).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole("button", { name: "Waive late fee" }),
    );
    const dialog = await screen.findByRole("dialog");
    const waive = await within(dialog).findByRole("button", { name: /^Waive/ });
    expect(waive).toBeDisabled(); // reason missing
    await userEvent.type(
      within(dialog).getByLabelText(/Reason/),
      "Family problem",
    );
    await userEvent.click(within(dialog).getByLabelText(/jul/));
    await userEvent.click(waive);
    const call = api.mock.calls.find((c) =>
      String(c[0]).endsWith("/late-fee-waivers"),
    );
    expect(call[1].body).toEqual({
      fy: "2026-27",
      periods: ["jun"],
      reason: "Family problem",
    });
  });
  it("Cashier never gets the waive button", async () => {
    mockRole = "cashier";
    api.mockResolvedValue({
      ...data,
      rows: [row({ lateFeePaise: 10000 })],
      total: 1,
    });
    show();
    expect(await screen.findByText("Asha")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Waive late fee" })).toBeNull();
  });
});
