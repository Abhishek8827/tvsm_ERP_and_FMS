import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";
import { NAV_GROUPS, navForRole } from "@erp/shared";
import { useAuth } from "../auth/AuthContext";

const BASE_FOR_RECEIPTS = { admin: "/fees-receipts", cashier: "/receipts" };

/**
 * The trail for a path: Home > category > page > sub page. Built from the SAME navigation list as
 * the sidebar (so labels can never differ from the menu). Returns [] on the Dashboard.
 * Each crumb is { label, to? }; the last one (the open page) and category names have no link.
 */
export function crumbsFor(pathname, role) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return [];
  const nav = navForRole(role);
  const home = { label: "Home", to: "/" };
  const page = (path) => nav.find((i) => i.path === path);
  const withGroup = (item, last) => {
    const g = NAV_GROUPS.find((x) => x.key === item.group);
    // A category with one link for this role is shown as that plain link, so no category crumb.
    const shown = g && nav.filter((i) => i.group === g.key).length > 1;
    return [
      home,
      ...(shown ? [{ label: g.label }] : []),
      { label: item.label, to: last ? undefined : item.path },
    ];
  };
  const [first, second, third] = parts;

  // Sub pages that hang under a menu page.
  if (first === "receipts" && second) {
    const base = page(BASE_FOR_RECEIPTS[role] ?? "/receipts");
    if (base) return [...withGroup(base, false), { label: "Receipt" }];
  }
  if (first === "fees-database" && second === "students") {
    const base = page("/fees-database");
    if (base)
      return [...withGroup(base, false), { label: "Student Fee Details" }];
  }
  if (first === "students" && second) {
    const base = page("/students");
    if (!base) return [home];
    if (second === "new")
      return [...withGroup(base, false), { label: "Add student" }];
    const profile = { label: "Student profile", to: `/students/${second}` };
    return third === "edit"
      ? [...withGroup(base, false), profile, { label: "Edit" }]
      : [...withGroup(base, false), { label: profile.label }];
  }
  if (first === "expenses" && second) {
    const base = page("/expenses");
    if (base) return [...withGroup(base, false), { label: "Voucher" }];
  }
  if (first === "data-import" && second) {
    const base = page("/data-import");
    const label = second === "students" ? "Import students" : "Import old fees";
    if (base) return [...withGroup(base, false), { label }];
  }
  const item = page(`/${first}`);
  return item ? withGroup(item, true) : [home];
}

/** Breadcrumb trail shown above every page except the Dashboard. */
export function Breadcrumbs() {
  const { pathname } = useLocation();
  const { role } = useAuth();
  const crumbs = crumbsFor(pathname, role);
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
        {crumbs.map((c, i) => (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && (
              <li aria-hidden="true" className="text-ink-muted/60">
                ›
              </li>
            )}
            <li>
              {c.to ? (
                <Link
                  to={c.to}
                  className="font-medium text-brand hover:underline"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  aria-current={i === crumbs.length - 1 ? "page" : undefined}
                  className={
                    i === crumbs.length - 1 ? "font-semibold text-ink" : ""
                  }
                >
                  {c.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
