/**
 * src/components/admin/catalog/KnownProductChip.tsx  (S09)
 *
 * "Known product - last onboarded Mar 12 from Phat Panda." on one Onboarding
 * row, with one plain sentence under it saying how much is already on file
 * and whether a web lookup is still needed. Presentational only - no reads,
 * no state; every word comes from the pure core (memoryChipCopy), which only
 * says what is TRUE today (it never promises "auto-attach on approve": S12
 * is what copies facts onto the menu item, and it is not shipped).
 *
 * Accessibility (Inclusive Components, "Tooltips & Toggletips"): the reason
 * is visible text under the chip, never only a hover title (invisible on
 * touch and to many screen readers). The per-fact list is a native
 * <details> disclosure - keyboard and screen-reader operable with no JS.
 */
import {
  MEMORY_FIELD_LABEL,
  factSourceLabel,
  memoryChipCopy,
  type ProductMemory,
} from "@/lib/catalog/fact-memory-core";

const TONE_CLASS: Record<"accent" | "muted", string> = {
  accent: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  muted: "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]",
};

export function KnownProductChip({ memory, now }: { memory: ProductMemory; now: Date }) {
  const chip = memoryChipCopy(memory, now);
  if (!chip || !chip.title) return null;
  return (
    <div className="mt-1 max-w-[20rem]" data-testid="known-product" data-complete={memory.complete ? "true" : "false"}>
      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[chip.tone]}`}>
        {chip.title}
      </span>
      {chip.detail ? (
        <div className="mt-0.5 text-[10px] leading-tight text-[var(--admin-text-faint)]">{chip.detail}</div>
      ) : null}
      {memory.facts.length > 0 ? (
        <details className="mt-0.5 text-[10px] text-[var(--admin-text-faint)]">
          <summary className="cursor-pointer font-semibold text-[var(--admin-accent)]">What is on file</summary>
          <ul className="mt-0.5 space-y-0.5" data-testid="known-product-facts">
            {memory.facts.map((f) => (
              <li key={f.field}>
                <span className="font-semibold text-[var(--admin-text)]">{MEMORY_FIELD_LABEL[f.field]}</span>
                {" \u00b7 "}
                {f.origin === "history" ? "earlier lookup " : ""}
                {factSourceLabel(f.source, f.confidence, f.origin)}
                {f.covered ? " \u00b7 counted" : " \u00b7 not counted"}
                {" \u2014 "}
                {f.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
