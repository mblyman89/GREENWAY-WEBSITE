/**
 * src/components/admin/catalog/CardAliasControls.tsx  (R50 A1)
 *
 * Under a Product Onboarding row:
 *   - a "New card" row with an S4 suggestion gets one "Yes, same product"
 *     button per suggested card (the server re-checks the card is still
 *     suggested before saving - card-alias-core acceptCheck);
 *   - a row that joins a card ONLY because of a saved answer (verdict
 *     joins + byAlias) gets "Forget this choice".
 * Server-rendered forms (no client state). Saving or forgetting changes
 * nothing live; the answer is used when the row is approved.
 */
import {
  ACCEPT_BUTTON_LABEL,
  ACCEPT_DETAIL,
  FORGET_BUTTON_LABEL,
} from "@/lib/pos/card-alias-core";
import type { IntakeSuggestion } from "@/lib/inventory/cultivera-intake-suggestion-core";
import type { RestockVerdict } from "@/lib/inventory/vendor-identity-core";

type FormAction = (formData: FormData) => void | Promise<void>;

export function CardAliasControls(props: {
  draftId: string;
  manifestId: string | null;
  verdict: RestockVerdict | null | undefined;
  suggestion: IntakeSuggestion | null | undefined;
  identity: string | null | undefined;
  acceptAction: FormAction;
  forgetAction: FormAction;
}) {
  const { draftId, manifestId, verdict, suggestion, identity } = props;
  if (!manifestId || !verdict) return null;
  if (verdict.kind === "joins" && verdict.byAlias && identity) {
    return (
      <form action={props.forgetAction} className="mt-1" data-testid="card-alias-forget">
        <input type="hidden" name="identity" value={identity} />
        <input type="hidden" name="manifestId" value={manifestId} />
        <input type="hidden" name="draftId" value={draftId} />
        <button type="submit" className="text-[10px] font-semibold text-[var(--admin-accent)] underline">
          {FORGET_BUTTON_LABEL}
        </button>
      </form>
    );
  }
  if (verdict.kind !== "new" || !suggestion) return null;
  const cards = [suggestion.best, ...suggestion.others];
  return (
    <div className="mt-1 max-w-[20rem]" data-testid="card-alias-accept">
      {cards.map((c, i) => (
        <form key={c.cardKey} action={props.acceptAction} className="mt-0.5">
          <input type="hidden" name="draftId" value={draftId} />
          <input type="hidden" name="manifestId" value={manifestId} />
          <input type="hidden" name="cardKey" value={c.cardKey} />
          <button
            type="submit"
            className={
              i === 0
                ? "rounded-full border border-[var(--admin-gold)] px-2 py-0.5 text-[11px] font-semibold text-[var(--admin-gold)]"
                : "text-[10px] font-semibold text-[var(--admin-accent)] underline"
            }
          >
            {i === 0 ? ACCEPT_BUTTON_LABEL : `Yes, it is '${c.cardName}'`}
          </button>
        </form>
      ))}
      <div className="mt-0.5 text-[10px] leading-tight text-[var(--admin-text-faint)]">{ACCEPT_DETAIL}</div>
    </div>
  );
}
