import { NavLink } from "react-router-dom";
import { NavIcon } from "../../layout/NavIcon";

/**
 * One sidebar link. `rail` = the narrow sidebar: only the icon shows until the sidebar is
 * hovered (the parent has the `group` class), then the label fades in. The label stays in the
 * page for screen readers either way.
 */
export function NavItem({ to, label, icon, soon, rail = false, onNavigate }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onNavigate}
      title={rail ? label : undefined}
      className={({ isActive }) =>
        `flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
          isActive
            ? "bg-white/15 font-medium text-white"
            : "text-white/75 hover:bg-white/10 hover:text-white"
        }`
      }
    >
      <NavIcon name={icon} />
      <span
        className={`flex flex-1 items-center justify-between whitespace-nowrap ${
          rail ? "opacity-0 transition-opacity group-hover:opacity-100" : ""
        }`}
      >
        <span>{label}</span>
        {soon && (
          <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            Soon
          </span>
        )}
      </span>
    </NavLink>
  );
}
