import { Link } from "react-router-dom";
import { navForRole } from "@erp/shared";
import { useAuth } from "../auth/AuthContext";
import { NavIcon } from "../layout/NavIcon";

/**
 * Square shortcut buttons for every page this role may open (the blank right side of the
 * Dashboard). They are the same links as the sidebar, so nothing here can open a page the role
 * has no right to.
 */
export function QuickTiles() {
  const { role } = useAuth();
  // Collect Fee is the favourite: it is always the first tile.
  const items = navForRole(role)
    .filter((i) => i.path !== "/")
    .sort(
      (a, b) =>
        Number(b.key === "collect-fee") - Number(a.key === "collect-fee"),
    );
  if (items.length === 0) return null;
  return (
    <section aria-label="Quick access">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Quick access
      </h2>
      <div className="grid grid-cols-3 gap-3">
        {items.map((i) => (
          <Link
            key={i.key}
            to={i.path}
            className={`group flex aspect-square flex-col items-center justify-center gap-2 glass rounded-card p-2 text-center shadow-card transition hover:-translate-y-0.5 hover:shadow-lift ${
              i.key === "collect-fee"
                ? "col-span-3 !aspect-auto min-h-24 ring-2 ring-brand/40"
                : ""
            }`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors group-hover:bg-brand group-hover:text-white">
              <NavIcon name={i.key} size={24} />
            </span>
            <span className="text-xs font-medium leading-tight text-ink">
              {i.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
