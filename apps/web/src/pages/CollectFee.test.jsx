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
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter>
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
    await userEvent.selectOptions(screen.getByLabelText("Payment mode"), "upi");
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

  it("without a default bank the Cashier must choose one for UPI / QR", async () => {
    api.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/students?")) return { rows: [student] };
      if (url === "/api/banks/options") return banksReply([]);
      return dues();
    });
    show();
    await pickStudent();
    await userEvent.type(await screen.findByLabelText(/Tuition fees/), "1000");
    await userEvent.selectOptions(screen.getByLabelText("Payment mode"), "upi");
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
});
