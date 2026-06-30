import { DENOM_FIELDS } from "@/lib/registers/cash";

/**
 * A compact denomination-count grid for blind drawer counts. Server-component
 * friendly: emits one number input per denomination, named by its key so
 * parseDenoms() on the server can read them straight off FormData.
 */
export function DenomFields() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {DENOM_FIELDS.map((d) => (
        <label key={d.key} className="flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1.5">
          <span className="w-12 shrink-0 text-xs font-semibold text-white/60">{d.label}</span>
          <input
            type="number"
            name={d.key}
            min={0}
            defaultValue={0}
            className="admin-focus w-full rounded bg-transparent px-1 py-0.5 text-right text-sm text-white outline-none"
          />
        </label>
      ))}
    </div>
  );
}
