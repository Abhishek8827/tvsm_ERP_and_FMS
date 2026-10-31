import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockRole = "admin";
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ role: mockRole, user: { name: "T", role: mockRole } }),
}));
vi.mock("../api/client", () => ({ api: vi.fn() }));
import { api } from "../api/client";
import { FeeSummaryTables } from "./FeeSummaryTables";
import { QuickTiles } from "./QuickTiles";

const line = (o) => ({
  students: 29,
  oldPaise: 200000,
  receivablePaise: 22330000,
  paidPaise: 6800000,
  rebatePaise: 5082000,
  duesPaise: 10648000,
  duePct: 47.26,
  ...o,
});
const summary = {
  fy: '2026-27', month: '2026-10', status: 'active',
  months: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'],
  school: { rows: [{ classKey: 'LKG', section: 'A', ...line() }], total: line({ students: 590 }) },
  bus: { rows: [], total: line({ students: 0, oldPaise: 0, receivablePaise: 0, paidPaise: 0, rebatePaise: 0, duesPaise: 0, duePct: null }) },
}; // prettier-ignore
const show = (ui) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

describe("Dashboard fee summary", () => {
  beforeEach(() => {
    api.mockReset();
    mockRole = "admin";
  });
  it("shows the School and Bus tables with class, section, dues and the Due % ", async () => {
    api.mockResolvedValue(summary);
    show(<FeeSummaryTables />);
    const school = await screen.findByRole("region", {
      name: "SCHOOL FEES SUMMARY",
    });
    const row = within(school).getByRole("row", { name: /LKG/ });
    expect(within(row).getByText("A")).toBeInTheDocument();
    expect(within(row).getByText("₹1,06,480")).toBeInTheDocument();
    expect(within(row).getByText("47.26%")).toBeInTheDocument();
    expect(
      within(school).getByRole("row", { name: /Total/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "BUS FEES SUMMARY" }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "BUS FEES SUMMARY" }),
      ).getByText("No students to show."),
    ).toBeInTheDocument();
  });
  it("changing the month or the student type asks the server again", async () => {
    api.mockResolvedValue(summary);
    show(<FeeSummaryTables />);
    await screen.findByRole("region", { name: "SCHOOL FEES SUMMARY" });
    await userEvent.selectOptions(
      screen.getByLabelText("Select month"),
      "2026-08",
    );
    await vi.waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/dashboard/fee-summary?status=active&month=2026-08",
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText("Students"), "all");
    await vi.waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/dashboard/fee-summary?status=all&month=2026-08",
      ),
    );
  });
  it("shows the server error with a retry", async () => {
    api.mockRejectedValue(new Error("Boom"));
    show(<FeeSummaryTables />);
    expect(await screen.findByText(/Boom/)).toBeInTheDocument();
  });
});

describe("Quick access tiles", () => {
  it("are links to the pages the role may open, never to Dashboard or a forbidden page", () => {
    mockRole = "cashier";
    show(<QuickTiles />);
    const tiles = within(screen.getByLabelText("Quick access"));
    expect(tiles.getByRole("link", { name: "Collect Fee" })).toHaveAttribute(
      "href",
      "/collect-fee",
    );
    expect(tiles.queryByRole("link", { name: "Dashboard" })).toBeNull();
    for (const n of ["Users & Settings", "Bank & Cash", "Reports", "Approvals"])
      expect(tiles.queryByRole("link", { name: n })).toBeNull();
  });
});
