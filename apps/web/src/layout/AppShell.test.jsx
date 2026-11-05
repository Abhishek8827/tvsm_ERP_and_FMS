import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

let role = "admin";
let pending = { cancellations: 0, vouchers: 0, reversals: 0 };
vi.mock("../api/client", () => ({ api: vi.fn(async () => ({ pending })) }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ role, user: { name: "Abhishek Wani" }, signOut: () => {} }),
}));

function at(path) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<p>page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const sidebar = () => within(screen.getByLabelText("Sidebar"));

describe("Shell", () => {
  beforeEach(() => {
    role = "admin";
    try {
      localStorage.clear();
    } catch {
      /* not available */
    }
  });
  it('the sidebar is a menu only: no school name or logo in it, no "Soon" tags', () => {
    at("/");
    expect(screen.getByLabelText("Sidebar").querySelector("img")).toBeNull();
    expect(sidebar().queryByText(/Soon/)).toBeNull();
    expect(
      sidebar().queryByText("THAKUR VIRENDRA SINGH MEMORIAL SCHOOL"),
    ).toBeNull();
  });
  it("the school name is in the top bar; the greeting names the person, no role tag there", () => {
    at("/");
    expect(screen.getByTestId("school-name")).toHaveTextContent(
      "THAKUR VIRENDRA SINGH MEMORIAL SCHOOL",
    );
    expect(screen.getByTestId("greeting")).toHaveTextContent(/Hello, Abhishek/);
    expect(screen.queryByTestId("header-role")).toBeNull();
    // the role is shown once, in the sidebar's account block
    expect(sidebar().getByText("Admin")).toBeInTheDocument();
  });
  it("categories open and close; closed ones hide their links", () => {
    at("/");
    const money = sidebar().getByRole("button", { name: "Accounts & Finance" });
    expect(money).toHaveAttribute("aria-expanded", "false");
    expect(sidebar().queryByRole("link", { name: "Cashbook" })).toBeNull();
    fireEvent.click(money);
    expect(money).toHaveAttribute("aria-expanded", "true");
    expect(
      sidebar().getByRole("link", { name: "Cashbook" }),
    ).toBeInTheDocument();
    fireEvent.click(money);
    expect(sidebar().queryByRole("link", { name: "Cashbook" })).toBeNull();
  });
  it("the category holding the open page is open on arrival", () => {
    at("/cashbook");
    expect(
      sidebar().getByRole("button", { name: "Accounts & Finance" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      sidebar().getByRole("link", { name: "Cashbook" }),
    ).toBeInTheDocument();
  });
  it("a hidden sidebar opens as a floating menu that hides again by itself; Pin brings it back", () => {
    at("/");
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(screen.queryByLabelText("Sidebar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    const menu = () => document.getElementById("mobile-menu");
    expect(menu()).not.toBeNull();
    fireEvent.click(within(menu()).getByRole("link", { name: "Dashboard" }));
    expect(menu()).toBeNull();
    expect(screen.queryByLabelText("Sidebar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin sidebar" }));
    expect(menu()).toBeNull();
    expect(screen.getByLabelText("Sidebar")).toBeInTheDocument();
  });
  it("the Cashier has no Rebates link and no Administration & Setup category", () => {
    role = "cashier";
    at("/rebates");
    expect(screen.queryByRole("link", { name: /Rebates/ })).toBeNull();
    expect(
      sidebar().queryByRole("button", { name: "Administration & Setup" }),
    ).toBeNull();
    expect(
      sidebar().getByRole("link", { name: "Fee Structure" }),
    ).toBeInTheDocument();
  });
  it("everyone can reach Transport and Cashbook", () => {
    for (const r of ["admin", "principal", "cashier"]) {
      role = r;
      const { unmount } = at("/");
      for (const name of ["Fee Management", "Accounts & Finance"]) {
        const b = sidebar().queryByRole("button", { name });
        if (b && b.getAttribute("aria-expanded") === "false")
          fireEvent.click(b);
      }
      expect(
        sidebar().getByRole("link", { name: /Transport/ }),
      ).toBeInTheDocument();
      expect(
        sidebar().getByRole("link", { name: /Cashbook/ }),
      ).toBeInTheDocument();
      unmount();
    }
  });
  it("has a Home button in the top bar that opens the Dashboard from any page, and no page search", () => {
    role = "cashier";
    at("/receipts");
    expect(screen.queryByLabelText("Search pages")).toBeNull();
    expect(
      within(screen.getByRole("banner")).getByRole("link", { name: "Home" }),
    ).toHaveAttribute("href", "/");
  });
  it("the docked sidebar has a pin button; unpinning hides it", () => {
    at("/");
    fireEvent.click(
      within(screen.getByLabelText("Sidebar")).getByRole("button", {
        name: "Unpin sidebar",
      }),
    );
    expect(screen.queryByLabelText("Sidebar")).toBeNull();
  });

  it("the phone menu closes by itself: on choosing a page, on Escape, and on the backdrop", () => {
    role = "cashier";
    at("/");
    const open = () =>
      fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    open();
    const menu = () => document.getElementById("mobile-menu");
    expect(menu()).not.toBeNull();
    fireEvent.click(within(menu()).getByRole("link", { name: "Dashboard" }));
    expect(menu()).toBeNull();
    open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menu()).toBeNull();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(menu()).toBeNull();
  });

  it("the Admin menu follows the school order: standalone links, then five categories", () => {
    at("/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    const top = [...nav.children].map((el) => el.textContent.trim());
    expect(top).toEqual([
      "Dashboard",
      "Approvals",
      "Fee Management",
      "Student Management",
      "Accounts & Finance",
      "Reports & Audit",
      "Administration & Setup",
    ]);
  });

  it("the bell opens Approvals and shows a red dot only when something is waiting (Admin only)", async () => {
    pending = { cancellations: 0, vouchers: 0, reversals: 0 };
    const view = at("/");
    expect(
      await screen.findByRole("link", { name: /nothing waiting/ }),
    ).toHaveAttribute("href", "/approvals");
    expect(screen.queryByTestId("bell-dot")).toBeNull();
    view.unmount();
    pending = { cancellations: 1, vouchers: 2, reversals: 0 };
    at("/");
    expect(
      await screen.findByRole("link", { name: /3 waiting/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("bell-dot")).toBeInTheDocument();
  });
  it("the bell is not shown to the Cashier", () => {
    role = "cashier";
    at("/");
    expect(screen.queryByRole("link", { name: /Approvals:/ })).toBeNull();
  });
  it("shows the breadcrumb trail on inner pages but not on the Dashboard", () => {
    const dash = at("/");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    dash.unmount();
    at("/fees-database/students/abc");
    const trail = within(
      screen.getByRole("navigation", { name: "Breadcrumb" }),
    );
    expect(trail.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(trail.getByRole("link", { name: "Fees Database" })).toHaveAttribute(
      "href",
      "/fees-database",
    );
    expect(trail.getByText("Student Fee Details")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
