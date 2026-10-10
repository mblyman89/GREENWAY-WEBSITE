import Link from "next/link";
import {
  COLUMN_GROUPS,
  COLUMN_PRESETS,
  INVENTORY_TABLE_COLUMNS,
  ALWAYS_VISIBLE,
  COLS_PARAM,
  VIEW_PARAM,
  carryFields,
  presetHref,
  tableHref,
  exportFieldsFor,
  type ColumnView,
} from "@/lib/inventory/inventory-table-core";
import type { RawParams } from "@/lib/inventory/inventory-url-core";

/**
 * R38 S2/S4 — the table toolbar: column VIEWS (presets), a custom column
 * picker, row density, and the intelligent EXPORT.
 *
 * Pattern (Pencil & Paper enterprise data-table guidance; AG Grid / MUI
 * column-chooser convention): named views for the common jobs, a picker for
 * everything else, and always a one-click reset. Every control is a link or
 * a GET form, so the URL stays the single source of truth — a chosen view
 * survives paging, filtering, sorting and can be bookmarked.
 *
 * The export panel answers the three questions every enterprise export asks:
 * WHICH ROWS (this filtered view across all pages / just this page / every
 * lot), WHICH COLUMNS (what is on screen / every field), and WHAT FORMAT
 * (Excel with a summary + data-dictionary sheet, or CSV).
 */
export function InventoryTableToolbar({
  raw,
  view,
  density,
  matchedCount,
  pageCount,
  allCount,
}: {
  raw: RawParams;
  view: ColumnView;
  density: "comfortable" | "compact";
  matchedCount: number;
  pageCount: number;
  allCount: number;
}) {
  const visible = new Set(view.ids);
  const visibleFields = exportFieldsFor(view.ids).length;
  const allFields = exportFieldsFor(INVENTORY_TABLE_COLUMNS.map((c) => c.id)).length;
  const chip = "rounded-full px-3 py-1 text-xs font-semibold transition";
  const on = `${chip} bg-[var(--admin-accent)] text-black`;
  const off = `${chip} bg-white/5 text-[var(--admin-text-muted)] hover:bg-white/10`;
  const panel =
    "absolute left-0 z-30 mt-2 w-[min(92vw,44rem)] rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 shadow-xl";
  const summary =
    "admin-focus cursor-pointer list-none rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]";

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="inventory-table-toolbar">
      <span className="text-xs text-[var(--admin-text-faint)]">View</span>
      {COLUMN_PRESETS.map((p) => (
        <Link key={p.key} href={presetHref(raw, p.key)} className={view.preset === p.key ? on : off} data-testid={`inventory-view-${p.key}`}>
          {p.label}
        </Link>
      ))}
      {view.preset === "custom" && <span className={on}>Custom ({view.ids.length})</span>}

      {/* Custom column picker */}
      <details className="relative" data-testid="inventory-columns-picker">
        <summary className={summary}>Columns ({view.ids.length}/{INVENTORY_TABLE_COLUMNS.length})</summary>
        <div className={panel}>
          <form method="get" action="/admin/inventory">
            {carryFields(raw, [COLS_PARAM, VIEW_PARAM]).map(([k, v], i) => (
              <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
            ))}
            <div className="grid gap-4 sm:grid-cols-2">
              {COLUMN_GROUPS.map((g) => (
                <fieldset key={g}>
                  <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">{g}</legend>
                  {INVENTORY_TABLE_COLUMNS.filter((c) => c.group === g).map((c) => (
                    <label key={c.id} className="flex items-center gap-2 py-0.5 text-xs text-[var(--admin-text-muted)]">
                      <input
                        type="checkbox"
                        name={COLS_PARAM}
                        value={c.id}
                        defaultChecked={visible.has(c.id)}
                        disabled={c.id === ALWAYS_VISIBLE}
                      />
                      {c.label}
                      {c.id === ALWAYS_VISIBLE && <span className="text-[var(--admin-text-faint)]">(always shown)</span>}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <input type="hidden" name={COLS_PARAM} value={ALWAYS_VISIBLE} />
            <div className="mt-4 flex items-center gap-3">
              <button type="submit" className="admin-focus rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-black">
                Apply columns
              </button>
              <Link href={presetHref(raw, "all")} className="text-xs text-[var(--admin-accent)] hover:underline" data-testid="inventory-columns-reset">
                Reset to every column
              </Link>
            </div>
          </form>
        </div>
      </details>

      {/* Density */}
      <Link
        href={tableHref(raw, { density: density === "compact" ? null : "compact" })}
        className={summary}
        data-testid="inventory-density"
        title="Row height"
      >
        {density === "compact" ? "Comfortable rows" : "Compact rows"}
      </Link>

      {/* Export */}
      <details className="relative" data-testid="inventory-export">
        <summary className={summary}>Export…</summary>
        <div className={panel}>
          <form method="get" action="/admin/inventory/export" className="space-y-4 text-xs text-[var(--admin-text-muted)]">
            {carryFields(raw, ["scope", "columns", "format"]).map(([k, v], i) => (
              <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
            ))}
            <fieldset>
              <legend className="mb-1 font-semibold text-[var(--admin-text)]">Which lots</legend>
              <label className="flex items-center gap-2 py-0.5">
                <input type="radio" name="scope" value="view" defaultChecked /> This filtered view, every page ({matchedCount} lots)
              </label>
              <label className="flex items-center gap-2 py-0.5">
                <input type="radio" name="scope" value="page" /> Only the rows on this page ({pageCount})
              </label>
              <label className="flex items-center gap-2 py-0.5">
                <input type="radio" name="scope" value="all" /> Every lot, ignoring filters and tabs ({allCount})
              </label>
            </fieldset>
            <fieldset>
              <legend className="mb-1 font-semibold text-[var(--admin-text)]">Which columns</legend>
              <label className="flex items-center gap-2 py-0.5">
                <input type="radio" name="columns" value="visible" defaultChecked /> The columns on screen ({visibleFields} fields)
              </label>
              <label className="flex items-center gap-2 py-0.5">
                <input type="radio" name="columns" value="all" /> Every field we hold ({allFields} fields)
              </label>
            </fieldset>
            <fieldset>
              <legend className="mb-1 font-semibold text-[var(--admin-text)]">Format</legend>
              <label className="flex items-center gap-2 py-0.5">
                <input type="radio" name="format" value="xlsx" defaultChecked /> Excel (.xlsx), with Summary and Columns sheets
              </label>
              <label className="flex items-center gap-2 py-0.5">
                <input type="radio" name="format" value="csv" /> CSV (one table, opens anywhere)
              </label>
            </fieldset>
            <p className="text-[11px] text-[var(--admin-text-faint)]">
              Stacked cells are split into their own columns (vendor and brand separately, for example), numbers stay
              numbers and money stays money. Unknown values are left blank, never written as zero. The export follows your
              current sort, and it is recorded in the audit log.
            </p>
            <button type="submit" className="admin-focus rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-3 py-1.5 font-semibold text-black" data-testid="inventory-export-submit">
              Download
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}

export default InventoryTableToolbar;
