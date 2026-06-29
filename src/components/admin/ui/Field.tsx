import type {
  ComponentPropsWithoutRef,
  ReactNode,
} from "react";

/**
 * Field + Input/Textarea/Select — the one form-control set for the back office.
 *
 * Replaces the copy-pasted `inputCls`/`labelCls` strings scattered across
 * dozens of admin files with a single token-driven look (consistent border,
 * surface, focus ring, label + help text). Server-component friendly.
 */

const CONTROL =
  "admin-focus w-full rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] outline-none transition focus:border-[var(--admin-accent)]";

const LABEL =
  "mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]";

/** Label + help text wrapper around any control (input, custom picker, etc.). */
export function Field({
  label,
  help,
  htmlFor,
  required,
  error,
  children,
  className = "",
}: {
  label?: ReactNode;
  help?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label ? (
        <label className={LABEL} htmlFor={htmlFor}>
          {label}
          {required ? (
            <span className="ml-0.5 text-[var(--admin-orange)]">*</span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1 text-xs text-[var(--admin-danger)]">{error}</p>
      ) : help ? (
        <p className="mt-1 text-xs text-[var(--admin-text-faint)]">{help}</p>
      ) : null}
    </div>
  );
}

export function Input({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"input">) {
  return <input className={`${CONTROL} ${className}`} {...props} />;
}

export function Textarea({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"textarea">) {
  return (
    <textarea className={`${CONTROL} min-h-[80px] resize-y ${className}`} {...props} />
  );
}

export function Select({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"select">) {
  return (
    <select className={`${CONTROL} ${className}`} {...props}>
      {children}
    </select>
  );
}

/** Exported class strings for places that can't use the components yet. */
export const controlClassName = CONTROL;
export const labelClassName = LABEL;
