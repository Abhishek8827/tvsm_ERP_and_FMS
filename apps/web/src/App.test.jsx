import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { Button, ConfirmDialog, Pagination, ToastProvider } from './components/ui';
function renderApp(role, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider initialRole={role}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe('role-based shell', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ status: 'ok', db: 'up' }), { status: 200 }),
        ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  it('cashier sees Collect Fee but none of the admin screens', async () => {
    renderApp('cashier');
    const nav = within(screen.getAllByRole('navigation', { name: 'Main' })[0]);
    expect(nav.getByText('Collect Fee')).toBeInTheDocument();
    expect(nav.queryByText('Fee Structure')).toBeNull();
    expect(nav.queryByText('Users & Settings')).toBeNull();
    expect(await screen.findByText('All systems normal')).toBeInTheDocument();
  });
  it('principal sees Approvals and no data-entry screens', () => {
    renderApp('principal');
    const nav = within(screen.getAllByRole('navigation', { name: 'Main' })[0]);
    expect(nav.getByText('Approvals')).toBeInTheDocument();
    expect(nav.queryByText('Collect Fee')).toBeNull();
    expect(nav.queryByText('Data Import')).toBeNull();
  });
  it("typing another role's URL falls back to the dashboard", () => {
    renderApp('cashier', '/data-import');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
  it('screens not built yet say "Coming soon" instead of being dead', () => {
    renderApp('admin', '/reports');
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
  it('with no role, only the sign-in notice shows', () => {
    renderApp(null);
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });
  it('shows a readable error with Try again when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')));
    renderApp('admin');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the server/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
describe('component library behaviour', () => {
  it('Button with loading cannot be double-clicked', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Collect
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
  it('ConfirmDialog keeps Confirm disabled until the word is typed and a reason is given', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Override"
        description="Dues pending"
        confirmLabel="Override"
        typeToConfirm="OVERRIDE"
        requireReason
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Override' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason (required)'), 'Fees paid by cheque');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type OVERRIDE to confirm'), 'OVERRIDE');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
  it('Pagination reports correct ranges and disables edges', async () => {
    const onPage = vi.fn();
    render(<Pagination page={1} pageSize={10} total={25} onPageChange={onPage} />);
    expect(screen.getByText('Showing 1 to 10 of 25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});
