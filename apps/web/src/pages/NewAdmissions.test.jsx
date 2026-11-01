import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { ToastProvider } from "../components/ui";
import { NewAdmissions } from "./NewAdmissions";

vi.mock("../api/client", async (orig) => ({
  ...(await orig()),
  api: vi.fn(),
  newIdempotencyKey: () => "test-key-12345678",
}));
let role = "admin";
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ role, user: { name: "T" } }),
}));
import { api } from "../api/client";

const dues = (formLeft, admLeft) => ({
  form: { duePaise: 10000, paidPaise: 10000 - formLeft, leftPaise: formLeft, status: formLeft ? 'unpaid' : 'paid' },
  admission: { duePaise: 500000, paidPaise: 500000 - admLeft, leftPaise: admLeft, status: admLeft === 500000 ? 'unpaid' : admLeft ? 'partial' : 'paid' },
  collectedPaise: 10000 - formLeft + 500000 - admLeft,
  outstandingPaise: formLeft + admLeft,
}); // prettier-ignore
const row = (over = {}) => ({
  id: 'a1', session: '2026-27', formNo: 'NEW/2026-27/001', status: 'pending', statusLabel: 'Decision Pending',
  name: 'Riya Sharma', fatherName: 'Mohan', classKey: '1', formSubmittedOn: '2026-11-01',
  dues: dues(10000, 500000), scholarNo: null, ...over,
}); // prettier-ignore

let rows;
let handlers;
function setup(who = "admin") {
  role = who;
  api.mockReset();
  api.mockImplementation(async (url, opts) => {
    const u = String(url);
    for (const [prefix, fn] of Object.entries(handlers))
      if (u.startsWith(prefix)) return fn(u, opts);
    if (u.startsWith("/api/admissions/settings"))
      return { session: "2026-27", formFeePaise: 10000 };
    if (u.startsWith("/api/admissions?"))
      return { rows, total: rows.length, page: 1, pageSize: 25 };
    if (u.startsWith("/api/banks/options"))
      return { banks: [{ id: "b1", name: "SBI", defaultForModes: ["upi"] }] };
    throw new Error(`unexpected ${opts?.method ?? "GET"} ${u}`);
  });
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter>
          <NewAdmissions />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  rows = [row()];
  handlers = {};
});

