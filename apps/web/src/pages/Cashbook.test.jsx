import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { Cashbook } from './Cashbook';

vi.mock('../api/client', () => ({ api: vi.fn() }));
vi.mock('../lib/printHtml', () => ({ printHtml: vi.fn().mockResolvedValue() }));
let mockRole = 'admin';
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from '../api/client';
import { printHtml } from '../lib/printHtml';

const rr = (o) => ({ id: o.number, admissionNo: '7', classKey: '5th', section: 'A', name: 'Asha', cashPaise: 0, onlinePaise: 0, duePaise: 0, bankName: null, ...o }); // prettier-ignore
const block = (o) => ({ openingPaise: 100000, receiptsPaise: 50000, otherPaise: 0, expensePaise: 20000, closingPaise: 130000, ...o }); // prettier-ignore
const book = (o = {}) => ({
  date: '2026-10-10', closed: true, closedBy: 'A', cancelledToday: 0,
  school: { rows: [rr({ number: 'S-1', cashPaise: 150000, duePaise: 50000 })], cashPaise: 150000, onlinePaise: 0, totalPaise: 150000 },
  bus: { rows: [rr({ number: 'T-1', onlinePaise: 60000, bankName: 'HDFC' })], cashPaise: 0, onlinePaise: 60000, totalPaise: 60000 },
  expenses: { rows: [{ id: 'e1', voucherNo: 'EXP/1', head: 'Stationery', payee: 'Shop', amountPaise: 30000, reversal: false, by: 'President', account: 'cash', mode: 'Cash' }], totalPaise: 30000 },
  cash: block({}),
  online: { banks: [{ id: 'h', name: 'HDFC', ...block({ openingPaise: 500000, closingPaise: 560000 }) }], unassignedPaise: 0, closingPaise: 560000 },
  transport: { configured: false },
  totals: { receiptsPaise: 210000, expensePaise: 30000, closingPaise: 690000 },
  ...o,
}); // prettier-ignore

function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <Cashbook />
      </ToastProvider>
    </QueryClientProvider>,
  );
}
function route(map) {
  api.mockImplementation(async (url, opts) => {
    const hit = Object.entries(map).find(([k]) => String(url).startsWith(k));
    if (!hit) throw new Error(`unexpected ${opts?.method ?? 'GET'} ${url}`);
    return typeof hit[1] === 'function' ? hit[1](url, opts) : hit[1];
  });
}

describe('Cashbook screen', () => {
  beforeEach(() => {
    api.mockReset();
    printHtml.mockClear();
    mockRole = 'admin';
  });
  it('shows the six sections and the Day closed tag', async () => {
    route({ '/api/cashbook?': book() });
    show();
    expect(await screen.findByText('Day closed')).toBeInTheDocument();
    for (const t of [
      '1. School fees receipts',
      '2. Bus fees receipts',
      '3. Expense summary',
      '4. Cash balance',
      '5. Online balance',
      '6. Transport account',
    ])
      expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByText('S-1')).toBeInTheDocument();
    expect(screen.getByText('EXP/1')).toBeInTheDocument();
    expect(screen.getAllByText('Closing balance').length).toBeGreaterThanOrEqual(2);
  });
  it('an open day is tagged Day open; a different date asks the server for that date', async () => {
    route({ '/api/cashbook?': (u) => book({ closed: false, date: String(u).split('=')[1] }) });
    show();
    expect(await screen.findByText('Day open')).toBeInTheDocument();
    const date = screen.getByLabelText('Date');
    fireEvent.change(date, { target: { value: '2026-10-01' } });
    await waitFor(() =>
      expect(api.mock.calls.some((c) => String(c[0]).endsWith('date=2026-10-01'))).toBe(true),
    );
  });
  it('prints the day as A4 and exports to Excel', async () => {
    route({ '/api/cashbook?': book(), '/api/cashbook/export': new Blob(['x']) });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    show();
    await screen.findByText('Day closed');
    await userEvent.click(screen.getByRole('button', { name: 'Print (A4)' }));
    expect(printHtml).toHaveBeenCalledOnce();
    expect(printHtml.mock.calls[0][0].html).toContain('Cashbook');
    await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));
    expect(api.mock.calls.some((c) => String(c[0]).startsWith('/api/cashbook/export?date='))).toBe(
      true,
    );
  });
  it('only the Admin gets the transport settings button; others see a message', async () => {
    route({ '/api/cashbook?': book() });
    const { unmount } = show();
    await screen.findByText('Day closed');
    expect(screen.getByRole('button', { name: 'Transport account settings' })).toBeInTheDocument();
    unmount();
    mockRole = 'cashier';
    show();
    await screen.findByText('Day closed');
    expect(screen.queryByRole('button', { name: 'Transport account settings' })).toBeNull();
    expect(
      screen.getByText('The Admin has not set up the transport account yet.'),
    ).toBeInTheDocument();
  });
  it('saves the transport account settings with a reason', async () => {
    route({
      '/api/cashbook/settings': (u, o) =>
        o?.method === 'PUT'
          ? { ok: true }
          : {
              transportOpeningPaise: 0,
              transportStartDate: null,
              transportHeads: [],
              history: [],
              expenseHeads: ['Bus Diesel'],
            },
      '/api/cashbook?': book(),
    });
    show();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Transport account settings' }),
    );
    const dlg = within(await screen.findByRole('dialog'));
    const save = dlg.getByRole('button', { name: 'Save' });
    await dlg.findByLabelText('Bus Diesel');
    expect(save).toBeDisabled();
    await userEvent.clear(dlg.getByLabelText(/Opening amount/));
    await userEvent.type(dlg.getByLabelText(/Opening amount/), '3000');
    await userEvent.click(dlg.getByLabelText('Bus Diesel'));
    await userEvent.type(dlg.getByLabelText(/Reason/), 'start');
    await userEvent.click(save);
    const put = api.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put[1].body).toMatchObject({
      openingRupees: '3000',
      heads: ['Bus Diesel'],
      reason: 'start',
    });
  });
  it('shows an error state with retry', async () => {
    api.mockRejectedValue(new Error('server down'));
    show();
    expect(await screen.findByText(/server down/)).toBeInTheDocument();
  });
});
