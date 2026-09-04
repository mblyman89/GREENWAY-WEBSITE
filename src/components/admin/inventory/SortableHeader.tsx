import Link from "next/link";
import {
  sortHref,
  sortIndicator,
  sortActionLabel,
  type RawParams,
} from "@/lib/inventory/inventory-url-core";
import { columnSortDef } from "@/lib/inventory/inventory-sort-core";

/**
 * ────────────────────────────────────────────────────────────────────────────
 * SLICE 13 — a clickable column header.
 *
 * The owner asked to "sort the list by clicking the header of the column".
 * Each header is a LINK, not a button with a handler, so it works on a
 * server-rendered page, can be middle-clicked into a new tab, and shows its
 * destination in the status bar like any other link.
 *
 * THE ARROW ALWAYS REFLECTS REALITY. It is derived from the same URL the table
 * was sorted by, so it cannot drift out of step with the data underneath it —
 * a sorted-looking arrow over unsorted rows is worse than no arrow at all.
 *
 * A header whose column key is unknown renders as PLAIN TEXT rather than a
 * dead link. If a column is ever renamed and a call site is missed, the header
 * stops looking clickable instead of silently doing nothing when clicked.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function SortableHeader({
  columnKey,
  label,
  raw,
  align = "left",
  className = "",
}: {
  /** A key from INVENTORY_COLUMN_SORTS. */
  columnKey: string;
  /** Header text. Defaults to the column definition's label when omitted. */
  label?: string;
  /** The incoming query params, verbatim. */
  raw: RawParams;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const col = columnSortDef(columnKey);
  const alignCls =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const justify =
    align === "right"
      ? "justify-end"
      : align === "center"
        ? "justify-center"
        : "justify-start";

  if (!col) {
    // Unknown key: honest plain text, never a link that does nothing.
    return <th className={`px-4 py-3 ${alignCls} ${className}`}>{label ?? columnKey}</th>;
  }

  const dir = sortIndicator(raw, col);
  const text = label ?? col.label;

  return (
    <th
      className={`px-4 py-3 ${alignCls} ${className}`}
      // Announce the sort state to assistive tech, matching what the arrow says.
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
    >
      <Link
        href={sortHref(raw, col)}
        title={sortActionLabel(raw, col)}
        aria-label={sortActionLabel(raw, col)}
        className={`group inline-flex w-full items-center gap-1 ${justify} transition ${
          dir
            ? "text-[var(--admin-accent)]"
            : "text-[var(--admin-text-faint)] hover:text-[var(--admin-text)]"
        }`}
      >
        <span>{text}</span>
        <span
          aria-hidden="true"
          className={`text-[0.6rem] leading-none ${
            dir ? "opacity-100" : "opacity-0 transition group-hover:opacity-50"
          }`}
        >
          {/* Down arrow = descending. When unsorted, a faint arrow appears on
              hover to advertise that the header is clickable at all. */}
          {dir === "asc" ? "\u25b2" : "\u25bc"}
        </span>
      </Link>
    </th>
  );
}

export default SortableHeader;
