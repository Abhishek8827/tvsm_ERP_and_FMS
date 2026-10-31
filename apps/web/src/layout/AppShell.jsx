import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { navForRole, navLayoutForRole, SCHOOL } from "@erp/shared";
import { useAuth } from "../auth/AuthContext";
import { NavGroup, NavItem } from "../components/ui";
import { Clock } from "./Clock";
import { Footer } from "./Footer";
import { firstName, greetingFor } from "./greeting";
import { NavSearch } from "./NavSearch";

const ROLE_LABEL = {
  admin: "Admin",
  principal: "Principal",
  cashier: "Cashier",
};
const SIDEBAR_KEY = "erp.sidebarCollapsed";
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
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition-colors hover:bg-white/15 ${className}`}
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
 * App shell. The sidebar and the top bar are ONE blue frame; the page sits in a light panel with
 * a round corner against it. Sidebar = menu only (no logo): standalone links and collapsible
 * categories, the signed-in person and Sign out at the bottom. Top bar = menu button, greeting,
 * school name in the middle, page search and the live IST clock. On phones the sidebar is a drawer.
 */
export function AppShell() {
  const { user, role, signOut } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const [hidden, setHidden] = useState(() => read(SIDEBAR_KEY, false) === true);
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
  const toggleSidebar = () =>
    setHidden((h) => {
      write(SIDEBAR_KEY, !h);
      return !h;
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
    <div className="flex h-dvh bg-linear-to-b from-sidebar to-brand">
      {!hidden && (
        <aside
          aria-label="Sidebar"
          className="hidden w-64 shrink-0 flex-col gap-3 px-3 pb-4 pt-4 md:flex"
        >
          {menu}
          {account}
        </aside>
      )}

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawer(false)}
          />
          <div
            id="mobile-menu"
            className="relative flex h-full w-72 max-w-[85%] flex-col gap-3 bg-linear-to-b from-sidebar to-brand px-3 pb-4 pt-4"
          >
            {menu}
            {account}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 text-white md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Hamburger
              className="md:hidden"
              aria-label="Open menu"
              aria-expanded={drawer}
              aria-controls="mobile-menu"
              onClick={() => setDrawer(true)}
            />
            <Hamburger
              className="hidden md:flex"
              aria-label={hidden ? "Show sidebar" : "Hide sidebar"}
              aria-expanded={!hidden}
              onClick={toggleSidebar}
            />
            <p
              className="hidden truncate text-sm lg:block"
              data-testid="greeting"
            >
              {greetingFor()},{" "}
              <span className="font-semibold">{firstName(user.name)}</span>
            </p>
          </div>
          <h1
            data-testid="school-name"
            className="max-w-[56vw] truncate text-center text-sm font-semibold tracking-wide sm:text-base md:max-w-none"
          >
            <span className="sm:hidden">TVSM School</span>
            <span className="hidden sm:inline">{SCHOOL.name}</span>
          </h1>
          <div className="flex min-w-0 items-center justify-end gap-3">
            <NavSearch
              items={navForRole(role)}
              className="hidden w-44 xl:block 2xl:w-56"
            />
            <div className="hidden sm:block">
              <Clock />
            </div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-t-3xl bg-app md:rounded-tl-4xl md:rounded-tr-none">
          <main className="min-w-0 flex-1 p-4 md:p-8">
            <Outlet />
          </main>
          <Footer />
        </div>
      </div>
    </div>
  );
}
