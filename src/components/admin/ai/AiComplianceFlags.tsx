/**
 * src/components/admin/ai/AiComplianceFlags.tsx
 *
 * Presentational list of WA-cannabis compliance flags raised on an AI draft.
 * Server-safe. When there are no flags, renders a small "compliance clean"
 * reassurance instead (so staff get positive confirmation, not silence).
 */
export function AiComplianceFlags({
  flags,
  showCleanState = true,
}: {
  flags: string[];
  showCleanState?: boolean;
}) {
  if (flags.length === 0) {
    if (!showCleanState) return null;
    return (
      <p className="inline-flex items-center gap-1.5 text-[11px] text-[#7ed957]">
        <span>✓</span> No compliance concerns detected
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-[#ffd700]/30 bg-[#ffd700]/[0.06] px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#ffd700]">
        ⚠ Review before publishing — {flags.length} flag{flags.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-1 space-y-0.5">
        {flags.map((f, i) => (
          <li key={i} className="text-[11px] text-[#ffd700]/90">
            • {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
