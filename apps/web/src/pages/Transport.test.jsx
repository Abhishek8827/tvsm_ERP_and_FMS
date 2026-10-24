import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { Transport } from './Transport';

vi.mock('../api/client', () => ({ api: vi.fn() }));
let mockRole = 'admin';
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from '../api/client';

const row = (o = {}) => ({
  id: 's1', admissionNo: '7', name: 'Asha', classKey: '5th', section: 'A', address: 'Dhanora',
  village: 'DHANORA', monthlyPaise: 50000, state: 'on', transportFrom: '2026-06', transportUntil: null, ...o,
}); // prettier-ignore
const list = { page: 1, pageSize: 25, total: 2, rows: [row(), row({ id: 's2', admissionNo: '9', name: 'Ravi', state: 'pending', village: '', transportFrom: null, monthlyPaise: null })] }; // prettier-ignore
const lookup = {
  ...row({ state: 'none', village: '', transportFrom: null }), status: 'active', fy: '2026-27',
  suggestedVillage: 'DHANORA', defaultFromMonth: '2026-06',
  villages: [{ name: 'DHANORA', monthlyPaise: 50000 }, { name: 'BORI', monthlyPaise: 70000 }],
  months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
}; // prettier-ignore

function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter>
          <Transport />
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

describe('Transport screen', () => {
  beforeEach(() => {
    api.mockReset();
    mockRole = 'admin';
  });
  it('lists students with village, fee and status; the Admin sees Stop / Enter', async () => {
    route({ '/api/transport?': list });
    show();
    expect(await screen.findByText('Asha')).toBeInTheDocument();
    const r = screen.getByRole('row', { name: /Asha/ });
    expect(within(r).getByText('DHANORA')).toBeInTheDocument();
    expect(within(r).getByText('On bus')).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Ravi/ })).getByRole('button', { name: 'Enter' }),
    ).toBeInTheDocument();
  });
  it('others can only look: no Add, Stop or Enter buttons', async () => {
    for (const role of ['principal', 'cashier']) {
      mockRole = role;
      route({ '/api/transport?': list });
      const { unmount } = show();
      await screen.findByText('Asha');
      for (const n of ['Add student to bus', 'Stop', 'Enter'])
        expect(screen.queryByRole('button', { name: n })).toBeNull();
      unmount();
    }
  });
  it('shows an empty state and an error state with retry', async () => {
    route({ '/api/transport?': { ...list, rows: [], total: 0 } });
    const { unmount } = show();
    expect(await screen.findByText('No transport students')).toBeInTheDocument();
    unmount();
    api.mockReset();
    api.mockRejectedValue(new Error('boom'));
    show();
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
  it('adding: scholar number shows details, village is taken from the address, June is the default month', async () => {
    route({
      '/api/transport?': list,
      '/api/transport/lookup/7': lookup,
      '/api/transport/enroll': { student: row(), newCharges: 5 },
    });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Add student to bus' }));
    const dlg = within(await screen.findByRole('dialog'));
    const save = dlg.getByRole('button', { name: 'Add to bus' });
    expect(save).toBeDisabled();
    await userEvent.type(dlg.getByLabelText('Scholar number (Sch. ID)'), '7');
    expect(await dlg.findByText('Asha')).toBeInTheDocument();
    expect(await dlg.findByLabelText('Village')).toHaveValue('DHANORA');
    expect(dlg.getByLabelText('Bus fee starts from')).toHaveValue('2026-06');
    await userEvent.click(save);
    const post = api.mock.calls.find((c) => c[0] === '/api/transport/enroll');
    expect(post[1].body).toEqual({ studentId: 's1', village: 'DHANORA', fromMonth: '2026-06' });
  });
  it('stopping needs a month and a reason', async () => {
    route({
      '/api/transport?': list,
      '/api/transport/lookup/7': lookup,
      '/api/transport/stop': { student: row({ state: 'stopped' }), removedMonths: 2 },
    });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    const dlg = within(await screen.findByRole('dialog'));
    const go = dlg.getByRole('button', { name: 'Stop bus' });
    expect(go).toBeDisabled();
    await userEvent.selectOptions(
      await dlg.findByLabelText('No bus fee from this month'),
      '2026-08',
    );
    await userEvent.type(dlg.getByLabelText(/Reason/), 'shifted');
    await userEvent.click(go);
    const post = api.mock.calls.find((c) => c[0] === '/api/transport/stop');
    expect(post[1].body).toEqual({ studentId: 's1', fromMonth: '2026-08', reason: 'shifted' });
  });
  it('an unknown scholar number says so', async () => {
    route({
      '/api/transport?': list,
      '/api/transport/lookup/99': () => {
        throw Object.assign(new Error('nf'), { status: 404 });
      },
    });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Add student to bus' }));
    const dlg = within(await screen.findByRole('dialog'));
    await userEvent.type(dlg.getByLabelText('Scholar number (Sch. ID)'), '99');
    expect(await dlg.findByText('Scholar number not found.')).toBeInTheDocument();
    expect(dlg.getByRole('button', { name: 'Add to bus' })).toBeDisabled();
  });
});
