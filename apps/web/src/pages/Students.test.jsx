import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { Students } from './Students';

vi.mock('../api/client', () => ({ api: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from '../api/client';

let mockRole = 'admin';
const list = {
  page: 1,
  pageSize: 25,
  total: 2,
  counts: { active: 5, inactive: 2, total: 7 },
  sections: ['A', 'B'],
  rows: [
    {
      id: '1',
      admissionNo: '2',
      name: 'Asha',
      classKey: '1',
      section: 'A',
      contactNo: '9876543210',
      address: 'SIWAL',
      status: 'active',
    },
    { id: '2', admissionNo: '10', name: 'Bhumi', classKey: '1', section: 'B', status: 'active' },
  ],
};
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter>
          <Students />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
const urls = () => api.mock.calls.map((c) => String(c[0]));

describe('Students list', () => {
  beforeEach(() => {
    mockRole = 'admin';
    api.mockReset();
    api.mockImplementation(async (url) =>
      String(url).includes('bulk-delete') ? { deleted: 1, requested: 1 } : list,
    );
  });

  it('shows active, inactive and grand totals, the address next to contact, and section options', async () => {
    show();
    expect(await screen.findByText('Active students')).toBeInTheDocument();
    expect(screen.getByText('Inactive students')).toBeInTheDocument();
    expect(screen.getByText('Grand total')).toBeInTheDocument();
    expect(screen.getByText('SIWAL')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'B' })).toBeInTheDocument();
  });

  it('starts sorted by scholar number; clicking Student sorts by name, again reverses', async () => {
    show();
    await screen.findByText('Asha');
    expect(urls()[0]).toContain('sort=admissionNo');
    expect(urls()[0]).toContain('dir=asc');
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Student' }));
    await screen.findByText('Asha');
    expect(urls().at(-1)).toContain('sort=name');
    expect(urls().at(-1)).toContain('dir=asc');
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Student' }));
    await screen.findByText('Asha');
    expect(urls().at(-1)).toContain('dir=desc');
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Adm. no' }));
    await screen.findByText('Asha');
    expect(urls().at(-1)).toContain('sort=admissionNo');
  });

  it('section filter is sent to the server', async () => {
    show();
    await screen.findByText('Asha');
    await userEvent.selectOptions(screen.getByLabelText('Section'), 'B');
    await screen.findByText('Asha');
    expect(urls().at(-1)).toContain('section=B');
  });

  it('bulk delete needs ticks, the word DELETE and a reason, then calls the server', async () => {
    show();
    await screen.findByText('Asha');
    expect(screen.queryByRole('button', { name: /Delete selected/ })).toBeNull();
    await userEvent.click(screen.getByLabelText('Select Asha'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete selected (1)' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete students' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Reason (required)'), 'duplicate entry');
    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(confirm);
    await screen.findByText('1 students deleted.');
    const call = api.mock.calls.find((c) => String(c[0]).includes('bulk-delete'));
    expect(call[1].body).toEqual({ ids: ['1'], reason: 'duplicate entry' });
  });

  it('Cashier sees no tick boxes, no delete and no edit', async () => {
    mockRole = 'cashier';
    show();
    await screen.findByText('Asha');
    expect(screen.queryByLabelText('Select Asha')).toBeNull();
    expect(screen.queryByText('Add student')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
  });
});
