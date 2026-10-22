import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { FeesDatabase } from './FeesDatabase';

vi.mock('../api/client', () => ({ api: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from '../api/client';

let mockRole = 'admin';
const row = (o) => ({
  id: '1', admissionNo: '7', name: 'Asha', fatherName: 'Ram', classKey: '5th', section: 'A',
  village: '', usesTransport: false, planPosted: true, billedPaise: 1000000, paidPaise: 200000,
  rebatePaise: 0, outstandingPaise: 800000, dueNowPaise: 300000, overduePaise: 0, lateFeePaise: 0,
  school: {}, transport: {}, ...o,
}); // prettier-ignore
const data = {
  fy: '2026-27', page: 1, pageSize: 25, total: 2,
  totals: { students: 2, billedPaise: 1000000, paidPaise: 200000, rebatePaise: 0, outstandingPaise: 800000, dueNowPaise: 300000, overduePaise: 0, lateFeePaise: 0 },
  rows: [row({}), row({ id: '2', name: 'Ravi', planPosted: false })],
}; // prettier-ignore
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter>
          <FeesDatabase />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Fees Database', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue(data);
  });
  it('Admin sees rows, totals, export and the per-row actions', async () => {
    mockRole = 'admin';
    show();
    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export to Excel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add rebate' })).toBeInTheDocument();
    expect(screen.getByText('Fees not posted')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Apply fees' }).length).toBeGreaterThan(0);
  });
  it('Cashier can only look: no export, no apply, no rebate', async () => {
    mockRole = 'cashier';
    show();
    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export to Excel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add rebate' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Apply fees/ })).toBeNull();
  });
  it('advanced filters are sent to the server', async () => {
    mockRole = 'principal';
    show();
    await screen.findByText('Asha');
    await userEvent.click(screen.getByRole('button', { name: 'Advanced filters' }));
    await userEvent.selectOptions(screen.getByLabelText('Uses bus'), 'true');
    expect(api.mock.calls.some((c) => String(c[0]).includes('transport=true'))).toBe(true);
  });
  it('shows an error with retry when the server fails', async () => {
    mockRole = 'admin';
    api.mockRejectedValue(new Error('boom'));
    show();
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
