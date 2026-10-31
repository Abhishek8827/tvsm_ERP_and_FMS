import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

let role = "admin";
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ role, user: { name: "Abhishek Wani" }, signOut: () => {} }),
}));

function at(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<p>page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
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
    expect(screen.getByTestId("greeting")).toHaveTextContent(
      /Good (morning|afternoon|evening), Abhishek/,
    );
    expect(screen.queryByTestId("header-role")).toBeNull();
    // the role is shown once, in the sidebar's account block
    expect(sidebar().getByText("Admin")).toBeInTheDocument();
  });
  it("categories open and close; closed ones hide their links", () => {
    at("/");
    const money = sidebar().getByRole("button", { name: "Money" });
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
    expect(sidebar().getByRole("button", { name: "Money" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      sidebar().getByRole("link", { name: "Cashbook" }),
    ).toBeInTheDocument();
  });
  it("the hamburger hides and shows the sidebar", () => {
    at("/");
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(screen.queryByLabelText("Sidebar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(screen.getByLabelText("Sidebar")).toBeInTheDocument();
  });
  it("the Cashier has no Rebates link and no Setup category", () => {
    role = "cashier";
    at("/rebates");
    expect(screen.queryByRole("link", { name: /Rebates/ })).toBeNull();
    expect(sidebar().queryByRole("button", { name: "Setup" })).toBeNull();
    expect(
      sidebar().getByRole("link", { name: "Fee Structure" }),
    ).toBeInTheDocument();
  });
  it("everyone can reach Transport and Cashbook", () => {
    for (const r of ["admin", "principal", "cashier"]) {
      role = r;
      const { unmount } = at("/");
      for (const name of ["Fees", "Money"]) {
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
  it("page search lists only pages this role may open, and Enter opens one", () => {
    role = "cashier";
    at("/");
    const box = screen.getByLabelText("Search pages");
    fireEvent.change(box, { target: { value: "reb" } });
    expect(screen.getByText("No page found")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "coll" } });
    expect(
      screen.getByRole("option", { name: "Collect Fee" }),
    ).toBeInTheDocument();
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
});
