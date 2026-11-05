import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getAllByRole("link", { name: "View" }).length).toBe(2);
    expect(screen.queryByRole("button", { name: /Apply fees/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add rebate/ })).toBeNull();
  });
  it("Cashier can only look: no export, no edit; Collect Fee opens with the student", async () => {
    mockRole = "cashier";
    show();
    expect(await screen.findByText("Asha")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Collect Fee" })[0],
    ).toHaveAttribute("href", "/collect-fee?student=1");
    expect(
      screen.queryByRole("button", { name: "Export to Excel" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Apply fees/ })).toBeNull();
  });
  it("shows the Figma columns; the receivable / paid columns appear when ticked in Columns", async () => {
    mockRole = "admin";
    show();
    await screen.findByText("Asha");
    for (const h of [
      "Scholar ID",
      "Address / Village",
      "Contact No.",
      "Old School Due",
      "Old Bus Due",
      "New School Due",
      "New Bus Due",
      "Total Dues",
      "Late Fee (Penalty)",
      "Status",
      "Actions",
    ])
      expect(
        screen.getByRole("columnheader", {
          name: new RegExp(`^${h.replace(/[()/.]/g, "\\$&")}$`, "i"),
        }),
      ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Adm fees rec." }),
    ).toBeNull();
    expect(
      screen.queryByRole("columnheader", { name: "New School Receivable" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(screen.getByLabelText("Adm fees rec."));
    await userEvent.click(screen.getByLabelText("New school receivable"));
    expect(
      screen.getByRole("columnheader", { name: "Adm fees rec." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "New school receivable" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Old Bus Due"));
    expect(
      screen.queryByRole("columnheader", { name: "Old Bus Due" }),
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
    await userEvent.click(screen.getByRole("button", { name: "All students" }));
    await vi.waitFor(() => expect(last()).not.toContain("transport=true"));
    expect(last()).not.toContain("feeStatus=");
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
  it("More filters are sent to the server", async () => {
    mockRole = "principal";
    show();
    await screen.findByText("Asha");
    await userEvent.click(screen.getByRole("button", { name: "More filters" }));
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

  it("shows the late fee in its own column; there is no Waive late fee button any more", async () => {
    mockRole = "admin";
    api.mockResolvedValue({
      ...data,
      rows: [row({ lateFeePaise: 10000 })],
      total: 1,
    });
    show();
    expect(
      await screen.findByRole("columnheader", { name: "Late Fee (Penalty)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Waive/ })).toBeNull();
  });

  it("nobody gets Edit Old Fees in the list: it lives on the Student Fee Details page", async () => {
    for (const r of ["admin", "cashier", "principal"]) {
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
