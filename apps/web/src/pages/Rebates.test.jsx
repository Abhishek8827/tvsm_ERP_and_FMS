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
  const asha = { id: 's1', name: 'Asha', fatherName: 'Raj', admissionNo: '7', classKey: '5th', section: 'A', address: 'Dhanora', contactNo: '99', status: 'active' }; // prettier-ignore
  const ravi = { ...asha, id: 's2', name: 'Ravi', admissionNo: '8', classKey: '2' };
  const giveRoutes = () => ({
    '/api/rebates?': list,
    '/api/rebates/lookup/7': asha,
    '/api/rebates/lookup/8': ravi,
    '/api/rebates': { created: [rebate()], failed: [] },
  });
  it('scholar number shows the details; ticking a type opens its amount box; paise + reason are sent', async () => {
    route(giveRoutes());
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Give rebate' }));
    const dlg = within(await screen.findByRole('dialog'));
    await userEvent.type(dlg.getByLabelText('Scholar number (Sch. ID)'), '7');
    expect(await dlg.findByText('Dhanora')).toBeInTheDocument();
    expect(dlg.getByText('Raj')).toBeInTheDocument();
    expect(dlg.queryByLabelText('School fees rebate (₹)')).toBeNull();
    await userEvent.click(dlg.getByLabelText('School fees'));
    await userEvent.click(dlg.getByLabelText('Admission fees'));
    await userEvent.type(dlg.getByLabelText('School fees rebate (₹)'), '500');
    await userEvent.type(dlg.getByLabelText('Admission fees rebate (₹)'), '1500.50');
    await userEvent.selectOptions(dlg.getByLabelText('Reduce which fee'), 'last');
    const give = dlg.getByRole('button', { name: 'Give rebate' });
    expect(give).toBeDisabled(); // reason missing
    await userEvent.type(dlg.getByLabelText(/Reason/), 'staff child');
    await userEvent.click(give);
    const post = api.mock.calls.find((c) => c[0] === '/api/rebates' && c[1]?.method === 'POST');
    expect(post[1].body).toEqual({
      studentId: 's1',
      items: [
        { type: 'school', amountPaise: 50000 },
        { type: 'admission', amountPaise: 150050 },
      ],
      reason: 'staff child',
      category: 'other',
      adjustOn: 'last',
    });
  });
  it('BC asks for the sibling (shows name and class) and OTP asks for the receipt number', async () => {
    route(giveRoutes());
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Give rebate' }));
    const dlg = within(await screen.findByRole('dialog'));
    await userEvent.type(dlg.getByLabelText('Scholar number (Sch. ID)'), '7');
    await dlg.findByText('Dhanora');
    await userEvent.click(dlg.getByLabelText('School fees'));
    await userEvent.type(dlg.getByLabelText('School fees rebate (₹)'), '500');
    await userEvent.type(dlg.getByLabelText(/Reason/), 'BC');
    await userEvent.selectOptions(dlg.getByLabelText('Rebate category'), 'bc');
    expect(dlg.queryByLabelText('Reduce which fee')).toBeNull();
    const give = dlg.getByRole('button', { name: 'Give rebate' });
    expect(give).toBeDisabled(); // sibling missing
    await userEvent.type(dlg.getByLabelText("Sibling's scholar number"), '8');
    expect(await dlg.findByText('Ravi')).toBeInTheDocument();
    expect(give).toBeEnabled();
    await userEvent.click(give);
    const post = api.mock.calls.find((c) => c[0] === '/api/rebates' && c[1]?.method === 'POST');
    expect(post[1].body).toMatchObject({ category: 'bc', siblingNo: '8' });
  });
  it('OTP needs the receipt number before the button works', async () => {
    route(giveRoutes());
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Give rebate' }));
    const dlg = within(await screen.findByRole('dialog'));
    await userEvent.type(dlg.getByLabelText('Scholar number (Sch. ID)'), '7');
    await dlg.findByText('Dhanora');
    await userEvent.click(dlg.getByLabelText('School fees'));
    await userEvent.type(dlg.getByLabelText('School fees rebate (₹)'), '500');
    await userEvent.type(dlg.getByLabelText(/Reason/), 'OTP');
    await userEvent.selectOptions(dlg.getByLabelText('Rebate category'), 'otp');
    const give = dlg.getByRole('button', { name: 'Give rebate' });
    expect(give).toBeDisabled();
    await userEvent.type(dlg.getByLabelText(/Receipt number/), '2054');
    expect(give).toBeEnabled();
  });
  it('an unknown scholar number says so and keeps Give rebate disabled', async () => {
    route({
      '/api/rebates/lookup/99': () => {
        throw Object.assign(new Error('Student not found'), { status: 404 });
      },
      ...giveRoutes(),
    });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Give rebate' }));
    const dlg = within(await screen.findByRole('dialog'));
    await userEvent.type(dlg.getByLabelText('Scholar number (Sch. ID)'), '99');
    expect(await dlg.findByText('Scholar number not found.')).toBeInTheDocument();
    expect(dlg.getByRole('button', { name: 'Give rebate' })).toBeDisabled();
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
