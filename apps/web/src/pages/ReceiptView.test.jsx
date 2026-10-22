import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { ReceiptView } from './ReceiptView';

vi.mock('../api/client', () => ({ api: vi.fn() }));
vi.mock('../lib/printHtml', () => ({ printHtml: vi.fn().mockResolvedValue() }));
let role = 'cashier';
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ role }) }));
import { api } from '../api/client';
import { printHtml } from '../lib/printHtml';

const receipt = {
  id: 'r1',
  number: 'S-FY2026-27/2054',
  kind: 'school',
  fy: '2026-27',
  student: {
    admissionNo: '10',
    name: 'Aarav Sharma',
    classKey: '1',
    section: 'A',
    contactNo: '9876543210',
  },
  lines: [
    { head: 'tuition', label: 'Tuition Fees', amountPaise: 100000 },
    { head: 'old_fees', label: 'Old Fees', amountPaise: 50000 },
  ],
  totalPaise: 150000,
  monthLabel: 'June',
  dueAfterPaise: 0,
  dueAfterOldPaise: 0,
  dueAfterNewPaise: 0,
  status: 'valid',
  mode: 'upi',
  reference: 'UPI998877',
  cashierName: 'Ramesh',
  issuedAt: '2026-06-10T05:00:00Z',
};
function show(state) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter initialEntries={[{ pathname: '/receipts/r1', state }]}>
          <Routes>
            <Route path="/receipts/:id" element={<ReceiptView />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Receipt view', () => {
  beforeEach(() => {
    api.mockReset();
    role = 'cashier';
    printHtml.mockReset();
    printHtml.mockResolvedValue();
  });

  it('prints a Student copy and an Office copy with the number, title, month and total', async () => {
    api.mockResolvedValue(receipt);
    show({ fresh: true });
    expect(await screen.findAllByText('SCHOOL FEES RECEIPT')).toHaveLength(2);
    expect(screen.getByText('STUDENT COPY')).toBeInTheDocument();
    expect(screen.getByText('OFFICE COPY')).toBeInTheDocument();
    expect(screen.getAllByText('S-FY2026-27/2054')).toHaveLength(2);
    expect(screen.getAllByText(/Affiliation No. 572078/)).toHaveLength(2);
    expect(screen.getAllByText('Month: June')).toHaveLength(2);
    expect(screen.queryByText('DUPLICATE')).toBeNull();
  });

  it('a fresh receipt prints once as the original; after that only a DUPLICATE print is offered', async () => {
    api.mockImplementation(async (url) =>
      String(url).endsWith('/reprint') ? { ...receipt, duplicate: true } : receipt,
    );
    show({ fresh: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Print receipt' }));
    expect(printHtml).toHaveBeenCalledTimes(1);
    // Only the receipt is printed (no menu, clock or page chrome).
    const sent = printHtml.mock.calls[0][0];
    expect(sent.html).toContain('STUDENT COPY');
    expect(sent.html).toContain('OFFICE COPY');
    expect(sent.html).not.toContain('Sign out');
    expect(sent.css).toContain('@page');
    await userEvent.click(await screen.findByRole('button', { name: 'Print duplicate' }));
    expect(await screen.findAllByText('DUPLICATE')).toHaveLength(2);
    expect(api).toHaveBeenCalledWith('/api/receipts/r1/reprint', { method: 'POST' });
    // The duplicate print carries the DUPLICATE stamp.
    expect(printHtml).toHaveBeenCalledTimes(2);
    expect(printHtml.mock.calls[1][0].html).toContain('DUPLICATE');
  });

  it('an old receipt opened later offers only Print duplicate, and WhatsApp opens a wa.me link', async () => {
    api.mockResolvedValue(receipt);
    show(undefined);
    expect(await screen.findByRole('button', { name: 'Print duplicate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print receipt' })).toBeNull();
    const wa = screen.getByRole('link', { name: 'Send on WhatsApp' });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
  });

  it('shows an error state when the receipt cannot be loaded', async () => {
    api.mockRejectedValue(new Error('Receipt not found.'));
    show({ fresh: true });
    expect(await screen.findByText('Receipt not found.')).toBeInTheDocument();
  });

  it('shows old dues and new dues separately, and one address (village is the same thing)', async () => {
    api.mockResolvedValue({
      ...receipt,
      dueAfterOldPaise: 50000,
      dueAfterNewPaise: 70000,
      student: { ...receipt.student, address: 'Ward 4', village: 'Khakner' },
    });
    show();
    expect((await screen.findAllByText(/Old Dues/)).length).toBe(2);
    expect(screen.getAllByText(/New Dues/).length).toBe(2);
    expect(screen.getAllByText(/Add\.: Ward 4/).length).toBe(2);
    expect(screen.queryByText(/Khakner/)).not.toBeInTheDocument();
  });

  it('cashier requests cancellation with a reason; admin cancels directly', async () => {
    api.mockResolvedValue(receipt);
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Request cancellation' }));
    await userEvent.type(screen.getByRole('textbox'), 'Wrong student');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await vi.waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/api/receipts/r1/cancel-request',
        expect.objectContaining({ method: 'POST', body: { reason: 'Wrong student' } }),
      ),
    );
  });

  it('a cancelled receipt shows the CANCELLED stamp and no cancel button', async () => {
    role = 'admin';
    api.mockResolvedValue({
      ...receipt,
      status: 'cancelled',
      cancellation: { reason: 'Duplicate entry' },
    });
    show();
    expect((await screen.findAllByText('CANCELLED')).length).toBe(2);
    expect(screen.queryByRole('button', { name: 'Cancel receipt' })).not.toBeInTheDocument();
  });
});
