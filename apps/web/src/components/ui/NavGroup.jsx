import { NavItem } from "./NavItem";

/**
 * A sidebar category that opens and closes. The button says whether it is open (aria-expanded),
 * the links inside are only in the page while it is open.
 */
export function NavGroup({ id, label, items, open, onToggle, onNavigate }) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`nav-group-${id}`}
        onClick={onToggle}
        className="flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-xs font-semibold uppercase tracking-wider text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <span>{label}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="m6 9 6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          id={`nav-group-${id}`}
          className="mt-1 flex flex-col gap-1 border-l border-white/15 pl-1 ml-4"
        >
          {items.map((i) => (
            <NavItem
              key={i.key}
              to={i.path}
              label={i.label}
              icon={i.key}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
