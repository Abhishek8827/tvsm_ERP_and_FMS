import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PendingCertificates } from "./CertificateApprovals";

vi.mock("../api/client", () => ({ api: vi.fn() }));
import { api } from "../api/client";

const rows = [
  {
    id: 'r1', kind: 'tc', studentName: 'Asha', admissionNo: '7', status: 'pending',
    preview: { entered: { reason: 'Parent Request' } }, requestedByName: 'Admin',
    createdAt: '2026-10-13T06:00:00Z', duesOverride: { reason: 'Will pay', duePaise: 150000 },
  },
  {
    id: 'r2', kind: 'bonafide', studentName: 'Ravi', admissionNo: '9', status: 'pending',
    preview: { purpose: 'Passport' }, requestedByName: 'Admin', createdAt: '2026-10-13T06:00:00Z',
    duesOverride: null,
  },
]; // prettier-ignore
const show = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <PendingCertificates />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Principal inbox: TC and Bonafide requests", () => {
  // braces on purpose: returning the mock from beforeEach would make vitest CALL it afterwards
  beforeEach(() => {
    api.mockReset();
  });

  it("lists waiting requests with their reason, the dues flag and a link to decide", async () => {
    api.mockResolvedValue({ rows, total: 2 });
    show();
    const tc = await screen.findByRole("row", { name: /Asha/ });
    expect(within(tc).getByText("Transfer Certificate")).toBeInTheDocument();
    expect(within(tc).getByText("Parent Request")).toBeInTheDocument();
    expect(within(tc).getByText(/Dues pending ₹1,500/)).toBeInTheDocument();
    expect(
      within(tc).getByRole("link", { name: "Review and decide" }),
    ).toHaveAttribute("href", "/tc-bonafide?tab=tc");
    const bon = screen.getByRole("row", { name: /Ravi/ });
    expect(within(bon).getByText("Passport")).toBeInTheDocument();
    expect(
      within(bon).getByRole("link", { name: "Review and decide" }),
    ).toHaveAttribute("href", "/tc-bonafide?tab=bonafide");
    expect(api).toHaveBeenCalledWith(
      "/api/certificate-requests?status=pending&pageSize=50",
    );
  });

  it("shows an empty state", async () => {
    api.mockResolvedValue({ rows: [], total: 0 });
    show();
    expect(
      await screen.findByText("No certificate requests waiting"),
    ).toBeInTheDocument();
  });

  it("shows an error state with a retry", async () => {
    api.mockImplementation(async () => {
      throw new Error("Server down");
    });
    show();
    expect(await screen.findByText(/Server down/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
