import { NavLink } from 'react-router-dom';

export function NavItem({
  to,
  label,
  soon,
  onNavigate,
}: {
  to: string;
  label: string;
  soon?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex min-h-10 items-center justify-between rounded-lg px-3 text-sm transition-colors ${
          isActive
            ? 'bg-white/15 font-medium text-white'
            : 'text-white/75 hover:bg-white/10 hover:text-white'
        }`
      }
    >
      <span>{label}</span>
      {soon && (
        <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          Soon
        </span>
      )}
    </NavLink>
  );
}
