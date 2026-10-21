import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider, IDLE_TIMEOUT_MS } from './auth/AuthContext';
import { Button, ConfirmDialog, Pagination, ToastProvider } from './components/ui';

const USERS = {
  admin: { id: '1', name: 'Admin', email: 'a@x.com', role: 'admin', tenantId: 'tvsm' },
  principal: { id: '2', name: 'Principal', email: 'p@x.com', role: 'principal', tenantId: 'tvsm' },
  cashier: { id: '3', name: 'Cashier', email: 'c@x.com', role: 'cashier', tenantId: 'tvsm' },
};

/** A stand-in for the Firebase service: same interface, no network. */
function fakeService({ signedIn = false } = {}) {
  let listener;
  let state = signedIn;
  return {
    onChange: vi.fn((cb) => {
      listener = cb;
      queueMicrotask(() => cb(state));
      return () => {};
    }),
    signIn: vi.fn(async () => {
      state = true;
      listener(true);
    }),
    signOut: vi.fn(async () => {
      state = false;
      listener(false);
    }),
    getToken: vi.fn(async () => (state ? 'token' : null)),
  };
}

/** Routes fetch by URL. `me` is what /api/auth/me returns: a user, or a {status, error} failure. */
function mockApi({ me = USERS.cashier } = {}) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
      if (url === '/api/health')
        return new Response(JSON.stringify({ status: 'ok', db: 'up' }), { status: 200 });
      if (url === '/api/auth/session-event') return new Response(null, { status: 204 });
      if (url === '/api/auth/me') {
        if (me.status)
          return new Response(JSON.stringify({ error: me.error }), { status: me.status });
        return new Response(JSON.stringify({ user: me }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

function renderApp(service, { path = '/' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider service={service}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mainNav = () => within(screen.getAllByRole('navigation', { name: 'Main' })[0]);

afterEach(() => vi.unstubAllGlobals());

describe('sign-in', () => {
  it('says so honestly when Firebase is not configured (no fake login)', () => {
    renderApp(null);
    expect(screen.getByRole('alert')).toHaveTextContent(/Sign-in is not configured/);
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('shows the login screen when signed out and validates empty fields', async () => {
    mockApi();
    renderApp(fakeService());
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
  });

  it('shows a plain message for a wrong password and does not reveal which part was wrong', async () => {
    mockApi();
    const service = fakeService();
    service.signIn.mockRejectedValue({ code: 'auth/invalid-credential' });
    renderApp(service);
    await userEvent.type(await screen.findByLabelText('Email'), 'c@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it.each(['admin', 'principal', 'cashier'])(
    '%s signs in and sees only their own menu',
    async (role) => {
      const calls = mockApi({ me: USERS[role] });
      renderApp(fakeService());
      await userEvent.type(await screen.findByLabelText('Email'), 'x@x.com');
      await userEvent.type(screen.getByLabelText('Password'), 'a-long-password');
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await screen.findByRole('heading', { name: 'Dashboard' });
      const forbidden = {
        cashier: ['Data Import', 'Approvals', 'Users & Settings'],
        principal: ['Collect Fee', 'Data Import', 'Users & Settings'],
        admin: ['Collect Fee', 'Approvals'],
      }[role];
      for (const label of forbidden) expect(mainNav().queryByText(label)).toBeNull();
      expect(mainNav().getByText('Dashboard')).toBeInTheDocument();
      // the successful login is reported to the server for the audit log
      await waitFor(() =>
        expect(
          calls.some((c) => c.url === '/api/auth/session-event' && c.body.event === 'login'),
        ).toBe(true),
      );
    },
  );

  it('a login the server rejects (no account) is signed out again with the server message', async () => {
    mockApi({
      me: {
        status: 403,
        error: {
          code: 'NO_ACCOUNT',
          message: 'This login is not set up for the school system. Please contact the Admin.',
        },
      },
    });
    const service = fakeService({ signedIn: true });
    renderApp(service);
    expect(await screen.findByText(/not set up for the school system/)).toBeInTheDocument();
    expect(service.signOut).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows a retry screen when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')));
    renderApp(fakeService({ signedIn: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the server/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('Sign out calls the server and Firebase and returns to the login screen', async () => {
    const calls = mockApi({ me: USERS.admin });
    const service = fakeService({ signedIn: true });
    renderApp(service);
    await screen.findByRole('heading', { name: 'Dashboard' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(calls.some((c) => c.body?.event === 'logout')).toBe(true);
    expect(service.signOut).toHaveBeenCalled();
  });
});

describe('sign-out and next login', () => {
  it('after sign out, the next login always lands on the dashboard (not the old page)', async () => {
    mockApi({ me: USERS.admin });
    renderApp(fakeService({ signedIn: true }), { path: '/audit-log' });
    expect(await screen.findByText('Coming soon')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]);
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.type(screen.getByLabelText('Email'), 'x@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('signed-in shell', () => {
  beforeEach(() => mockApi({ me: USERS.cashier }));

  it("typing another role's URL falls back to the dashboard", async () => {
    renderApp(fakeService({ signedIn: true }), { path: '/data-import' });
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('shows the live database status from the API', async () => {
    renderApp(fakeService({ signedIn: true }));
    expect(await screen.findByText('All systems normal')).toBeInTheDocument();
  });

  it('screens not built yet say "Coming soon" instead of being dead', async () => {
    renderApp(fakeService({ signedIn: true }), { path: '/day-close' });
    expect(await screen.findByText('Coming soon')).toBeInTheDocument();
  });
});

describe('10-minute idle logout', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }));
  afterEach(() => vi.useRealTimers());

  async function signedInApp() {
    const calls = mockApi({ me: USERS.cashier });
    const service = fakeService({ signedIn: true });
    renderApp(service);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    return { calls, service };
  }

  it('signs out after 10 minutes without activity and says why', async () => {
    const { calls, service } = await signedInApp();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 6000);
    });
    expect(service.signOut).toHaveBeenCalled();
    expect(calls.some((c) => c.body?.event === 'idle_logout')).toBe(true);
    expect(screen.getByText(/signed out after 10 minutes of inactivity/)).toBeInTheDocument();
  });

  it('activity keeps the session alive', async () => {
    const { service } = await signedInApp();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    });
    fireEvent.keyDown(window, { key: 'a' }); // cashier is typing
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    });
    expect(service.signOut).not.toHaveBeenCalled();
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
