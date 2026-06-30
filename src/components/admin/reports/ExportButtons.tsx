/**
 * src/components/admin/reports/ExportButtons.tsx  (Slice 47)
 *
 * A small pair of download links (CSV + XLSX) for a report section. Given a base
 * export href (which already carries the group/range params), it appends
 * &format=csv / &format=xlsx. Server-component friendly (plain anchors).
 */
import Link from "next/link";

/** Append a query param to an href that may or may not already have a query string. */
function withFormat(href: string, format: "csv" | "xlsx"): string {
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}format=${format}`;
}

export function ExportButtons({ baseHref, className = "" }: { baseHref: string; className?: string }) {
  return (
    <div className={`flex shrink-0 items-center gap-1.5 ${className}`}>
      <Link
        href={withFormat(baseHref, "csv")}
        className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-white/70 transition hover:border-white/25 hover:text-white"
        title="Download CSV"
      >
        ⬇ CSV
      </Link>
      <Link
        href={withFormat(baseHref, "xlsx")}
        className="rounded-lg border border-[#7ed957]/30 px-2.5 py-1.5 text-xs font-bold text-[#7ed957] transition hover:border-[#7ed957]/60 hover:text-[#9be870]"
        title="Download Excel (.xlsx)"
      >
        ⬇ Excel
      </Link>
    </div>
  );
}
