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
import { Dashboard } from "./Dashboard";
import { FeeSummaryTables } from "./FeeSummaryTables";

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

describe("Dashboard (Admin)", () => {
  const overview = {
    fy: '2026-27',
    funds: {
      cashPaise: 1000000,
      pettyPaise: 200000,
      banks: [
        { id: 'b1', name: 'IDFC', balancePaise: 5000000 },
        { id: 'b2', name: 'Kotak', balancePaise: 1500000 },
      ],
    },
    fees: { students: 10, billedPaise: 0, paidPaise: 0, rebatePaise: 0, dueNowPaise: 0, overduePaise: 0, outstandingPaise: 0 },
    noPlanStudents: 0,
    feePlan: null,
    classes: [],
    pending: { cancellations: 0, vouchers: 0, reversals: 0 },
    today: { paise: 0, count: 0 },
  }; // prettier-ignore
  beforeEach(() => {
    api.mockReset();
    mockRole = "admin";
    api.mockImplementation(async (url) => {
      if (url === "/api/dashboard/overview") return overview;
      if (String(url).startsWith('/api/dashboard/class-strength'))
        return String(url).endsWith('inactive')
          ? { status: 'inactive', rows: [{ classKey: '5', students: 2 }], totalStudents: 2 }
          : { status: 'active', rows: [{ classKey: 'LKG', students: 31 }, { classKey: '1', students: 40 }], totalStudents: 71 }; // prettier-ignore
      if (url === "/api/health") return { status: "ok", db: "connected" };
      return {};
    });
  });
  it("funds: each bank by name, then total cash + total online = total funds", async () => {
    show(<Dashboard />);
    expect(await screen.findByText("IDFC")).toBeInTheDocument();
    expect(screen.getByText("Kotak")).toBeInTheDocument();
    const totals = within(screen.getByTestId("funds-total"));
    expect(totals.getByText("Total cash").nextSibling).toHaveTextContent(
      "₹12,000",
    );
    expect(totals.getByText("Total online").nextSibling).toHaveTextContent(
      "₹65,000",
    );
    expect(totals.getByText("Total funds").nextSibling).toHaveTextContent(
      "₹77,000",
    );
  });
  it("the School / Bus fee summary tables are no longer on the Dashboard", async () => {
    show(<Dashboard />);
    await screen.findByText("IDFC");
    expect(screen.queryByText("SCHOOL FEES SUMMARY")).toBeNull();
    expect(
      api.mock.calls.some((c) => String(c[0]).includes("fee-summary")),
    ).toBe(false);
  });
  it("class strength shows active students and switches to inactive", async () => {
    show(<Dashboard />);
    expect(await screen.findByText("71 students")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Show"), "inactive");
    expect(await screen.findByText("2 students")).toBeInTheDocument();
  });
});
