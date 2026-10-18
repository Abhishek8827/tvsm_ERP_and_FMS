import { forwardRef, useId } from 'react';
function FieldShell({ label, error, hint, id, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
const control =
  'min-h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-ink-muted disabled:bg-app';
/** Field-level error support (rule 15): the server's `fields` map is passed straight to `error`. */
export const Input = forwardRef(function Input(
  { label, error, hint, id, className = '', ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} error={error} hint={hint} id={fieldId}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={`${control} ${error ? 'border-danger' : 'border-line'} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
});
export const Select = forwardRef(function Select(
  { label, error, id, options, className = '', ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} error={error} id={fieldId}>
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={`${control} ${error ? 'border-danger' : 'border-line'} ${className}`}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});
