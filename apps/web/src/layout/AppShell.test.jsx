import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

let role = 'admin';
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ role, user: { name: 'T' }, signOut: () => {} }),
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

describe('Sidebar', () => {
  beforeEach(() => {
    role = 'admin';
    try {
      localStorage.clear();
    } catch {
      /* not available */
    }
  });
  it('is the full sidebar on normal pages', () => {
    at('/');
    expect(screen.queryByLabelText('Sidebar')).toBeNull();
    expect(screen.getByRole('link', { name: /Rebates/ })).toBeInTheDocument();
  });
  it('shrinks to an icon bar (opens on hover) on wide table pages', () => {
    for (const path of ['/fees-database', '/students', '/rebates']) {
      const { unmount } = at(path);
      const bar = screen.getByLabelText('Sidebar');
      expect(bar.className).toContain('w-16');
      expect(bar.className).toContain('hover:w-64');
      // every link is still there (icon + label for screen readers)
      expect(screen.getByRole('link', { name: /Fees Database/ })).toBeInTheDocument();
      unmount();
    }
  });
  it('the Cashier has no Rebates link', () => {
    role = 'cashier';
    at('/');
    expect(screen.queryByRole('link', { name: /Rebates/ })).toBeNull();
  });
});
