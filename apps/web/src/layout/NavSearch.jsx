import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Search box in the top bar: type a page name ("receipt", "bank"), press Enter or click to open it.
 * It only lists pages this role may open. Arrow keys move, Escape clears.
 */
export function NavSearch({ items, className = "" }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const input = useRef(null);
  const term = q.trim().toLowerCase();
  const hits = useMemo(
    () =>
      term
        ? items.filter((i) => i.label.toLowerCase().includes(term)).slice(0, 6)
        : [],
    [items, term],
  );
  function go(item) {
    setQ("");
    navigate(item.path);
    input.current?.blur();
  }
  function onKeyDown(e) {
    if (e.key === "Escape") setQ("");
    else if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  }
  return (
    <div className={`relative ${className}`} role="search">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/70"
      >
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
        <path
          d="m16 16 4 4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <input
        ref={input}
        type="search"
        aria-label="Search pages"
        placeholder="Search pages…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        className="h-10 w-full rounded-xl border border-white/20 bg-white/10 pl-9 pr-3 text-sm text-white placeholder:text-white/60 focus:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50"
      />
      {term && (
        <ul
          role="listbox"
          aria-label="Pages"
          className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-line bg-surface py-1 text-sm text-ink shadow-lg"
        >
          {hits.length === 0 && (
            <li className="px-3 py-2 text-ink-muted">No page found</li>
          )}
          {hits.map((i, n) => (
            <li key={i.key} role="option" aria-selected={n === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(i)}
                className={`block w-full px-3 py-2 text-left ${n === active ? "bg-app font-medium" : "hover:bg-app"}`}
              >
                {i.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
