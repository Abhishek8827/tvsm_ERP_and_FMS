import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { bonafideHtml, tcHtml } from '../lib/certificateHtml';
import { TcBonafide } from './TcBonafide';

vi.mock('../api/client', () => ({ api: vi.fn(), newIdempotencyKey: () => 'key-test-12345' }));
vi.mock('../lib/printHtml', () => ({ printHtml: vi.fn(async () => {}) }));
let mockRole = 'admin';
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from '../api/client';

const snapshot = {
  admissionNo: '412', name: 'Aarav Sharma', motherName: 'Sunita', fatherName: 'Rajesh',
  dob: '2014-03-14', dobInWords: 'Fourteenth March Two Thousand Fourteen', nationality: 'Indian',
  category: 'General', firstAdmissionDate: '2019-07-04', firstAdmissionClass: '1st', lastClass: '7',
  lastClassInWords: '7 (Seventh)', section: 'A', duesPaidUpto: 'September 2026', feeConcession: 'None',
}; // prettier-ignore
const entered = {
  lastExam: 'Annual 2025-26, Passed', failedInSameClass: 'No', subjects: 'English',
  qualifiedForPromotion: 'Yes, to next class', workingDays: 220, daysPresent: 198, ncc: 'Not applicable',
  games: 'Kabaddi', conduct: 'Very Good', dateOfApplication: '2026-10-12', dateOfIssue: '2026-10-13',
  reason: 'Parent Request', remarks: 'None',
}; // prettier-ignore
const tc = (o = {}) => ({ id: 't1', fy: '2026-27', slNo: 143, bookNo: '7', studentId: 's1', snapshot, entered, duesOverride: null, status: 'issued', duplicateCount: 0, ...o }); // prettier-ignore
const tcList = { rows: [tc()], total: 1, page: 1, pageSize: 25 };
const student = { id: 's1', name: 'Aarav Sharma', admissionNo: '412', classKey: '7', section: 'A', status: 'active' }; // prettier-ignore
const draft = (o = {}) => ({
  fy: '2026-27', today: '2026-10-13', existingTc: null, student: { id: 's1', status: 'active' },
  snapshot, pen: '', aparId: '', missing: [], pendingPaise: 0, duesPaidUpto: 'September 2026',
  bookNo: '7', nextSl: 143,
  defaults: { qualifiedForPromotion: 'Yes, to next class', ncc: 'Not applicable', games: 'Not applicable', remarks: 'None', dateOfIssue: '2026-10-13', dateOfApplication: '2026-10-13' },
  ...o,
}); // prettier-ignore

function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter>
          <TcBonafide />
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
const fill = async (user, label, value) => {
  const el = screen.getByLabelText(label);
  await user.clear(el);
  await user.type(el, value);
};

