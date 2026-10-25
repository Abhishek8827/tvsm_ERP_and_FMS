import { SCHOOL, SOFTWARE } from "@erp/shared";

/** Shown under every page: who made the software and the copyright line. */
export function Footer() {
  return (
    <footer className="border-t border-line bg-surface px-4 py-3 text-center text-xs text-ink-muted md:px-8">
      <p>
        {SOFTWARE.name} · Designed and developed by{" "}
        <span className="font-medium text-ink">{SOFTWARE.madeBy}</span> (
        {SOFTWARE.phone}) · {SOFTWARE.email}
      </p>
      <p className="mt-0.5">
        © {SOFTWARE.year} {SCHOOL.name}, Nepanagar. All rights reserved.
      </p>
    </footer>
  );
}
