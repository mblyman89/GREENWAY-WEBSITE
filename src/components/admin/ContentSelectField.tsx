"use client";

/**
 * ContentSelectField — the editor control for a "select" content block.
 *
 * Stores a single short value chosen from a fixed, curated option set (defined
 * in content-select-core.ts, keyed by block_key). Staff see a friendly
 * dropdown; no raw CSS/values to type, so a choice can never break the layout.
 *
 * If the block key isn't a known select block (shouldn't happen), it falls
 * back to a plain text input so the editor never renders empty.
 */
import { resolveSelectSpec, selectDefaultValue } from "@/lib/cms/content-select-core";

export function ContentSelectField({
  blockKey,
  value,
  onChange,
}: {
  blockKey: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const spec = resolveSelectSpec(blockKey);

  if (!spec) {
    // Defensive fallback — treat as plain text.
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="admin-focus w-full rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none transition focus:border-[var(--admin-accent)]"
      />
    );
  }

  // Blank/unknown stored value shows the default (first) option as selected.
  const current = spec.options.some((o) => o.value === value)
    ? value
    : selectDefaultValue(blockKey);

  return (
    <div className="space-y-2">
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="admin-focus w-full rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none transition focus:border-[var(--admin-accent)]"
      >
        {spec.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {spec.note ? (
        <p className="text-[0.72rem] text-[var(--admin-text-muted)]">{spec.note}</p>
      ) : null}
    </div>
  );
}