describe('TC & Bonafide screen', () => {
  beforeEach(() => {
    api.mockReset();
    mockRole = 'admin';
  });

  it('Admin sees the list with Generate, Print duplicate, Cancel and a Settings tab', async () => {
    route({ '/api/tc?': tcList });
    show();
    const row = await screen.findByRole('row', { name: /Aarav/ });
    expect(within(row).getByText('0143')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Print duplicate' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Generate Transfer Certificate' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
  });

  it('Principal and Cashier can only look: no Generate, Print, Cancel or Settings; the preview has no print', async () => {
    for (const role of ['principal', 'cashier']) {
      mockRole = role;
      route({ '/api/tc?': tcList });
      const { unmount } = show();
      const row = await screen.findByRole('row', { name: /Aarav/ });
      for (const n of ['Print duplicate', 'Cancel', 'Generate Transfer Certificate'])
        expect(screen.queryByRole('button', { name: n })).toBeNull();
      expect(screen.queryByRole('tab', { name: 'Settings' })).toBeNull();
      await userEvent.click(within(row).getByRole('button', { name: 'View' }));
      expect(await screen.findByTitle('Certificate preview')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Print / Save as PDF' })).toBeNull();
      unmount();
    }
  });

  it('shows empty and error states (with retry)', async () => {
    route({ '/api/tc?': { rows: [], total: 0, page: 1, pageSize: 25 } });
    const a = show();
    expect(await screen.findByText('No Transfer Certificates yet')).toBeInTheDocument();
    a.unmount();
    api.mockReset();
    api.mockRejectedValue(new Error('Server down'));
    show();
    expect(await screen.findByText(/Server down/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('with no dues: fills the form, validates, then issues once with an Idempotency-Key', async () => {
    const user = userEvent.setup();
    const posts = [];
    route({
      '/api/tc?': tcList,
      '/api/students?': { rows: [student], total: 1 },
      '/api/tc/draft/s1': draft(),
      '/api/tc': (url, opts) => {
        posts.push(opts);
        return tc({ ...opts.body, slNo: 143 });
      },
    });
    show();
    await user.click(await screen.findByRole('button', { name: 'Generate Transfer Certificate' }));
    await user.type(screen.getByLabelText(/Find student/), 'Aarav');
    await user.click(await screen.findByRole('button', { name: /Aarav Sharma/ }));
    expect(await screen.findByText(/No fee dues pending/)).toBeInTheDocument();
    // empty compulsory fields stop the Admin before any request is sent
    await user.click(screen.getByRole('button', { name: 'Issue Transfer Certificate' }));
    expect(await screen.findByText('Last exam and result is required')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    await fill(user, /9\. Annual exam/, 'Annual 2025-26, Passed');
    await fill(user, /11\. Subjects/, 'English, Hindi');
    await fill(user, /15\. Working days/, '220');
    await fill(user, /16\. Days present/, '198');
    await user.click(screen.getByRole('button', { name: 'Issue Transfer Certificate' }));
    expect(await screen.findByTitle('Certificate preview')).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    expect(posts[0].idempotencyKey).toBe('key-test-12345');
    expect(posts[0].body).toMatchObject({
      studentId: 's1', bookNo: '7', workingDays: 220, daysPresent: 198, conduct: 'Good', reason: 'Parent Request',
    }); // prettier-ignore
    expect(posts[0].body.duesOverrideReason).toBeUndefined();
    // the freshly issued ORIGINAL can be printed
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeInTheDocument();
  });

  it('with dues pending: shows the amount and needs a reason before it will send', async () => {
    const user = userEvent.setup();
    const posts = [];
    route({
      '/api/tc?': tcList,
      '/api/students?': { rows: [student], total: 1 },
      '/api/tc/draft/s1': draft({ pendingPaise: 150000 }),
      '/api/tc': (url, opts) => {
        posts.push(opts);
        return tc({ duesOverride: { reason: opts.body.duesOverrideReason, duePaise: 150000 } });
      },
    });
    show();
    await user.click(await screen.findByRole('button', { name: 'Generate Transfer Certificate' }));
    await user.type(screen.getByLabelText(/Find student/), 'Aarav');
    await user.click(await screen.findByRole('button', { name: /Aarav Sharma/ }));
    expect(await screen.findByText(/Fees are still due: ₹1,500/)).toBeInTheDocument();
    await fill(user, /9\. Annual exam/, 'Passed');
    await fill(user, /11\. Subjects/, 'English');
    await fill(user, /15\. Working days/, '220');
    await fill(user, /16\. Days present/, '198');
    await user.click(screen.getByRole('button', { name: 'Issue Transfer Certificate' }));
    expect(await screen.findByText(/Write the reason/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    await fill(user, /Reason to issue with dues pending/, 'Principal allowed');
    await user.click(screen.getByRole('button', { name: 'Issue Transfer Certificate' }));
    await screen.findByTitle('Certificate preview');
    expect(posts[0].body.duesOverrideReason).toBe('Principal allowed');
  });

  it('asks for details the record lacks', async () => {
    const user = userEvent.setup();
    route({
      '/api/tc?': tcList,
      '/api/students?': { rows: [student], total: 1 },
      '/api/tc/draft/s1': draft({
        snapshot: { ...snapshot, firstAdmissionDate: null },
        missing: [{ key: 'firstAdmissionDate', label: 'Date of first admission' }],
      }),
    });
    show();
    await user.click(await screen.findByRole('button', { name: 'Generate Transfer Certificate' }));
    await user.type(screen.getByLabelText(/Find student/), 'Aarav');
    await user.click(await screen.findByRole('button', { name: /Aarav Sharma/ }));
    await screen.findByText(/No fee dues pending/);
    await fill(user, /9\. Annual exam/, 'Passed');
    await fill(user, /11\. Subjects/, 'English');
    await fill(user, /15\. Working days/, '220');
    await fill(user, /16\. Days present/, '198');
    await user.click(screen.getByRole('button', { name: 'Issue Transfer Certificate' }));
    expect(await screen.findByText('Date of first admission is required')).toBeInTheDocument();
  });

  it('Bonafide: Admin generates only for active students, purpose required', async () => {
    const user = userEvent.setup();
    const posts = [];
    const bon = {
      id: 'b1', number: 'BON/FY2026-27/001', fy: '2026-27', seq: 1, studentId: 's1',
      snapshot: { admissionNo: '412', name: 'Aarav Sharma', fatherName: 'Rajesh', gender: 'MALE', classKey: '7', section: 'A', dob: '2014-03-14' },
      academicYear: '2026-27', purpose: 'Passport', dateOfIssue: '2026-10-13', status: 'issued', duplicateCount: 0,
    }; // prettier-ignore
    route({
      '/api/tc?': tcList,
      '/api/bonafide?': { rows: [], total: 0, page: 1, pageSize: 25 },
      '/api/students?status=active': { rows: [student], total: 1 },
      '/api/bonafide': (url, opts) => {
        posts.push(opts);
        return bon;
      },
    });
    show();
    await user.click(screen.getByRole('tab', { name: 'Bonafide' }));
    expect(await screen.findByText('No Bonafide certificates yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate Bonafide' }));
    await user.type(screen.getByLabelText(/Find student/), 'Aarav');
    await user.click(await screen.findByRole('button', { name: /Aarav Sharma/ }));
    await user.click(screen.getByRole('button', { name: 'Generate certificate' }));
    expect(await screen.findByText('Write the purpose')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    await user.type(screen.getByLabelText(/Purpose/), 'Passport');
    await user.click(screen.getByRole('button', { name: 'Generate certificate' }));
    expect(await screen.findByTitle('Certificate preview')).toBeInTheDocument();
    expect(posts[0].body).toMatchObject({ studentId: 's1', purpose: 'Passport' });
    expect(posts[0].idempotencyKey).toBe('key-test-12345');
  });

  it('Settings: the start Sl. No. is locked once a TC exists', async () => {
    const user = userEvent.setup();
    route({
      '/api/tc?': tcList,
      '/api/certificates/settings': {
        tcBookNo: '7',
        tcStartSl: 143,
        fy: '2026-27',
        startLocked: true,
        history: [],
      },
    });
    show();
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(await screen.findByLabelText(/First Sl. No./)).toBeDisabled();
    expect(screen.getByLabelText('Book No.')).toBeEnabled();
  });
});

describe('TC already issued', () => {
  it('refuses a student who already has a TC and shows no form', async () => {
    mockRole = 'admin';
    const user = userEvent.setup();
    route({
      '/api/tc?': tcList,
      '/api/students?': { rows: [student], total: 1 },
      '/api/tc/draft/s1': draft({ existingTc: { id: 't1', slNo: 143 } }),
    });
    show();
    await user.click(await screen.findByRole('button', { name: 'Generate Transfer Certificate' }));
    await user.type(screen.getByLabelText(/Find student/), 'Aarav');
    await user.click(await screen.findByRole('button', { name: /Aarav Sharma/ }));
    expect(await screen.findByText(/already issued/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue Transfer Certificate' })).toBeNull();
  });
});

describe('certificate print HTML', () => {
  it('TC has 23 fields, no image except the logo, blank sign lines and the right footer', () => {
    const html = tcHtml(tc());
    expect(html.match(/<tr>/g)).toHaveLength(23);
    expect(html).toContain('Sl. No.: <b>0143</b>');
    expect(html).toContain('14/03/2014 · Fourteenth March Two Thousand Fourteen');
    expect(html).toContain('Fee dues were checked and cleared before issue.');
    expect(html).toContain('Original copy');
    expect(html.match(/<img/g)).toHaveLength(1); // only the school logo, never a signature or seal
    expect(html).not.toContain('DUPLICATE');
  });
  it('a duplicate is marked; a TC issued with dues does not claim they were cleared', () => {
    const html = tcHtml(tc({ duesOverride: { reason: 'x', duePaise: 1 } }), { copyNo: 2 });
    expect(html).toContain('DUPLICATE COPY 2');
    expect(html).not.toContain('cleared');
  });
  it('escapes names so typed text cannot inject markup', () => {
    const html = tcHtml(tc({ snapshot: { ...snapshot, name: '<b>X</b>' } }));
    expect(html).not.toContain('<b>X</b></td>');
    expect(html).toContain('&lt;B&gt;X&lt;/B&gt;');
  });
  it('Bonafide wording follows the school format', () => {
    const html = bonafideHtml({
      number: 'BON/FY2026-27/001', academicYear: '2026-27', purpose: 'Passport', dateOfIssue: '2026-10-13',
      snapshot: { admissionNo: '412', name: 'Aarav Sharma', fatherName: 'Rajesh', gender: 'MALE', classKey: '7', section: 'A', dob: '2014-03-14' },
    }); // prettier-ignore
    expect(html).toContain('son of');
    expect(html).toContain('14 Mar 2014');
    expect(html).toContain('13 Oct 2026');
    expect(html).toContain('Class <b>7th-A</b>');
  });
});