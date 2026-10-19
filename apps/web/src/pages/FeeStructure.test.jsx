import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { FeeStructure } from './FeeStructure';

vi.mock('../api/client', () => ({ api: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from '../api/client';

let mockRole = 'admin';

const chart = {
  classFees: [{ classKey: '1', monthlyTuitionPaise: 100000, admissionPaise: 200000 }],
  formFeePaise: 10000,
  lateFeePaise: 10000,
  dueDay: 15,
  graceDays: 10,
  villages: [{ name: 'SIWAL', monthlyPaise: 70000 }],
};
function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <FeeStructure />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Fee structure screen', () => {
  beforeEach(() => {
    api.mockReset();
    mockRole = 'admin';
  });

  it('shows the chart in rupees and saves edits as integer paise', async () => {
    api.mockImplementation(async (url, opts) => (opts?.method === 'PUT' ? chart : chart));
    show();
    const tuition = await screen.findByLabelText(/monthly tuition/);
    expect(tuition).toHaveValue('1000.00');
    await userEvent.clear(tuition);
    await userEvent.type(tuition, '1100.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(true));
    const put = api.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put[1].body.classFees[0].monthlyTuitionPaise).toBe(110050);
    expect(put[1].body.villages[0]).toEqual({ name: 'SIWAL', monthlyPaise: 70000 });
  });

  it('refuses a bad amount without calling the server', async () => {
    api.mockResolvedValue(chart);
    show();
    const tuition = await screen.findByLabelText(/monthly tuition/);
    await userEvent.clear(tuition);
    await userEvent.type(tuition, 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a valid amount')).toBeInTheDocument();
    expect(api.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(false);
  });

  it('tells the Admin what to do when no chart exists', async () => {
    api.mockImplementation(async () => {
      await Promise.resolve();
      const e = new Error('not found');
      e.status = 404;
      throw e;
    });
    show();
    expect(await screen.findByText(/No fee structure for/)).toBeInTheDocument();
  });

  it('shows an error with a retry button when loading fails', async () => {
    api.mockImplementation(async () => {
      await Promise.resolve();
      const e = new Error('server down');
      e.status = 500;
      throw e;
    });
    show();
    expect(await screen.findByText('server down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('Cashier and Principal see the chart read-only: no Save button, fields disabled', async () => {
    mockRole = 'principal';
    api.mockResolvedValue(chart);
    show();
    const tuition = await screen.findByLabelText(/monthly tuition/);
    expect(tuition).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add village' })).toBeNull();
    expect(screen.getByText(/View only/)).toBeInTheDocument();
  });
});
