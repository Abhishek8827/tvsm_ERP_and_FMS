import { SOFTWARE } from "@erp/shared";

/** Shown under every page: who made the software and the copyright line. */
export function Footer() {
  return (
    <footer className="border-t border-line bg-surface px-4 py-3 text-center text-xs text-ink-muted md:px-8">
      <p>
        Latest Version: {SOFTWARE.version} © {SOFTWARE.year} · Developed by{" "}
        {SOFTWARE.madeBy} · All rights reserved. Contact:{SOFTWARE.phone}
      </p>
    </footer>
  );
}
