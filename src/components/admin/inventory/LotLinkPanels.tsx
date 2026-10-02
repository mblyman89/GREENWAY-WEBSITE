/**
 * S37 — the lot page's two "fill only when empty" doors.
 *
 *   <LotProductLinkPanel>  (the page wraps it in id="product-link") — "Link this lot to a product"
 *   <LotCoaAttach>         (inside #coa)      — "Attach a lab result"
 *
 * Server components with zero client JS. Every decision (eligibility, key
 * parsing, candidate facts and warnings, copy) comes from the pure core
 * src/lib/inventory/lot-link-core.ts; the writes are the guarded server
 * actions linkLotProductAction / linkLotCoaAction (inventory/actions.ts).
 *
 * The COA search is a plain GET form (`coaSearch`), so the result list is a
 * URL the owner can reload or share; each candidate is its OWN small POST
 * form carrying one hidden lab_result_id (no nested forms).
 */
import Link from "next/link";
import {
  MAX_LABTEST_ID,
  coaSearchSummary,
  draftKeySuggestions,
  refusalMessage,
  type CoaCandidateView,
  type LinkRefusal,
  type LotDraftHint,
} from "@/lib/inventory/lot-link-core";

type Action = (formData: FormData) => void | Promise<void>;

const BTN =
  "rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90";
const INPUT =
  "w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2,transparent)] px-2 py-1.5 text-sm text-[var(--admin-text)]";

export const PRODUCT_LINK_TITLE = "Link this lot to a product";
export const COA_ATTACH_TITLE = "Attach a lab result";

export function LotProductLinkPanel({
  currentKey,
  keySourceLabel,
  refusal,
  drafts,
  action,
}: {
  /** The lot's key when it has one (the panel then only explains). */
  currentKey: string | null;
  /** Plain-English provenance of the current key, when known. */
  keySourceLabel: string | null;
  /** Why the door is closed (from productLinkEligibility), or null when open. */
  refusal: LinkRefusal | null;
  /** Onboarding drafts seeded from this lot (catalog_product_drafts.lot_id). */
  drafts: readonly LotDraftHint[];
  action: Action;
}) {
  const suggestions = draftKeySuggestions(drafts);
  return (
    <div
      data-testid="lot-product-link"
      className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
    >
      <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Product link</h2>
      {currentKey ? (
        <p className="text-xs text-[var(--admin-text-faint)]" data-testid="lot-product-link-set">
          Linked to product key <strong className="text-[var(--admin-text)]">{currentKey}</strong>
          {keySourceLabel ? ` (${keySourceLabel})` : ""}. Re-pointing a linked lot to a different
          product is not done here: the key drives the register and the menu.
        </p>
      ) : refusal ? (
        <p className="text-xs text-[var(--admin-text-faint)]" data-testid="lot-product-link-refused">
          {refusalMessage(refusal)}
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-[var(--admin-orange)]">
            <strong>Not linked</strong> — the register has nothing to ring up and a scan has nothing to
            match until this lot names its product. {PRODUCT_LINK_TITLE}: enter the POS product key of a
            card on the published menu or a draft in Product Onboarding. This only fills an empty key and
            is recorded in the audit trail.
          </p>
          {suggestions.length > 0 ? (
            <div className="mb-3" data-testid="lot-product-link-suggestions">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Onboarding drafts made from this lot
              </p>
              <ul className="space-y-1">
                {suggestions.map((s) => (
                  <li key={s.key}>
                    <form action={action} className="flex items-center justify-between gap-3 text-sm">
                      <input type="hidden" name="pos_product_key" value={s.key} />
                      <span>
                        {s.name} <span className="text-[var(--admin-text-faint)]">· {s.key} · {s.status}</span>
                      </span>
                      <button type="submit" className={BTN}>
                        Link to {s.key}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <form action={action} className="flex flex-wrap items-end gap-2" data-testid="lot-product-link-form">
            <label className="min-w-[14rem] flex-1 text-xs text-[var(--admin-text-faint)]">
              POS product key
              <input name="pos_product_key" required maxLength={200} className={INPUT} autoComplete="off" />
            </label>
            <button type="submit" className={BTN}>
              Link product
            </button>
          </form>
          <p className="mt-2 text-[11px] text-[var(--admin-text-faint)]">
            Not sure of the key?{" "}
            <Link href="/admin/inventory/drafts?status=draft" className="underline">
              Find it in Product Onboarding
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

export function LotCoaAttach({
  lotId,
  back,
  refusal,
  search,
  candidates,
  searchError,
  action,
}: {
  lotId: string;
  back: string;
  refusal: LinkRefusal | null;
  /** The validated Lab test ID searched for, or null when no search ran. */
  search: string | null;
  candidates: readonly CoaCandidateView[];
  /** A read failure or invalid search, shown instead of results. */
  searchError: string | null;
  action: Action;
}) {
  if (refusal) {
    return (
      <p className="mt-3 text-xs text-[var(--admin-text-faint)]" data-testid="lot-coa-attach-refused">
        {refusalMessage(refusal)}
      </p>
    );
  }
  return (
    <div className="mt-4 border-t border-[var(--admin-border)] pt-3" data-testid="lot-coa-attach">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
        {COA_ATTACH_TITLE}
      </h3>
      <p className="mb-2 text-xs text-[var(--admin-text-faint)]">
        Type the Lab test ID printed on this lot&apos;s COA. Every lab result already imported with that
        exact ID is listed; attach the one for this batch. Attaching only fills an empty link and is
        recorded in the audit trail.
      </p>
      <form method="get" action={`/admin/inventory/${lotId}#coa`} className="flex flex-wrap items-end gap-2">
        {back ? <input type="hidden" name="back" value={back} /> : null}
        <label className="min-w-[14rem] flex-1 text-xs text-[var(--admin-text-faint)]">
          Lab test ID
          <input
            name="coaSearch"
            defaultValue={search ?? ""}
            maxLength={MAX_LABTEST_ID}
            className={INPUT}
            autoComplete="off"
          />
        </label>
        <button type="submit" className={BTN}>
          Find lab result
        </button>
      </form>
      {searchError ? (
        <p className="mt-2 text-xs text-[var(--admin-danger)]" data-testid="lot-coa-search-error">
          {searchError}
        </p>
      ) : search ? (
        <div className="mt-3" data-testid="lot-coa-results">
          <p className="mb-2 text-xs text-[var(--admin-text-muted)]">{coaSearchSummary(search, candidates.length)}</p>
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li
                key={c.id}
                className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3 text-sm"
                data-testid="lot-coa-candidate"
              >
                <form action={action} className="flex flex-wrap items-start justify-between gap-3">
                  <input type="hidden" name="lab_result_id" value={c.id} />
                  <div>
                    <p className="font-semibold text-[var(--admin-text)]">{c.title}</p>
                    <p className="text-xs text-[var(--admin-text-muted)]">
                      {c.facts.join(" · ")} · Result: {c.result}
                    </p>
                    {c.warnings.map((w) => (
                      <p key={w} className="mt-1 text-xs text-[var(--admin-orange)]">
                        {w}
                      </p>
                    ))}
                  </div>
                  <button type="submit" className={BTN}>
                    Attach this lab result
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