describe("New Admissions screen", () => {
  it("lists forms with fee status, collected and outstanding", async () => {
    setup();
    const cell = await screen.findByText("NEW/2026-27/001");
    const tr = cell.closest("tr");
    expect(within(tr).getByText("Riya Sharma")).toBeInTheDocument();
    expect(within(tr).getAllByText("Unpaid").length).toBe(2);
    expect(within(tr).getByText("Decision Pending")).toBeInTheDocument();
  });

  it("Cashier can add and collect but has no Edit, Status or Change session; Principal only looks", async () => {
    setup("cashier");
    await screen.findByText("NEW/2026-27/001");
    expect(
      screen.getByRole("button", { name: "Add admission form" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collect fee" }),
    ).toBeInTheDocument();
    for (const n of ["Edit", "Status", "Change session"])
      expect(screen.queryByRole("button", { name: n })).toBeNull();
  });
  it("the Principal has no add or collect buttons", async () => {
    setup("principal");
    await screen.findByText("NEW/2026-27/001");
    for (const n of ["Add admission form", "Collect fee", "Edit", "Status"])
      expect(screen.queryByRole("button", { name: n })).toBeNull();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
  });

  it("a possible duplicate warns first; Save anyway still saves", async () => {
    handlers["/api/admissions/similar"] = () => ({
      students: [
        { id: "s1", admissionNo: "1100", name: "Riya Sharma", classKey: "1" },
      ],
      admissions: [],
    });
    handlers["/api/admissions"] = (u, opts) =>
      opts?.method === "POST"
        ? { id: "a2", formNo: "NEW/2026-27/002" }
        : { rows, total: 1 };
    // the list call also starts with /api/admissions, so route by method
    const user = userEvent.setup();
    setup();
    await screen.findByText("NEW/2026-27/001");
    await user.click(
      screen.getByRole("button", { name: "Add admission form" }),
    );
    await user.type(screen.getByLabelText(/Child's name/), "Riya Sharma");
    await user.selectOptions(screen.getByLabelText(/^Class/), "1");
    await user.click(screen.getByRole("button", { name: "Save form" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already in the system/,
    );
    expect(api.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => {
      const post = api.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post[0]).toBe("/api/admissions");
      expect(post[1].body).toMatchObject({
        name: "Riya Sharma",
        classKey: "1",
      });
      expect(post[1].idempotencyKey).toBe("test-key-12345678");
    });
  });

  it("collect fee sends the pending amounts as paise with one Idempotency-Key", async () => {
    const user = userEvent.setup();
    setup("cashier");
    await screen.findByText("NEW/2026-27/001");
    await user.click(screen.getByRole("button", { name: "Collect fee" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Form fee (₹)")).toHaveValue("100");
    await user.clear(within(dialog).getByLabelText("Admission fee (₹)"));
    await user.type(within(dialog).getByLabelText("Admission fee (₹)"), "2000");
    handlers["/api/admissions/a1/receipts"] = () => ({
      receipt: { number: "A-FY2026-27/0001" },
    });
    await user.click(within(dialog).getByRole("button", { name: /^Collect/ }));
    await waitFor(() => {
      const post = api.mock.calls.find(
        (c) => c[0] === "/api/admissions/a1/receipts",
      );
      expect(post[1].body).toEqual({
        input: { formPaise: 10000, admissionPaise: 200000 },
        mode: "cash",
      });
      expect(post[1].idempotencyKey).toBe("test-key-12345678");
    });
  });

  it("Admit shows the next scholar number; if it changed it shows the new one and asks again", async () => {
    const user = userEvent.setup();
    let next = "1251";
    handlers["/api/admissions/next-scholar-no"] = () => ({ scholarNo: next });
    let calls = 0;
    handlers["/api/admissions/a1/admit"] = (u, opts) => {
      calls += 1;
      if (calls === 1)
        throw new ApiError(
          "SCHOLAR_NO_CHANGED",
          409,
          "Next free number is 1252.",
          {
            scholarNo: "1252",
          },
        );
      return { id: "a1", status: "admitted", scholarNo: opts.body.scholarNo };
    };
    setup();
    await screen.findByText("NEW/2026-27/001");
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.selectOptions(
      screen.getByLabelText("Admission status"),
      "admitted",
    );
    expect(await screen.findByTestId("scholar-no")).toHaveTextContent("1251");
    await user.click(screen.getByRole("button", { name: "Confirm and admit" }));
    await waitFor(() =>
      expect(screen.getByTestId("scholar-no")).toHaveTextContent("1252"),
    );
    expect(
      screen.getByText(/Another admission took the earlier number/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm and admit" }));
    await waitFor(() => {
      const posts = api.mock.calls.filter(
        (c) => c[0] === "/api/admissions/a1/admit",
      );
      expect(posts.map((c) => c[1].body.scholarNo)).toEqual(["1251", "1252"]);
    });
    next = "1253";
  });

  it("cancelling sends the status and the optional reason", async () => {
    const user = userEvent.setup();
    handlers["/api/admissions/a1/status"] = () => ({
      id: "a1",
      status: "cancelled",
    });
    setup();
    await screen.findByText("NEW/2026-27/001");
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.selectOptions(
      screen.getByLabelText("Admission status"),
      "cancelled",
    );
    await user.type(screen.getByLabelText(/Reason/), "Joined elsewhere");
    await user.click(screen.getByRole("button", { name: "Save status" }));
    await waitFor(() => {
      const post = api.mock.calls.find(
        (c) => c[0] === "/api/admissions/a1/status",
      );
      expect(post[1].body).toEqual({
        status: "cancelled",
        reason: "Joined elsewhere",
      });
    });
  });
});
