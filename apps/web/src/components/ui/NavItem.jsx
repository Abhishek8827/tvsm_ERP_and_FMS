import { NavLink } from "react-router-dom";
import { NavIcon } from "../../layout/NavIcon";

/**
 * One sidebar link. The open page is a white pill with blue text, so it reads as part of the
 * page it opens. `indent` = a link inside a category.
 */
export function NavItem({ to, label, icon, indent = false, onNavigate }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
          indent ? "ml-3" : ""
        } ${
          isActive
            ? "bg-white font-semibold text-brand-dark shadow-sm"
            : "text-white/80 hover:bg-white/10 hover:text-white"
        }`
      }
    >
      <NavIcon name={icon} />
      <span className="whitespace-nowrap">{label}</span>
    </NavLink>
  );
}
