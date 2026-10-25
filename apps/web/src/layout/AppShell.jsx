import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { navForRole } from "@erp/shared";
import { useAuth } from "../auth/AuthContext";
import { Button, NavItem } from "../components/ui";
import { Clock } from "./Clock";
import { Footer } from "./Footer";

const ROLE_LABEL = {
  admin: "Admin",
  principal: "Principal",
  cashier: "Cashier",
};
// The centre of the top bar: the cashier works at the fee counter.
const HEADER_LABEL = {
  admin: "Admin",
  principal: "Principal",
  cashier: "Counter 1",
};
/** Steps already built. Anything later is shown with a "Soon" tag, never as a dead link. */
export const CURRENT_STEP = 8;
const KEY = "erp.sidebarCollapsed";
// Pages with wide tables: the sidebar shrinks to icons there and opens when the mouse is on it.
const WIDE_PAGES = [
  "/fees-database",
  "/students",
  "/rebates",
  "/transport",
  "/expenses",
  "/receipts",
  "/fees-receipts",
  "/data-import",
];

// localStorage can throw (private window, blocked data), so the choice is a convenience only.
const readCollapsed = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

function Hamburger({ className = "", ...props }) {
  return (
    <button
      type="button"
      className={`flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-app ${className}`}
      {...props}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 7h16M4 12h16M4 17h16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/**
 * App shell: role-based sidebar (collapsible with the hamburger), a sticky top bar with the live
 * IST date and time on every role, and the footer under every page. On phones the sidebar is a
 * drawer (the Principal approves from a phone).
 */
export function AppShell() {
  const { user, role, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { pathname } = useLocation();
  if (!role) return null;
  const rail = WIDE_PAGES.includes(pathname.replace(/\/$/, ""));

  function toggleDesktop() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {
        /* the choice just is not remembered */
      }
      return !c;
    });
  }

  const items = navForRole(role);
  // The menu scrolls by itself (min-h-0 lets a flex child shrink); logo and account stay put.
  const navList = (railMode) => (
    <nav
      aria-label="Main"
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-1"
    >
      {items.map((i) => (
        <NavItem
          key={i.key}
          to={i.path}
          label={i.label}
          icon={i.key}
          rail={railMode}
          soon={i.availableFromStep > CURRENT_STEP}
          onNavigate={() => setOpen(false)}
        />
      ))}
    </nav>
  );
  const nav = navList(false);
  const account = (
    <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-white/15 pt-4 text-sm text-white">
      <div className="px-1">
        <p className="font-medium">{user.name}</p>
        <p className="text-xs text-white/60">{ROLE_LABEL[role]}</p>
      </div>
      <Button variant="secondary" onClick={() => void signOut()}>
        Sign out
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-full">
      {/* Sticky and full screen height: Sign out stays at the bottom of the visible screen. */}
      {!collapsed && !rail && (
        <aside className="hidden w-64 shrink-0 flex-col gap-4 overflow-hidden bg-sidebar p-4 md:sticky md:top-0 md:flex md:h-screen">
          <div className="flex shrink-0 items-center gap-3">
            <img
              src="/logo.jpg"
              alt="TVSM School logo"
              className="h-14 w-auto rounded-lg bg-white p-1"
            />
            <div>
              <p className="text-lg font-semibold text-white">TVSM School</p>
              <p className="text-xs text-white/60">School ERP</p>
            </div>
          </div>
          {nav}
          {account}
        </aside>
      )}
      {/* Wide pages: a narrow icon bar that opens over the page (not pushing it) on hover. */}
      {!collapsed && rail && (
        <div className="hidden w-16 shrink-0 md:block">
          <aside
            aria-label="Sidebar"
            className="group fixed inset-y-0 left-0 z-40 hidden w-16 flex-col gap-4 overflow-hidden bg-sidebar p-2 transition-[width] duration-200 hover:w-64 hover:p-4 focus-within:w-64 focus-within:p-4 md:flex"
          >
            <div className="flex shrink-0 items-center gap-3">
              <img
                src="/logo.jpg"
                alt="TVSM School logo"
                className="h-10 w-auto rounded-lg bg-white p-0.5 group-hover:h-14"
              />
              <div className="whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100">
                <p className="text-lg font-semibold text-white">TVSM School</p>
                <p className="text-xs text-white/60">School ERP</p>
              </div>
            </div>
            {navList(true)}
            <div className="mt-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
              {account}
            </div>
          </aside>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div
            id="mobile-menu"
            className="relative flex h-full w-72 max-w-[85%] flex-col gap-4 overflow-hidden bg-sidebar p-4"
          >
            {nav}
            {account}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Three columns: menu + school name | the role in the middle | clock + who is signed in. */}
        <header className="sticky top-0 z-30 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-line bg-surface px-3 py-2 shadow-sm md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Hamburger
              className="md:hidden"
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpen(true)}
            />
            <Hamburger
              className="hidden md:flex"
              aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
              aria-expanded={!collapsed}
              onClick={toggleDesktop}
            />
            <img
              src="/logo.jpg"
              alt=""
              className="h-8 w-auto rounded md:hidden"
            />
            <span className="hidden truncate text-sm font-semibold text-ink lg:block">
              TVSM School ERP
            </span>
          </div>
          <p
            data-testid="header-role"
            className="rounded-full bg-sidebar px-5 py-1.5 text-center text-sm font-semibold tracking-wide text-white"
          >
            {HEADER_LABEL[role]}
          </p>
          <div className="flex min-w-0 items-center justify-end gap-3">
            <Clock />
            <div className="hidden items-center gap-2 border-l border-line pl-3 sm:flex">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-app text-sm font-semibold text-ink"
              >
                {(user.name ?? "?").trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 text-xs leading-tight">
                <p className="truncate font-medium">{user.name}</p>
                <p className="text-ink-muted">{ROLE_LABEL[role]}</p>
              </div>
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-8">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
}
