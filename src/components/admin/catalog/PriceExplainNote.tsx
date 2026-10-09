/**
 * R32 (T-328) — the onboarding price fine print + "How this price was set"
 * waterfall. Server component (no client JS): a native <details> discloses
 * every step from vendor cost to suggested price, so the owner can see WHY a
 * number is what it is — and why it changed when sales history moved it.
 *
 * All wording and math come from price-explain-core.ts (pure, self-tested);
 * this component only lays them out.
 */
import { presentDraftPrice, fmtMultiple, fmtPriceMinor } from "@/lib/inventory/price-explain-core";

export function PriceExplainNote(props: {
  storedRationale: string | null;
  costMinor: number | null;
  category: string | null;
  multiple: number;
  storedFloorMinor: number | null;
  storedSuggestedMinor: number | null;
}) {
  const pp = presentDraftPrice({
    storedRationale: props.storedRationale,
    costMinor: props.costMinor,
    category: props.category,
    multiple: props.multiple,
    storedFloorMinor: props.storedFloorMinor,
    storedSuggestedMinor: props.storedSuggestedMinor,
  });
  return (
    <div className="mt-0.5 max-w-[16rem] text-left" data-testid="draft-price-explain">
      <div className="text-[10px] leading-tight text-[var(--admin-text-faint)]" data-testid="draft-price-note">
        {pp.note}
      </div>
      {pp.steps.length > 0 && (
        <details className="mt-0.5 text-[10px] leading-tight" data-testid="draft-price-waterfall">
          <summary className="cursor-pointer text-[var(--admin-text-muted)] underline decoration-dotted">
            How this price was set
          </summary>
          <ol className="mt-1 space-y-0.5 text-[var(--admin-text-faint)]">
            {pp.steps.map((st) => (
              <li key={st.key} className="flex justify-between gap-2" title={st.detail}>
                <span>{st.label}</span>
                <span className="tabular-nums text-[var(--admin-text-muted)]">
                  {st.amountMinor != null ? fmtPriceMinor(st.amountMinor) : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-1 text-[var(--admin-text-faint)]">
            Rule: {fmtMultiple(props.multiple)} cost + tax, rounded up to the next whole dollar. Sales history can
            raise the suggestion (never below the floor); the floor itself never moves with sales.
          </p>
        </details>
      )}
    </div>
  );
}
