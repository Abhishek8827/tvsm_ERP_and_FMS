/** Layout wrapper for search + filters. Individual filters are Input/Select components. */
export function FilterBar({ children }) {
  return (
    <div
      role="search"
      className="grid gap-3 glass rounded-card p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4"
    >
      {children}
    </div>
  );
}
