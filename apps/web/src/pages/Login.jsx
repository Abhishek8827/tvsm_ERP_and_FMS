import { useState } from 'react';
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
    <div className="grid min-h-full lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-[#0c0b0a] p-12 text-white lg:flex">
        <img
          src="/logo.jpg"
          alt="TVSM School logo"
          className="h-28 w-auto self-start rounded-xl bg-white p-2"
        />
        <div>
          <h1 className="text-4xl font-semibold leading-tight">
            Fees, receipts and accounts, in one place.
          </h1>
          <p className="mt-4 max-w-md text-white/70">
            Every receipt, approval and certificate is recorded and can be traced.
          </p>
        </div>
        <p className="text-xs text-white/40">Thakur Virendra Singh Memorial School</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <form onSubmit={onSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Sign in</h2>
            <p className="text-sm text-ink-muted">Use the account given to you by the Admin.</p>
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
      </main>
    </div>
  );
}
