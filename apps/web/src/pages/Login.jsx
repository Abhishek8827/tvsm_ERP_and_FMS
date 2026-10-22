import { useState } from 'react';
import { SCHOOL, SOFTWARE } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { Button, Input } from '../components/ui';

/**
 * Login screen. The dark brand panel is the one place (besides confirm dialogs) where the dark
 * style is used, as specified. Field errors and the server/Firebase message are shown in plain words.
 */
export function Login() {
  const { signIn, notice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const next = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setFormError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#0c0b0a] p-12 text-white lg:flex">
        <Doodles />
        <div className="relative flex items-center gap-4">
          <img
            src="/logo.jpg"
            alt="TVSM School logo"
            className="h-20 w-auto rounded-xl bg-white p-2"
          />
          <div>
            <p className="text-lg font-semibold leading-tight">{SCHOOL.name}</p>
            <p className="text-sm text-white/60">Nepanagar, Madhya Pradesh</p>
          </div>
        </div>
        <div className="relative">
          <p className="mb-3 inline-block rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-widest text-white/70">
            School ERP · Fee Management
          </p>
          <h1 className="text-4xl font-semibold leading-tight">
            Fees, receipts and accounts, in one place.
          </h1>
          <p className="mt-4 max-w-md text-white/70">
            Collect fees, issue receipts, approve expenses and keep the school's accounts. Every
            receipt, approval and entry is recorded and can be traced.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2 text-xs text-white/80">
            {['Fee collection', 'Receipts', 'Expenses', 'Petty cash', 'Bank & cash'].map((t) => (
              <li key={t} className="rounded-full bg-white/10 px-3 py-1">
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-sm text-white/70">
          <p>
            Designed and built by{' '}
            <span className="font-semibold text-white">{SOFTWARE.madeBy}</span>
          </p>
          <p className="text-white/50">
            {SOFTWARE.phone} · {SOFTWARE.email}
          </p>
          <p className="mt-2 text-xs text-white/40">
            Used by {SCHOOL.name}, Nepanagar. © {SOFTWARE.year}
          </p>
        </div>
      </aside>

      <main className="flex flex-col items-center justify-center gap-6 p-6">
        <div className="flex items-center gap-3 lg:hidden">
          <img src="/logo.jpg" alt="TVSM School logo" className="h-14 w-auto" />
          <p className="font-semibold">TVSM School ERP</p>
        </div>
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex w-full max-w-sm flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-sm"
        >
          <div>
            <h2 className="text-2xl font-semibold">Sign in</h2>
            <p className="text-sm text-ink-muted">
              Welcome back. Use the account given to you by the Admin.
            </p>
          </div>
          {notice && (
            <p
              role="status"
              className="rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-info"
            >
              {notice}
            </p>
          )}
          <Input
            label="Email"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            error={errors.email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            error={errors.password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          <Button type="submit" loading={busy}>
            Sign in
          </Button>
        </form>
        <p className="text-center text-xs text-ink-muted">
          Made by {SOFTWARE.madeBy} ({SOFTWARE.phone}) · © {SOFTWARE.year} {SCHOOL.name}
        </p>
      </main>
    </div>
  );
}

/** Hand-drawn style school doodles (book, pencil, cap, rupee coin, star) behind the brand text. */
function Doodles() {
  const stroke = {
    fill: 'none',
    stroke: 'white',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.12]"
      viewBox="0 0 600 800"
      preserveAspectRatio="xMidYMid slice"
    >
      <g {...stroke} transform="translate(420 70) rotate(12)">
        <path d="M0 20 Q40 0 80 20 V90 Q40 70 0 90Z" />
        <path d="M80 20 Q120 0 160 20 V90 Q120 70 80 90Z" />
      </g>
      <g {...stroke} transform="translate(60 560) rotate(-35)">
        <rect x="0" y="0" width="150" height="22" rx="3" />
        <path d="M150 0 L185 11 L150 22Z" />
        <path d="M24 0 V22" />
      </g>
      <g {...stroke} transform="translate(440 330)">
        <path d="M0 40 L60 10 L120 40 L60 70Z" />
        <path d="M25 52 V85 Q60 105 95 85 V52" />
        <path d="M120 40 V90" />
      </g>
      <g {...stroke} transform="translate(80 120)">
        <circle cx="45" cy="45" r="45" />
        <circle cx="45" cy="45" r="32" strokeDasharray="4 6" />
        <path d="M30 28 H62 M30 42 H62 M36 28 C70 28 70 56 36 56 L62 72" />
      </g>
      <g {...stroke} transform="translate(300 600)">
        <path d="M30 0 L38 22 L62 24 L44 40 L50 64 L30 51 L10 64 L16 40 L-2 24 L22 22Z" />
      </g>
      <g {...stroke} transform="translate(250 270)">
        <path d="M0 0 C20 -25 40 25 60 0 S100 25 120 0" />
      </g>
      <g {...stroke} transform="translate(470 560)">
        <rect x="0" y="0" width="90" height="110" rx="6" />
        <path d="M15 25 H75 M15 50 H75 M15 75 H50" />
      </g>
    </svg>
  );
}
