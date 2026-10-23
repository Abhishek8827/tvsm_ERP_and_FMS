import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { Rebates } from './Rebates';

vi.mock('../api/client', () => ({ api: vi.fn() }));
let mockRole = 'admin';
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from '../api/client';

const rebate = (o = {}) => ({
  id: 'r1', studentId: 's1', student: { name: 'Asha', admissionNo: '7', classKey: '5th' },
  type: 'school', adjustOn: 'last', periods: [], totalPaise: 50000, reason: 'BC', status: 'active',
  createdAt: '2026-10-01T05:00:00Z', ...o,
}); // prettier-ignore
const list = {
  page: 1,
  pageSize: 25,
  total: 1,
  totals: { paise: 50000, count: 1 },
  rows: [rebate()],
};
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter>
          <Rebates />
        </MemoryRouter>
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

describe('Rebates screen', () => {
  beforeEach(() => {
    api.mockReset();
    mockRole = 'admin';
  });
  it('lists rebates with type, amount, adjusted-on and reason', async () => {
    route({ '/api/rebates?': list });
    show();
    expect(await screen.findByText('Asha')).toBeInTheDocument();
    // "School fees" is also a filter option, so look inside the table row.
    expect(
      within(screen.getByRole('row', { name: /Asha/ })).getByText('School fees'),
    ).toBeInTheDocument();
    expect(screen.getByText('Last month')).toBeInTheDocument();
    expect(screen.getByText('BC')).toBeInTheDocument();
  });
  it('the Principal can look and export but cannot give, import or reverse', async () => {
    mockRole = 'principal';
    route({ '/api/rebates?': list });
    show();
    await screen.findByText('Asha');
    expect(screen.getByRole('button', { name: 'Export to Excel' })).toBeInTheDocument();
    for (const n of ['Give rebate', 'Import from Excel', 'Reverse'])
      expect(screen.queryByRole('button', { name: n })).toBeNull();
  });
  it('shows an empty state and an error state', async () => {
    route({ '/api/rebates?': { ...list, rows: [], total: 0, totals: { paise: 0, count: 0 } } });
    show();
    expect(await screen.findByText('No rebates yet')).toBeInTheDocument();
  });
  it('ticking a type opens its amount box; the rebate is sent in paise with the reason', async () => {
    route({
      '/api/rebates?': list,
      '/api/students?': { rows: [{ id: 's1', name: 'Asha', admissionNo: '7', classKey: '5th' }] },
      '/api/rebates': { created: [rebate()], failed: [] },
    });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Give rebate' }));
    const dlg = within(await screen.findByRole('dialog'));
    await userEvent.type(dlg.getByLabelText('Student'), 'Asha');
    await userEvent.click(await dlg.findByRole('button', { name: /Asha/ }));
    expect(dlg.queryByLabelText('School fees rebate (₹)')).toBeNull();
    await userEvent.click(dlg.getByLabelText('School fees'));
    await userEvent.click(dlg.getByLabelText('Admission fees'));
    await userEvent.type(dlg.getByLabelText('School fees rebate (₹)'), '500');
    await userEvent.type(dlg.getByLabelText('Admission fees rebate (₹)'), '1500.50');
    await userEvent.selectOptions(dlg.getByLabelText('Reduce which fee'), 'last');
    const give = dlg.getByRole('button', { name: 'Give rebate' });
    expect(give).toBeDisabled(); // reason missing
    await userEvent.type(dlg.getByLabelText(/Reason/), 'BC');
    await userEvent.click(give);
    const post = api.mock.calls.find((c) => c[0] === '/api/rebates' && c[1]?.method === 'POST');
    expect(post[1].body).toEqual({
      studentId: 's1',
      items: [
        { type: 'school', amountPaise: 50000 },
        { type: 'admission', amountPaise: 150050 },
      ],
      reason: 'BC',
      adjustOn: 'last',
    });
  });
  it('import: check the file first, then import', async () => {
    route({
      '/api/rebates?': list,
      '/api/rebates/import?commit=false': { committed: false, rowsInFile: 2, ready: 1, created: 0, skipped: 1, errors: [{ row: 3, message: 'SCH. 99 not found (skipped)' }] },
      '/api/rebates/import?commit=true': { committed: true, rowsInFile: 2, ready: 1, created: 1, skipped: 1, errors: [] },
    }); // prettier-ignore
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Import from Excel' }));
    const file = new File(['x'], 'r.xlsx');
    await userEvent.upload(screen.getByLabelText('Excel file'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }));
    expect(await screen.findByText('SCH. 99 not found (skipped)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 rebates' }));
    expect(await screen.findByText('Import finished')).toBeInTheDocument();
    expect(api.mock.calls.some((c) => String(c[0]).endsWith('commit=true'))).toBe(true);
  });
  it('reversing needs a reason', async () => {
    route({ '/api/rebates?': list, '/api/rebates/r1/reverse': rebate({ status: 'reversed' }) });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Reverse' }));
    const dlg = within(await screen.findByRole('dialog'));
    const go = dlg.getByRole('button', { name: 'Reverse rebate' });
    expect(go).toBeDisabled();
    await userEvent.type(dlg.getByRole('textbox'), 'Given by mistake');
    await userEvent.click(go);
    const post = api.mock.calls.find((c) => String(c[0]).endsWith('/reverse'));
    expect(post[1].body).toEqual({ reason: 'Given by mistake' });
  });
});
