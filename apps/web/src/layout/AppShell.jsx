import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { navForRole } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { Button, NavItem } from '../components/ui';
import { Clock } from './Clock';
import { Footer } from './Footer';

const ROLE_LABEL = { admin: 'Admin', principal: 'Principal', cashier: 'Cashier' };
/** Steps already built. Anything later is shown with a "Soon" tag, never as a dead link. */
export const CURRENT_STEP = 7;
const KEY = 'erp.sidebarCollapsed';

// localStorage can throw (private window, blocked data), so the choice is a convenience only.
const readCollapsed = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

function Hamburger({ className = '', ...props }) {
  return (
    <button
      type="button"
      className={`flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-app ${className}`}
      {...props}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  if (!role) return null;

  function toggleDesktop() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? '0' : '1');
      } catch {
        /* the choice just is not remembered */
      }
      return !c;
    });
  }

  const items = navForRole(role);
  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((i) => (
        <NavItem
          key={i.key}
          to={i.path}
          label={i.label}
          soon={i.availableFromStep > CURRENT_STEP}
          onNavigate={() => setOpen(false)}
        />
      ))}
    </nav>
  );
  const account = (
    <div className="mt-auto flex flex-col gap-2 border-t border-white/15 pt-4 text-sm text-white">
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
      {!collapsed && (
        <aside className="hidden w-64 shrink-0 flex-col gap-6 overflow-y-auto bg-sidebar p-4 md:sticky md:top-0 md:flex md:h-screen">
          <div className="flex items-center gap-3">
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
            className="relative flex h-full w-72 max-w-[85%] flex-col gap-4 overflow-y-auto bg-sidebar p-4"
          >
            {nav}
            {account}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:px-6">
          <Hamburger
            className="md:hidden"
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen(true)}
          />
          <Hamburger
            className="hidden md:flex"
            aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-expanded={!collapsed}
            onClick={toggleDesktop}
          />
          <span className="flex min-w-0 items-center gap-2 font-semibold">
            <img src="/logo.jpg" alt="" className="h-8 w-auto rounded md:hidden" />
            <span className="truncate">TVSM School ERP</span>
          </span>
          <div className="ml-auto flex items-center gap-4">
            <Clock />
            <div className="hidden text-right text-xs leading-tight sm:block">
              <p className="font-medium">{user.name}</p>
              <p className="text-ink-muted">{ROLE_LABEL[role]}</p>
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
