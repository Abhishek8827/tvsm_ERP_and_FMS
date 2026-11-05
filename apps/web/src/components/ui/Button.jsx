import { forwardRef } from "react";
const styles = {
  primary:
    "bg-linear-to-b from-brand to-brand-dark text-white shadow-glow hover:brightness-110 disabled:from-brand/50 disabled:to-brand/50 disabled:shadow-none",
  secondary:
    "bg-surface/80 text-ink border border-line shadow-sm backdrop-blur hover:bg-surface hover:shadow-card disabled:text-ink-muted",
  danger:
    "bg-danger text-white shadow-sm hover:bg-danger/90 hover:shadow-card disabled:bg-danger/50",
  ghost: "bg-transparent text-brand hover:bg-brand/10 disabled:text-ink-muted",
};
export const Button = forwardRef(function Button(
  {
    variant = "primary",
    loading = false,
    disabled,
    className = "",
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
});
