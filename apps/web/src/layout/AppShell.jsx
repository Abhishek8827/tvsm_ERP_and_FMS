import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { navLayoutForRole, SCHOOL } from "@erp/shared";
import { useAuth } from "../auth/AuthContext";
import { NavGroup, NavItem } from "../components/ui";
import { Breadcrumbs } from "./Breadcrumbs";
import { Clock } from "./Clock";
import { NotificationBell } from "./NotificationBell";
import { Footer } from "./Footer";
import { firstName } from "./greeting";

const ROLE_LABEL = {
  admin: "Admin",
  principal: "Principal",
  cashier: "Cashier",
};
const GROUPS_KEY = "erp.navOpen";

// localStorage can throw (private window, blocked data), so these choices are conveniences only.
const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* the choice just is not remembered */
  }
};

function Hamburger({ className = "", ...props }) {
  return (
    <button
      type="button"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink transition-colors hover:bg-blue-100 ${className}`}
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
          d="M4 7h16M4 12h16M4 17h10"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/**
 * App shell. A fixed deep-blue sidebar (never hides on desktop) and a separate white top bar with
 * its own shadow; the page sits below the bar. Sidebar = menu only (no logo): standalone links and collapsible
 * categories, the signed-in person and Sign out at the bottom. Top bar = phone menu button, greeting,
 * school name in the middle, Home, the Approvals bell (Admin) and the live IST clock. On phones the sidebar is a drawer.
 */
export function AppShell() {
  const { user, role, signOut } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const [openGroups, setOpenGroups] = useState(() => read(GROUPS_KEY, {}));
  const { pathname } = useLocation();
  const layout = useMemo(() => (role ? navLayoutForRole(role) : []), [role]);

  // Arriving on a page opens its category (a category the person closed earlier opens again).
  const activeKey = layout.find(
    (e) =>
      e.type === "group" &&
      e.items.some((i) => i.path !== "/" && pathname.startsWith(i.path)),
  )?.key;
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setDrawer(false); // any page change (menu link, tile, search, back button) closes the phone menu
    if (activeKey && openGroups[activeKey] === false) {
      const { [activeKey]: _closed, ...rest } = openGroups;
      setOpenGroups(rest);
    }
  }
  // Escape closes the phone menu; growing the window to desktop width also closes it, so it can
  // never be left open behind the page.
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => e.key === "Escape" && setDrawer(false);
    const mq = window.matchMedia?.("(min-width: 768px)");
    const onWide = (e) => e.matches && setDrawer(false);
    window.addEventListener("keydown", onKey);
    mq?.addEventListener?.("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq?.removeEventListener?.("change", onWide);
    };
  }, [drawer]);
  const isOpen = (key) => openGroups[key] ?? key === activeKey;

  if (!role) return null;

  const toggleGroup = (key) =>
    setOpenGroups((cur) => {
      const next = { ...cur, [key]: !(cur[key] ?? key === activeKey) };
      write(GROUPS_KEY, next);
      return next;
    });

  const menu = (
    <nav
      aria-label="Main"
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-1"
    >
      {layout.map((e) =>
        e.type === "link" ? (
          <NavItem
            key={e.item.key}
            to={e.item.path}
            label={e.item.label}
            icon={e.item.key}
            onNavigate={() => setDrawer(false)}
          />
        ) : (
          <NavGroup
            key={e.key}
            id={e.key}
            label={e.label}
            items={e.items}
            open={isOpen(e.key)}
            onToggle={() => toggleGroup(e.key)}
            onNavigate={() => setDrawer(false)}
          />
        ),
      )}
    </nav>
  );
  const account = (
    <div className="flex shrink-0 items-center gap-3 border-t border-white/15 pt-3 text-white">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold"
      >
        {(user.name ?? "?").trim().charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="text-xs text-white/70">{ROLE_LABEL[role]}</p>
      </div>
      <button
        type="button"
        onClick={() => void signOut()}
        aria-label="Sign out"
        title="Sign out"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/80 transition-colors hover:bg-white/15 hover:text-white"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );

  return (
    <div className="flex h-dvh bg-app">
      {/* The sidebar is always there on desktop (it never hides). Its own deep-blue panel and shadow. */}
      <aside
        aria-label="Sidebar"
        className="relative z-20 hidden w-64 shrink-0 flex-col gap-3 bg-linear-to-b from-blue-900 to-blue-800 px-3 pb-4 pt-5 shadow-[10px_0_30px_-14px_rgb(30_58_138/0.75)] md:flex"
      >
        {menu}
        {account}
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawer(false)}
          />
          <div
            id="mobile-menu"
            className="relative flex h-full w-72 max-w-[85%] flex-col gap-3 bg-linear-to-b from-blue-900 to-blue-800 px-3 pb-4 pt-4"
          >
            {menu}
            {account}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-10 grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line bg-white/95 px-3 text-ink shadow-[0_8px_24px_-10px_rgb(15_23_42/0.28)] backdrop-blur md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Hamburger
              className="md:hidden"
              aria-label="Open menu"
              aria-expanded={drawer}
              aria-controls="mobile-menu"
              onClick={() => setDrawer(true)}
            />
            <span
              aria-hidden="true"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-base font-medium text-white shadow-glow sm:flex"
            >
              {(user.name ?? "?").trim().charAt(0).toUpperCase()}
            </span>
            <p
              className="hidden truncate text-sm lg:block"
              data-testid="greeting"
            >
              Hello,{" "}
              <span className="font-semibold">{firstName(user.name)}</span>
            </p>
          </div>
          <h1
            data-testid="school-name"
            className="max-w-[56vw] truncate text-center text-sm font-bold tracking-wide text-brand-dark sm:text-base md:max-w-none lg:text-xl"
          >
            <span className="sm:hidden">TVSM School</span>
            <span className="hidden sm:inline">{SCHOOL.name}</span>
          </h1>
          <div className="flex min-w-0 items-center justify-end gap-3">
            <Link
              to="/"
              aria-label="Home"
              title="Home: go to the Dashboard"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-ink transition-colors hover:bg-blue-100"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 11l8-7 8 7M6 10v10h4v-6h4v6h4V10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <NotificationBell />
            <div className="hidden sm:block">
              <Clock />
            </div>
          </div>
        </header>
        <div className="page-bg flex min-h-0 flex-1 flex-col overflow-y-auto">
          <main className="min-w-0 flex-1 p-4 md:p-8">
            <Breadcrumbs />
            <Outlet />
          </main>
          <Footer />
        </div>
      </div>
    </div>
  );
}
