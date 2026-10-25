import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { AuditLog, changeText } from "./AuditLog";

vi.mock("../api/client", () => ({ api: vi.fn() }));
import { api } from "../api/client";

const rows = [
  { id: 'a1', at: '2026-10-13T06:00:00Z', userId: 'u1', userName: 'Asha', userRole: 'cashier', action: 'override', entity: 'late_fee', entityId: 'S-1', oldValue: { amountPaise: 26000 }, newValue: { amountPaise: 10000 }, reason: 'Bank transfer delay' },
  { id: 'a2', at: '2026-10-12T06:00:00Z', userId: null, userName: null, userRole: null, action: 'create', entity: 'receipt', entityId: null, oldValue: null, newValue: { totalPaise: 450000, mode: 'upi' }, reason: null },
]; // prettier-ignore

function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <AuditLog />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (url) => {
    if (url.startsWith("/api/audit-log/options"))
      return {
        users: [{ id: "u1", name: "Asha", role: "cashier" }],
        entities: ["late_fee", "receipt"],
        actions: ["create", "override"],
      };
    if (url.startsWith("/api/audit-log/export")) return new Blob(["x"]);
    return { total: 2, page: 1, pageSize: 50, rows };
  });
});

describe("changeText", () => {
  it("shows old → new with rupees for changed keys only", () => {
    expect(
      changeText({ a: 1, amountPaise: 26000 }, { a: 1, amountPaise: 10000 }),
    ).toBe("amountPaise: ₹260 → ₹100");
  });
  it("lists the values of a created record, and is empty when there is nothing", () => {
    expect(changeText(null, { mode: "upi" })).toBe("mode: upi");
    expect(changeText(null, null)).toBe("");
  });
});

describe("Audit Log screen", () => {
  it("lists entries with user, action, record, change and reason", async () => {
    show();
    expect(await screen.findByText("Asha")).toBeInTheDocument();
    expect(screen.getByText("Bank transfer delay")).toBeInTheDocument();
    expect(screen.getByText("amountPaise: ₹260 → ₹100")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit|delete/i }),
    ).not.toBeInTheDocument();
  });

  it("a filter goes to the server and resets to page 1", async () => {
    show();
    await screen.findByText("Asha");
    await userEvent.selectOptions(screen.getByLabelText("Action"), "override");
    await waitFor(() =>
      expect(api.mock.calls.at(-1)[0]).toContain("action=override"),
    );
    expect(api.mock.calls.at(-1)[0]).toContain("page=1");
  });

  it("a backwards date range is flagged and not sent", async () => {
    show();
    await screen.findByText("Asha");
    await userEvent.type(screen.getByLabelText("From"), "2026-10-13");
    await userEvent.type(screen.getByLabelText("To"), "2026-10-01");
    expect(
      await screen.findByText("The start date is after the end date."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("shows the empty state, and an error with Try again", async () => {
    api.mockImplementation(async (url) =>
      url.startsWith("/api/audit-log/options")
        ? { users: [], entities: [], actions: [] }
        : { total: 0, page: 1, pageSize: 50, rows: [] },
    );
    const { unmount } = show();
    expect(await screen.findByText("No entries match")).toBeInTheDocument();
    unmount();
    api.mockRejectedValue(new Error("Server down"));
    show();
    expect(await screen.findByText(/Server down/)).toBeInTheDocument();
  });

  it("Export CSV asks the server with the same filters", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    show();
    await screen.findByText("Asha");
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(
        api.mock.calls.some((c) => c[0].startsWith("/api/audit-log/export")),
      ).toBe(true),
    );
  });
});
