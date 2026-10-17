import type { ReactNode } from 'react';

/** Layout wrapper for search + filters. Individual filters are Input/Select components. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      role="search"
      className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {children}
    </div>
  );
}
