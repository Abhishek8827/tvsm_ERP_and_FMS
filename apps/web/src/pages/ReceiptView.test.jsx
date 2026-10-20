import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { ReceiptView } from './ReceiptView';

vi.mock('../api/client', () => ({ api: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ role: 'cashier' }) }));
import { api } from '../api/client';

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
    window.print = vi.fn();
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
    expect(window.print).toHaveBeenCalledTimes(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Print duplicate' }));
    expect(await screen.findAllByText('DUPLICATE')).toHaveLength(2);
    expect(api).toHaveBeenCalledWith('/api/receipts/r1/reprint', { method: 'POST' });
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
});
