import type { QualityGrade } from "@/lib/ai/kb/quality";

/**
 * QualityBadge — compact golden-record health chip for lists and editors.
 * Shows the quality score (0–100) with a grade-coloured dot. Optionally a
 * completeness percentage alongside.
 */
export function QualityBadge({
  quality,
  grade,
  completeness,
  size = "sm",
}: {
  quality: number;
  grade: QualityGrade;
  completeness?: number;
  size?: "sm" | "md";
}) {
  const color =
    grade === "excellent"
      ? "var(--admin-accent)"
      : grade === "good"
        ? "var(--admin-gold)"
        : grade === "fair"
          ? "var(--admin-orange)"
          : "var(--admin-danger, #d9534f)";

  const pad = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--admin-border)] bg-[var(--admin-bg)] font-medium tabular-nums text-[var(--admin-text-muted)] ${pad}`}
      title={`Quality ${quality}/100 (${grade})${
        typeof completeness === "number" ? ` · ${completeness}% complete` : ""
      }`}
    >
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-[var(--admin-text)]">{quality}</span>
      {typeof completeness === "number" ? (
        <span className="opacity-70">· {completeness}%</span>
      ) : null}
    </span>
  );
}
