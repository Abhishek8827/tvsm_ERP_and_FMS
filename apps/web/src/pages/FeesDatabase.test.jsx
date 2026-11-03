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
  it("Cashier can only look: no export, no edit", async () => {
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

  const oldFee = (over = {}) => ({
    billedPaise: 500000,
    importedPaise: 500000,
    paidPaise: 100000,
    concessionPaise: 0,
    outstandingPaise: 400000,
    ...over,
  });
  const detailsReply = {
    fy: "2026-27",
    summary: {
      oldSchool: oldFee(),
      oldTransport: oldFee({ billedPaise: 0, importedPaise: 0, paidPaise: 0 }),
    },
  };

  it("shows the late fee in its own column; there is no Waive late fee button any more", async () => {
    mockRole = "admin";
    api.mockResolvedValue({
      ...data,
      rows: [row({ lateFeePaise: 10000 })],
      total: 1,
    });
    show();
    expect(
      await screen.findByRole("columnheader", { name: "Late fee (penalty)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Waive/ })).toBeNull();
  });

  it("Admin edits the old fee: types the new total, a reason is compulsory, and the server gets paise", async () => {
    mockRole = "admin";
    api.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/fees-database"))
        return { ...data, rows: [row()], total: 1 };
      if (String(url).includes("/fee-details")) return detailsReply;
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
    mockRole = "admin";
    api.mockImplementation(async (url, opts) => {
      if (String(url).startsWith("/api/fees-database"))
        return { ...data, rows: [row()], total: 1 };
      if (String(url).includes("/fee-details")) return detailsReply;
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

  it("Cashier and Principal never get the Edit Old Fees button", async () => {
    for (const r of ["cashier", "principal"]) {
      mockRole = r;
      api.mockResolvedValue({ ...data, rows: [row()], total: 1 });
      const { unmount } = show();
      expect(await screen.findByText("Asha")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit Old Fees" }),
      ).toBeNull();
      unmount();
    }
  });
});
