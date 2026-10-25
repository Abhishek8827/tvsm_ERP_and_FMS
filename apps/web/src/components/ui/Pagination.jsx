import { Button } from "./Button";
/** Server-side pagination control (rule 17). The parent owns state and passes it to the API. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 25, 50],
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted"
    >
      <p>
        Showing {from} to {to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <label className="flex items-center gap-1">
            <span className="sr-only">Rows per page</span>
            <select
              className="min-h-9 rounded-lg border border-line bg-surface px-2 text-ink"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizes.map((s) => (
                <option key={s} value={s}>
                  {s} per page
                </option>
              ))}
            </select>
          </label>
        )}
        <span>
          Page {page} of {pages}
        </span>
        <Button
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
