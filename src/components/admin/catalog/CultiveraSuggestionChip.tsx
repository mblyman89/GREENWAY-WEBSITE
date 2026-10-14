/**
 * src/components/admin/catalog/CultiveraSuggestionChip.tsx  (R50 S4)
 *
 * "Looks like Cultivera product X" under a Product Onboarding row whose
 * restock verdict is "New card": the imported Cultivera card this product
 * is spelled almost exactly like, with the evidence and a link to compare.
 * Presentational only - no reads, no state, no form: a suggestion is NEVER
 * applied (approving behaves exactly as before). The evidence is visible
 * text, not a hover title (tooltips are invisible on touch).
 */
import Link from "next/link";
import {
  SUGGESTION_DETAIL,
  suggestionChipCopy,
  suggestionLinks,
  type IntakeSuggestion,
} from "@/lib/inventory/cultivera-intake-suggestion-core";

export function CultiveraSuggestionChip({ suggestion }: { suggestion: IntakeSuggestion }) {
  const links = suggestionLinks(suggestion);
  return (
    <div className="mt-1 max-w-[20rem]" data-testid="cultivera-suggestion" data-how={suggestion.best.how}>
      <span className="inline-block rounded-full bg-[var(--admin-gold-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--admin-gold)]">
        {suggestionChipCopy(suggestion)}
      </span>
      <ul className="mt-0.5 list-disc pl-4 text-[10px] leading-tight text-[var(--admin-text-faint)]" data-testid="cultivera-suggestion-evidence">
        {suggestion.best.evidence.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <div className="mt-0.5 text-[10px] leading-tight text-[var(--admin-text-faint)]">
        {SUGGESTION_DETAIL}
        {links.map((l) => (
          <span key={l.href}>
            {" "}
            <Link href={l.href} className="font-semibold text-[var(--admin-accent)] underline" data-testid="cultivera-suggestion-link">
              {l.label}
            </Link>
          </span>
        ))}
      </div>
    </div>
  );
}
