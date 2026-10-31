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
        className="mb-1 block text-sm font-medium text-white/90"
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
      className="relative flex min-h-dvh flex-col overflow-x-hidden lg:h-dvh lg:min-h-0 lg:items-center lg:justify-center lg:overflow-hidden lg:px-14 lg:py-5"
      style={{ backgroundColor: "#EDF3FF", backgroundImage: BG }}
    >
      {/* Phone / tablet: picture on top, the sign-in card is a sheet with round top corners.
          Desktop (lg): one big card, picture left, sign-in right. */}
      <div className="flex w-full flex-1 flex-col lg:grid lg:max-w-310 lg:flex-none lg:grid-cols-[minmax(0,1.7fr)_minmax(350px,0.85fr)] lg:overflow-hidden lg:rounded-4xl lg:border lg:border-white/80 lg:bg-white/95 lg:p-5 lg:shadow-[0_32px_90px_rgba(35,65,120,0.18)] lg:backdrop-blur lg:h-[calc(100dvh-40px)] lg:max-h-155">
        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:justify-between lg:rounded-[1.4rem]">
          <div className="relative z-10 flex flex-col items-center gap-2 px-5 pt-5 text-center lg:flex-row lg:gap-5 lg:px-10 lg:pt-7 lg:text-left">
            <img
              src="/logo.jpg"
              alt="Th. Virendra Singh Memorial School emblem"
              className="h-16 w-16 shrink-0 object-contain mix-blend-multiply drop-shadow-[0_12px_24px_rgba(35,65,120,0.12)] sm:h-20 sm:w-20 lg:h-24 lg:w-24"
            />
            <div>
              <h1 className="text-balance text-base font-extrabold leading-[1.12] tracking-tight text-[#19345F] sm:text-lg lg:text-[1.25rem] xl:text-[1.5rem]">
                TH. VIRENDRA SINGH MEMORIAL
                <br />
                SECONDARY SCHOOL
              </h1>
              <p className="mt-1 text-[11px] font-bold tracking-[0.32em] text-[#4E6387] lg:mt-2 lg:text-xs">
                NEPANAGAR
              </p>
            </div>
          </div>

          <div className="relative min-h-32 flex-1 px-4 pb-8 lg:absolute lg:inset-x-0 lg:bottom-16 lg:top-43.75 lg:px-0 lg:pb-0">
            <img
              src="/login_Illustration.png"
              alt="School administration illustration"
              className="h-full w-full object-contain object-center"
            />
          </div>
          <span className="absolute bottom-5 left-1/2 z-20 hidden -translate-x-1/2 rounded-full border border-[#2457C5]/10 bg-white px-6 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[#2457C5] shadow-sm lg:block">
            School ERP System
          </span>
        </section>

        <div className="relative z-10 -mt-7 flex flex-col justify-center rounded-t-4xl bg-linear-to-br from-[#2457C5] via-[#3568D4] to-[#1F3A8A] px-6 pb-6 pt-7 text-white shadow-[0_-12px_40px_rgba(36,87,197,0.25)] sm:px-12 lg:mt-0 lg:h-full lg:min-h-0 lg:rounded-3xl lg:py-8 lg:shadow-[0_24px_60px_rgba(36,87,197,0.28)]">
          <form
            onSubmit={onSubmit}
            noValidate
            className="mx-auto flex w-full max-w-md flex-col gap-3 lg:max-w-none lg:gap-4"
          >
            <div className="text-center">
              <img
                src="/ak.jpg"
                alt=""
                className="m-auto hidden h-17 w-17 object-contain mix-blend-color-burn shadow-amber-100 sm:block"
              />
              <h2 className="text-2xl font-extrabold tracking-tight text-white sm:mt-3.5 sm:text-3xl">
                Sign in
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-white/75 lg:mt-2">
                Use your school account to continue.
              </p>
            </div>

            {notice && (
              <p
                role="status"
                className="rounded-xl bg-white/15 px-3 py-2 text-sm text-white"
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
              className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-white text-base font-bold text-[#2457C5] shadow-[0_10px_24px_rgba(20,46,110,0.24)] transition hover:-translate-y-0.5 hover:bg-[#EFF5FF] disabled:cursor-not-allowed disabled:opacity-70"
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
          <p className="mt-4 px-2 text-center text-[11px] leading-relaxed text-white/70 lg:hidden">
            © {SOFTWARE.year} · {SOFTWARE.madeBy} · All rights reserved.
          </p>
        </div>
      </div>
      <p className="absolute bottom-2 left-0 right-0 hidden px-2 text-center text-xs leading-relaxed text-[#4E6387] lg:block">
        © {SOFTWARE.year} · {SOFTWARE.madeBy} · All rights reserved. Made with
        ❤️ for schools.
      </p>
    </main>
  );
}
