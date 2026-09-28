/**
 * src/components/admin/catalog/RestockPreviewChip.tsx  (S19.2 / S19.4)
 *
 * The "will join live card" preview on one Onboarding row: what Approve WILL
 * do for this product, decided by the same pure planner the staging uses
 * (previewRestockVerdicts). Presentational only - no reads, no state.
 *
 * Every chip that asks for a fix carries the link that fixes it (never "go
 * somewhere and figure it out"): a name match whose lots sit under a
 * different vendor record -> Combine duplicate vendors (the merge moves the
 * lots' vendor_id, which the id match reads). Ambiguous gets NO fix link -
 * Product Mastering is not read by the merge (bible F-096), so linking it
 * would be a dead end; it links the matching live cards to compare instead.
 * No `back` param: backHref restores a query onto the FIX page's own
 * fallback route, not onto Onboarding, so it would mislead. The browser
 * Back button returns here.
 * The one-sentence reason sits under the chip, not only in a hover title
 * (tooltips are invisible on touch and to many screen readers).
 */
import Link from "next/link";
import {
  restockChipCopy,
  restockChipDetail,
  restockChipFixHref,
  restockChipTone,
  restockCompareLinks,
  type RestockVerdict,
} from "@/lib/inventory/vendor-identity-core";

const TONE_CLASS: Record<"accent" | "muted" | "gold", string> = {
  accent: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  gold: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
  muted: "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]",
};

/** Link text for the fix target (kept next to the href it names). */
export function restockFixLabel(href: string): string {
  return href === "/admin/vendors/merge" ? "Combine the vendor records" : "Fix";
}

export function RestockPreviewChip({ verdict }: { verdict: RestockVerdict }) {
  const tone = restockChipTone(verdict);
  const fix = restockChipFixHref(verdict);
  const compare = restockCompareLinks(verdict);
  return (
    <div className="mt-1 max-w-[20rem]" data-testid="restock-preview" data-kind={verdict.kind}>
      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[tone]}`}>
        {restockChipCopy(verdict)}
      </span>
      <div className="mt-0.5 text-[10px] leading-tight text-[var(--admin-text-faint)]">
        {restockChipDetail(verdict)}
        {fix ? (
          <>
            {" "}
            <Link href={fix} className="font-semibold text-[var(--admin-accent)] underline" data-testid="restock-fix">
              {restockFixLabel(fix)} {"\u2192"}
            </Link>
          </>
        ) : null}
        {compare.length > 0 ? (
          <span data-testid="restock-compare">
            {compare.map((c) => (
              <span key={c.href}>
                {" "}
                <Link href={c.href} className="font-semibold text-[var(--admin-accent)] underline">
                  {c.label}
                </Link>
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The one line shown instead of chips when no preview can be made. */
export function RestockPreviewUnavailable({ text }: { text: string }) {
  return (
    <p className="text-xs text-[var(--admin-text-faint)]" data-testid="restock-preview-unavailable">
      {text}
    </p>
  );
}
