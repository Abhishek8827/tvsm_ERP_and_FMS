import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { navForRole, type Role } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { Button, NavItem } from '../components/ui';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  principal: 'Principal',
  cashier: 'Cashier',
};
/** Steps already built. Anything later is shown with a "Soon" tag, never as a dead link. */
export const CURRENT_STEP = 1;

/**
 * App shell: role-based sidebar on desktop, top bar + drawer on phones (the Principal approves
 * from a phone, so the mobile layout is a first-class path, not an afterthought).
 */
export function AppShell() {
  const { role, setDevRole } = useAuth();
  const [open, setOpen] = useState(false);
  if (!role) return null;
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
      <p className="px-1">{ROLE_LABEL[role]}</p>
      <Button variant="secondary" onClick={() => setDevRole(null)}>
        Sign out
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <header className="flex items-center justify-between bg-sidebar px-4 py-3 text-white md:hidden">
        <span className="font-semibold">TVSM School ERP</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
          className="min-h-10 rounded-lg px-3 text-sm hover:bg-white/10"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </header>

      {open && (
        <div id="mobile-menu" className="flex flex-col gap-4 bg-sidebar p-4 md:hidden">
          {nav}
          {account}
        </div>
      )}

      <aside className="hidden w-64 shrink-0 flex-col gap-6 bg-sidebar p-4 md:flex">
        <div>
          <p className="text-lg font-semibold text-white">TVSM School</p>
          <p className="text-xs text-white/60">School ERP</p>
        </div>
        {nav}
        {account}
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
