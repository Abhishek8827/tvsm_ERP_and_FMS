export function Card({ title, subtitle, actions, center = false, children }) {
  return (
    <section className="glass rounded-card p-5 shadow-card">
      {(title || actions) && (
        <header
          className={`mb-4 flex items-start gap-3 ${center ? "justify-center text-center" : "justify-between"}`}
        >
          <div>
            {title && (
              <h2 className="text-base font-semibold text-ink">{title}</h2>
            )}
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
    <div className="glass glass-lift rounded-card p-5 shadow-card hover:shadow-lift">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {caption && <p className="mt-1 text-xs text-ink-muted">{caption}</p>}
    </div>
  );
}
