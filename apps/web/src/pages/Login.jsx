import { useId, useState } from "react";
import { SOFTWARE } from "@erp/shared";
import { useAuth } from "../auth/AuthContext";

const BG =
  "radial-gradient(ellipse at 8% 18%, rgba(59,130,246,0.24), transparent 32%), radial-gradient(ellipse at 88% 78%, rgba(139,92,246,0.20), transparent 34%), radial-gradient(ellipse at 72% 8%, rgba(34,211,238,0.15), transparent 28%), linear-gradient(130deg, #E5EEFF 0%, #F4F1FF 52%, #E6F7FF 100%)";

/** One labelled field with its own error line (the line keeps its height, so the card never jumps). */
function Field({ label, error, trailing, ...input }) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-[#172554]"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={`min-h-12 w-full rounded-xl border bg-white px-3.5 text-base text-ink outline-none transition-shadow focus:border-[#2457C5] focus:ring-4 focus:ring-[#2457C5]/10 ${
            error ? "border-danger" : "border-[#C7D2E2] hover:border-[#8EA5C5]"
          } ${trailing ? "pr-16" : ""}`}
          {...input}
        />
        {trailing}
      </div>
      <p id={`${id}-err`} className="mt-1 min-h-5 text-sm text-danger">
        {error || ""}
      </p>
    </div>
  );
}

/**
 * Login screen: school name, crest and a sign-in card. Field errors and the server / Firebase
 * message are shown in plain words. Built with Tailwind like every other screen.
 */
export function Login() {
  const { signIn, notice } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const next = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    setErrors(next);
    setFormError("");
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
    <main
      className="flex min-h-full items-center justify-center overflow-hidden px-4 py-8 sm:px-8 md:py-12 lg:px-14"
      style={{ backgroundColor: "#EDF3FF", backgroundImage: BG }}
    >
      <div className="grid w-full max-w-[1240px] items-center gap-x-10 gap-y-6 [grid-template-areas:'school'_'login'_'emblem'] md:grid-cols-[minmax(220px,0.8fr)_minmax(400px,1.2fr)] md:gap-y-8 md:[grid-template-areas:'school_school'_'emblem_login'] lg:gap-x-20">
        <div className="text-center [grid-area:school]">
          <h1 className="text-balance text-xl font-extrabold leading-tight tracking-tight text-[#19345F] sm:text-2xl md:text-4xl">
            TH. VIRENDRA SINGH MEMORIAL HIGHER SECONDARY SCHOOL
          </h1>
          <p className="mt-3 text-base text-[#4E6387] sm:text-2xl">NEPANAGAR</p>
        </div>

        <div className="flex items-center justify-center [grid-area:emblem]">
          <img
            src="/logo.jpg"
            alt="Th. Virendra Singh Memorial School emblem"
            className="h-28 w-28 object-contain mix-blend-multiply drop-shadow-[0_16px_28px_rgba(35,65,120,0.12)] sm:h-36 sm:w-36 md:h-56 md:w-56 lg:h-72 lg:w-72"
          />
        </div>

        <div className="mx-auto flex w-full max-w-[540px] flex-col gap-4 [grid-area:login]">
          <div className="text-center">
            <span className="inline-flex items-center rounded-full border border-white/90 bg-white/60 px-4 py-1.5 text-[0.82rem] font-bold uppercase tracking-[0.08em] text-[#244E9A]">
              School ERP System
            </span>
          </div>

          <form
            onSubmit={onSubmit}
            noValidate
            className="flex flex-col gap-5 rounded-3xl border border-white/95 bg-white/95 p-6 shadow-[0_28px_80px_rgba(45,67,130,0.16),0_6px_20px_rgba(45,67,130,0.06)] backdrop-blur sm:p-8 md:p-10"
          >
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-[#172554]">
                Sign in
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Use your school account to continue.
              </p>
            </div>

            {notice && (
              <p
                role="status"
                className="rounded-xl bg-info/10 px-3 py-2 text-sm text-info"
              >
                {notice}
              </p>
            )}

            <div className="flex flex-col gap-1">
              <Field
                label="Email"
                type="email"
                name="email"
                autoComplete="username"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                error={errors.email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email)
                    setErrors((c) => ({ ...c, email: undefined }));
                  if (formError) setFormError("");
                }}
              />
              <Field
                label="Password"
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                value={password}
                error={errors.password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password)
                    setErrors((c) => ({ ...c, password: undefined }));
                  if (formError) setFormError("");
                }}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-1 my-auto h-9 rounded-lg px-3 text-xs font-bold text-[#2457C5] hover:bg-[#2457C5]/10"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                }
              />
            </div>

            {formError && (
              <p
                role="alert"
                className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              aria-busy={busy || undefined}
              className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#2457C5] via-[#3568D4] to-[#5B5BD6] text-base font-bold text-white shadow-[0_10px_24px_rgba(36,87,197,0.24)] transition hover:shadow-[0_12px_28px_rgba(36,87,197,0.3)] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {busy && (
                <span
                  aria-hidden
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                />
              )}
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="px-2 text-center text-xs leading-relaxed text-ink-muted">
            © {SOFTWARE.year} · {SOFTWARE.madeBy} · All rights reserved.
            <br />
            Made with ❤️ for schools.
          </p>
        </div>
      </div>
    </main>
  );
}
