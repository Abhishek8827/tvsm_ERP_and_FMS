import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { CollectFee } from "./CollectFee";

vi.mock("../api/client", () => ({
  api: vi.fn(),
  newIdempotencyKey: () => "test-key-12345678",
}));
import { api } from "../api/client";

const student = {
  id: "s1",
  admissionNo: "10",
  name: "Aarav Sharma",
  classKey: "1",
  section: "A",
  fatherName: "Rajesh",
  status: "active",
  usesTransport: true,
};
const dues = (over = {}) => ({
  kind: "school",
  fy: "2026-27",
  remaining: { tuition: 100000, old_fees: 0 },
  lateFeeCalculatedPaise: 0,
  dueNowPaise: 100000,
  instalments: [
    {
      period: "2026-06",
      dueDate: "2026-06-15",
      due: 100000,
      isDue: true,
      isOverdue: false,
    },
  ],
  ...over,
});
function show(path = "/") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<CollectFee />} />
            <Route path="/receipts/:id" element={<p>Receipt page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
async function pickStudent() {
  await userEvent.type(screen.getByLabelText("Search student"), "aarav");
  await userEvent.click(
    await screen.findByRole("button", { name: /Aarav Sharma/ }),
  );
}

describe("Collect Fee", () => {
  beforeEach(() => {
    api.mockReset();
  });

  it("shows a friendly picture before a student is searched, and removes it once typing starts", async () => {
    api.mockResolvedValue({ rows: [] });
    show();
    expect(screen.getByTestId("find-student-art")).toBeInTheDocument();
    expect(
      screen.getByText("Find a student to get started"),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search student"), "aa");
    await waitFor(() =>
      expect(screen.queryByTestId("find-student-art")).toBeNull(),
    );
  });

  it("opens with the student already chosen when the link has ?student=", async () => {
    api.mockImplementation(async (url) => {
      if (url === "/api/students/s1") return student;
      if (String(url).includes("/dues")) return dues();
      throw new Error(`unexpected ${url}`);
    });
    show("/?student=s1");
    expect(await screen.findByText(/Aarav Sharma/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Tuition fees/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Search student")).toBeNull();
  });
  it("does not preselect an inactive student", async () => {
    api.mockImplementation(async (url) => {
      if (url === "/api/students/s1") return { ...student, status: "inactive" };
      throw new Error(`unexpected ${url}`);
    });
    show("/?student=s1");
    expect(await screen.findByText(/is inactive/)).toBeInTheDocument();
    expect(screen.getByLabelText("Search student")).toBeInTheDocument();
  });

  it("finds a student, collects, sends an Idempotency-Key and opens the receipt", async () => {
    api.mockImplementation(async (url, opts) => {
      if (String(url).startsWith("/api/students?")) return { rows: [student] };
      if (String(url).includes("/dues")) return dues();
      if (url === "/api/receipts")
        return { id: "r1", number: "S-FY2026-27/0001" };
      throw new Error(`unexpected ${url} ${opts?.method}`);
    });
    show();
    await pickStudent();
    await userEvent.type(await screen.findByLabelText(/Tuition fees/), "1000");
    expect(screen.getByText("Total to collect: ₹1,000")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Collect ₹1,000/ }),
    );
    expect(await screen.findByText("Receipt page")).toBeInTheDocument();
    const post = api.mock.calls.find((c) => c[0] === "/api/receipts");
    expect(post[1].idempotencyKey).toBe("test-key-12345678");
    expect(post[1].body).toMatchObject({
      studentId: "s1",
      kind: "school",
      mode: "cash",
      input: { newPaise: 100000, oldPaise: 0 },
    });
  });

  const banksReply = (defaults = ["upi"]) => ({
    banks: [
      { id: "b1", name: "IDFC", last4: "1234", defaultForModes: defaults },
      { id: "b2", name: "Kotak", last4: "9876", defaultForModes: [] },
    ],
  });

  it("UPI needs a reference and a bank (the default bank is preselected) before Collect is allowed", async () => {
    api.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/students?")) return { rows: [student] };
      if (url === "/api/banks/options") return banksReply();
      if (url === "/api/receipts")
        return { id: "r1", number: "S-FY2026-27/0001" };
      return dues();
    });
    show();
    await pickStudent();
    await userEvent.type(await screen.findByLabelText(/Tuition fees/), "1000");
    await userEvent.click(screen.getByRole("checkbox", { name: "Cash" })); // cash off
    await userEvent.click(screen.getByRole("checkbox", { name: "UPI / QR" })); // UPI on
    expect(screen.getByRole("button", { name: /Collect/ })).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/UPI \/ QR reference/),
      "UPI998877",
    );
    await vi.waitFor(() =>
      expect(screen.getByLabelText("Bank account")).toHaveValue("b1"),
    );
    expect(screen.getByRole("button", { name: /Collect/ })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /Collect/ }));
    await screen.findByText("Receipt page");
    const post = api.mock.calls.find((c) => c[0] === "/api/receipts");
    expect(post[1].body).toMatchObject({
      mode: "upi",
      reference: "UPI998877",
      bankId: "b1",
    });
  });

  it("cash + UPI (no checkbox): the UPI box takes what cash leaves, must add up, then posts payments[]", async () => {
    api.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/students?")) return { rows: [student] };
      if (url === "/api/banks/options") return banksReply();
      if (url === "/api/receipts")
        return { id: "r1", number: "S-FY2026-27/0001" };
      return dues();
    });
    show();
    await pickStudent();
    await userEvent.type(await screen.findByLabelText(/Tuition fees/), "3500");
    await userEvent.click(screen.getByRole("checkbox", { name: "UPI / QR" }));
    await userEvent.clear(screen.getByLabelText(/Cash amount/));
    await userEvent.type(screen.getByLabelText(/Cash amount/), "2000");
    // The bank box fills itself with the rest.
    expect(screen.getByLabelText(/Bank amount/)).toHaveValue("1500");
    await userEvent.type(
      screen.getByLabelText(/UPI \/ QR reference/),
      "UTR123456",
    );
    await vi.waitFor(() =>
      expect(screen.getByLabelText("Bank account")).toHaveValue("b1"),
    );
    // A typed bank amount that does not add up is refused.
    await userEvent.clear(screen.getByLabelText(/Bank amount/));
    await userEvent.type(screen.getByLabelText(/Bank amount/), "1000");
    expect(await screen.findByText(/₹500 still missing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Collect/ })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Bank amount/));
    await userEvent.type(screen.getByLabelText(/Bank amount/), "1500");
    expect(
      await screen.findByText(/Payments match the total/),
    ).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /Collect/ })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: /Collect/ }));
    await screen.findByText("Receipt page");
    const post = api.mock.calls.find((c) => c[0] === "/api/receipts");
    expect(post[1].body.mode).toBeUndefined();
    expect(post[1].body.payments).toEqual([
      { mode: "cash", amountPaise: 200000 },
      {
        mode: "upi",
        amountPaise: 150000,
        bankId: "b1",
        reference: "UTR123456",
      },
    ]);
  });

  it('there is no split checkbox and no separate "Payment Details" window any more', async () => {
    api.mockImplementation(async (url) =>
      String(url).startsWith("/api/students?") ? { rows: [student] } : dues(),
    );
    show();
    await pickStudent();
    await screen.findByLabelText(/Tuition fees/);
    expect(screen.queryByLabelText(/more than one mode/)).toBeNull();
    expect(screen.queryByText("Payment Details")).toBeNull();
    expect(screen.queryByText("Fees to collect")).toBeNull();
    expect(screen.getByText("Collect & Pay")).toBeInTheDocument();
  });

  it("the amount boxes start with what is due today (old fees + due months), and can be lowered", async () => {
    api.mockImplementation(
      async (url) =>
      String(url).startsWith('/api/students?')
        ? { rows: [student] }
        : dues({
            remaining: { tuition: 450000, old_fees: 200000 },
            dueNowPaise: 300000,
            instalments: [
              { period: '2026-06', dueDate: '2026-06-15', due: 150000, isDue: false, isOverdue: true, items: [{ head: 'tuition', due: 150000 }] },
              { period: '2026-07', dueDate: '2026-07-15', due: 150000, isDue: true, isOverdue: false, items: [{ head: 'tuition', due: 150000 }] },
              { period: '2026-08', dueDate: '2026-08-15', due: 150000, isDue: false, isOverdue: false, items: [{ head: 'tuition', due: 150000 }] },
            ],
          }), // prettier-ignore
    );
    show();
    await pickStudent();
    expect(await screen.findByLabelText(/Tuition fees/)).toHaveValue("3000");
    expect(screen.getByLabelText(/Old fees/)).toHaveValue("2000");
    expect(screen.getByText("Total to collect: ₹5,000")).toBeInTheDocument();
    expect(screen.getByLabelText(/Cash amount/)).toHaveValue("5000");
    await userEvent.clear(screen.getByLabelText(/Tuition fees/));
    await userEvent.type(screen.getByLabelText(/Tuition fees/), "1500");
    expect(screen.getByText("Total to collect: ₹3,500")).toBeInTheDocument();
  });

  it("without a default bank the Cashier must choose one for UPI / QR", async () => {
    api.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/students?")) return { rows: [student] };
      if (url === "/api/banks/options") return banksReply([]);
      return dues();
    });
    show();
    await pickStudent();
    await userEvent.type(await screen.findByLabelText(/Tuition fees/), "1000");
    await userEvent.click(screen.getByRole("checkbox", { name: "Cash" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "UPI / QR" }));
    await userEvent.type(
      screen.getByLabelText(/UPI \/ QR reference/),
      "QR12345678",
    );
    expect(screen.getByRole("button", { name: /Collect/ })).toBeDisabled();
    await userEvent.selectOptions(
      await screen.findByLabelText("Bank account"),
      "b2",
    );
    expect(screen.getByRole("button", { name: /Collect/ })).toBeEnabled();
  });

  it("reducing the late fee shows a compulsory reason box and blocks Collect until it is filled", async () => {
    api.mockImplementation(async (url) =>
      String(url).startsWith("/api/students?")
        ? { rows: [student] }
        : dues({ lateFeeCalculatedPaise: 10000 }),
    );
    show();
    await pickStudent();
    await userEvent.type(await screen.findByLabelText(/Tuition fees/), "1000");
    expect(screen.queryByLabelText(/Reason for reducing/)).toBeNull();
    const late = screen.getByLabelText(/Late fee to charge/);
    await userEvent.clear(late);
    await userEvent.type(late, "40");
    expect(screen.getByRole("button", { name: /Collect/ })).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/Reason for reducing/),
      "Bank delay",
    );
    expect(screen.getByRole("button", { name: /Collect/ })).toBeEnabled();
  });

  it("transport tab asks for transport dues and has no T.C. / Other boxes", async () => {
    api.mockImplementation(async (url) =>
      String(url).startsWith("/api/students?") ? { rows: [student] } : dues(),
    );
    show();
    await pickStudent();
    await screen.findByLabelText(/Tuition fees/);
    expect(screen.getByLabelText(/T\.C\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Transport Fees" }));
    await screen.findByLabelText(/Transport fees \(₹\)/);
    expect(screen.queryByLabelText(/T\.C\./)).toBeNull();
    await waitFor(() =>
      expect(
        api.mock.calls.some((c) => String(c[0]).includes("kind=transport")),
      ).toBe(true),
    );
  });

  it("shows the server message when the payment is refused", async () => {
    api.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/students?")) return { rows: [student] };
      if (String(url).includes("/dues")) return dues();
      throw Object.assign(new Error("Old fees are still pending."), {
        status: 422,
        fields: {},
      });
    });
    show();
    await pickStudent();
    await userEvent.type(await screen.findByLabelText(/Tuition fees/), "1000");
    await userEvent.click(
      screen.getByRole("button", { name: /Collect ₹1,000/ }),
    );
    expect(
      await screen.findByText(/Old fees are still pending/),
    ).toBeInTheDocument();
  });
  it("cash: shows change when the parent pays more and blocks Collect when less is given", async () => {
    api.mockImplementation(async (url) =>
      String(url).startsWith("/api/students?") ? { rows: [student] } : dues(),
    );
    show();
    await pickStudent();
    await userEvent.type(await screen.findByLabelText(/Tuition fees/), "1000");
    const cash = screen.getByLabelText(/Cash amount/);
    await userEvent.clear(cash);
    await userEvent.type(cash, "1500");
    expect(screen.getByText(/Change to return: ₹500/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Collect/ })).toBeEnabled();
    await userEvent.clear(cash);
    await userEvent.type(cash, "800");
    expect(screen.getByText(/₹200 still missing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Collect/ })).toBeDisabled();
  });

  it('school also shows all 12 months; passed months with no fee say "No fee posted"', async () => {
    api.mockImplementation(async (url) =>
      String(url).startsWith("/api/students?")
        ? { rows: [student] }
        : dues({ asOf: "2026-11-06" }),
    );
    show();
    await pickStudent();
    await screen.findByLabelText(/Tuition fees/);
    expect(screen.getByText("Apr 2026")).toBeInTheDocument();
    expect(screen.getByText("Mar 2027")).toBeInTheDocument();
    expect(screen.getAllByText("No fee posted")).toHaveLength(6); // Apr-May and Jul-Oct
    expect(screen.getAllByText("Not due yet")).toHaveLength(5); // Nov-Mar
  });

  it('transport shows all 12 months; months with no fee posted are "Not due yet"', async () => {
    api.mockImplementation(async (url) =>
      String(url).startsWith("/api/students?")
        ? { rows: [student] }
        : dues({
            kind: "transport",
            remaining: { transport: 50000 },
            instalments: [
              {
                period: "2026-06",
                dueDate: "2026-06-15",
                due: 50000,
                isDue: true,
                isOverdue: false,
              },
            ],
          }),
    );
    show();
    await pickStudent();
    await userEvent.click(
      await screen.findByRole("tab", { name: "Transport Fees" }),
    );
    await screen.findByLabelText(/Transport fees \(₹\)/);
    expect(screen.getByText("Apr 2026")).toBeInTheDocument();
    expect(screen.getByText("Mar 2027")).toBeInTheDocument();
    expect(screen.getAllByText("Not due yet")).toHaveLength(11);
  });
});
