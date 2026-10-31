import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { UsersSettings } from "./UsersSettings";

vi.mock("../api/client", () => ({ api: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));
import { api } from "../api/client";

const rows = [
  {
    id: "u1",
    name: "Abhishek Wani",
    email: "a@x.com",
    role: "admin",
    isActive: true,
  },
  {
    id: "u2",
    name: "Ravi Cashier",
    email: "r@x.com",
    role: "cashier",
    isActive: true,
  },
];
function show() {
  api.mockReset();
  api.mockImplementation(async (url, opts) => {
    if (opts?.method) return { ok: true };
    return { rows, total: 2 };
  });
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <UsersSettings />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Users & Settings: edit and delete", () => {
  it("own row has no Delete button; Edit details saves only what changed", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText("Ravi Cashier");
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    await user.click(
      screen.getAllByRole("button", { name: "Edit details" })[1],
    );
    const name = screen.getByLabelText("Full name");
    await user.clear(name);
    await user.type(name, "Ravi Kumar");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/users/u2", {
        method: "PATCH",
        body: { name: "Ravi Kumar" },
      }),
    );
  });

  it("Delete asks first, then calls DELETE", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText("Ravi Cashier");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(api).not.toHaveBeenCalledWith("/api/users/u2", { method: "DELETE" });
    await user.click(screen.getByRole("button", { name: "Delete user" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/users/u2", { method: "DELETE" }),
    );
  });
});
