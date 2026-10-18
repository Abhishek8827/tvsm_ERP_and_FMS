export function Card({ title, subtitle, actions, children }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
/** Headline number with a caption. `value` is always passed in from API data, never hardcoded. */
export function StatCard({ label, value, caption }) {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {caption && <p className="mt-1 text-xs text-ink-muted">{caption}</p>}
    </div>
  );
}
