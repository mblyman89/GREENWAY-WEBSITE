/**
 * R27: "Product facts" - the facts a person set for ONE product, shown and
 * editable on Product Onboarding (review AND approved tabs).
 *
 * The owner's pain (verified): a saved "Fix the facts" vanished from the page
 * - the decision lived only in pos_fact_reviews and the inline panel renders
 * only for OPEN flags - so he could not see what he had typed, could not
 * correct it, and could not set the facts the engine cannot attach BEFORE
 * approving. This panel reads the saved record (savedFactsByKey) and posts
 * the SAME resolveIntakeFactReview action with the owner signature
 * (OWNER_FACTS_SIGNATURE), action fix, and the SAME field names and shared
 * parsers as the flag panel. Staging applies the record to the new card
 * (savedFactsToApply) and the action mirrors it onto a card that is already
 * live and onto the lot (mirrorIntakeFixToLive), so the website, the register
 * and the back office all read the same numbers.
 *
 * The saved record is replaced as a whole on save (one row per delivery + lot
 * key), so every field is PRE-FILLED with what is saved: saving again keeps
 * what you did not touch; clearing a field removes it.
 */
import { Button } from "@/components/admin/ui";
import {
  OWNER_FACTS_SIGNATURE,
  savedFactLines,
  type SavedProductFacts,
} from "@/lib/pos/intake-fact-review-core";
import { resolveIntakeFactReview } from "./actions";

const inputCls =
  "admin-focus mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-xs text-[var(--admin-text)]";
const labelCls = "block text-[11px] uppercase tracking-wide text-[var(--admin-text-muted)]";

function val(saved: SavedProductFacts | null, k: string): string {
  const v = saved ? (saved.facts as Record<string, unknown>)[k] : undefined;
  return typeof v === "number" || typeof v === "string" ? String(v) : "";
}

function yesNo(saved: SavedProductFacts | null, k: string): "" | "yes" | "no" {
  const v = saved ? (saved.facts as Record<string, unknown>)[k] : undefined;
  return v === true ? "yes" : v === false ? "no" : "";
}

function Field({ id, label, name, saved, placeholder }: { id: string; label: string; name: string; saved: SavedProductFacts | null; placeholder?: string }) {
  return (
    <div>
      <label className={labelCls} htmlFor={`pf-${id}-${name}`}>{label}</label>
      <input id={`pf-${id}-${name}`} name={name} defaultValue={val(saved, name)} placeholder={placeholder} className={inputCls} />
    </div>
  );
}

export function ProductFactsPanel({
  draftId,
  manifestId,
  productKey,
  saved,
  readOk,
  returnManifest,
  returnView,
  returnTo,
  title,
}: {
  draftId: string;
  manifestId: string;
  /** The lot key (pos_product_key) the facts belong to. */
  productKey: string;
  saved: SavedProductFacts | null;
  /** False when the saved facts could not be read - never shown as "nothing saved". */
  readOk: boolean;
  returnManifest: string | null;
  returnView: "draft" | "approved";
  /** R28: the lot / KB product page to come back to (validated server-side by safeFactReturnPath). */
  returnTo?: string;
  /** R28: heading override (the lot page shows the delivery it belongs to). */
  title?: string;
}) {
  const lines = saved ? savedFactLines(saved.facts) : [];
  return (
    <div className="mt-2 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3 text-left" data-testid="product-facts-panel">
      <p className="text-xs font-bold text-[var(--admin-text)]">{title ?? "Product facts you set"}</p>
      {!readOk ? (
        <p className="mt-1 text-[11px] text-[var(--admin-danger)]">
          The saved facts could not be read right now. Reload the page before editing so nothing you set is overwritten.
        </p>
      ) : lines.length > 0 ? (
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]" data-testid="product-facts-saved">
          {lines.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-[var(--admin-text-muted)]">{label}</dt>
              <dd className="text-[var(--admin-text)]">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-[11px] text-[var(--admin-text-muted)]">
          Nothing set by hand yet. If the system could not attach a fact (for example the package THC in mg), set it here {"\u2014"} it is used on the website, the register and the back office.
        </p>
      )}
      {saved?.note && <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">Note: {saved.note}</p>}

      {readOk && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-accent)]">
            {lines.length > 0 ? "Edit the facts\u2026" : "Set the facts\u2026"}
          </summary>
          <form action={resolveIntakeFactReview} className="mt-2 space-y-3">
            <input type="hidden" name="manifestId" value={manifestId} />
            <input type="hidden" name="draftId" value={draftId} />
            <input type="hidden" name="sourceItemId" value={productKey} />
            <input type="hidden" name="flagSignature" value={OWNER_FACTS_SIGNATURE} />
            <input type="hidden" name="action" value="fix" />
            <input type="hidden" name="return_view" value={returnView} />
            {returnManifest && <input type="hidden" name="return_manifest" value={returnManifest} />}
            {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
            <p className="text-[11px] text-[var(--admin-text-muted)]">
              Take each figure from the package or the COA. What is filled in below is what gets saved {"\u2014"} clear a field to remove it.
            </p>
            <p className="text-[11px] text-[var(--admin-text-muted)]">
              Package THC fills itself from servings × mg per serving when left blank. For ratio products (1:1, 2:2:2:1 CBG:CBC:CBD:THC) enter each cannabinoid’s PACKAGE total in mg — the menu shows these totals, never the lab percent.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field id={draftId} saved={saved} label="THC (display)" name="thc" placeholder="e.g. 100mg" />
              <Field id={draftId} saved={saved} label="CBD (display)" name="cbd" placeholder="e.g. 100mg" />
              <Field id={draftId} saved={saved} label="Ratio" name="ratioLabel" placeholder="e.g. 1:1 THC:CBD" />
              <Field id={draftId} saved={saved} label="Servings per pack" name="servingsPerPack" />
              <Field id={draftId} saved={saved} label="Mg per serving" name="mgPerServing" />
              <Field id={draftId} saved={saved} label="Package THC (mg)" name="packageThcMg" />
              <Field id={draftId} saved={saved} label="Package CBD (mg)" name="packageCbdMg" />
              <Field id={draftId} saved={saved} label="Package CBG (mg)" name="packageCbgMg" />
              <Field id={draftId} saved={saved} label="Package CBN (mg)" name="packageCbnMg" />
              <Field id={draftId} saved={saved} label="Package CBC (mg)" name="packageCbcMg" />
              <Field id={draftId} saved={saved} label="Net weight (g)" name="netWeightGrams" />
              <Field id={draftId} saved={saved} label="Net volume (ml)" name="netVolumeMl" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor={`pf-${draftId}-lowThcLiquid`}>Low-THC beverage (200 mg allowance)?</label>
                <select id={`pf-${draftId}-lowThcLiquid`} name="lowThcLiquid" defaultValue={yesNo(saved, "lowThcLiquid")} className={inputCls}>
                  <option value="">Not set</option>
                  <option value="yes">Yes - packaged in units of 4 mg THC or less</option>
                  <option value="no">No - regular infused liquid (72 oz limit)</option>
                </select>
              </div>
              <Field id={draftId} saved={saved} label="THC mg per SEALED CONTAINER" name="unitThcMg" />
              <div>
                <label className={labelCls} htmlFor={`pf-${draftId}-otherwiseTaken`}>Otherwise taken into the body (10 unit limit)?</label>
                <select id={`pf-${draftId}-otherwiseTaken`} name="otherwiseTaken" defaultValue={yesNo(saved, "otherwiseTaken")} className={inputCls}>
                  <option value="">Not set</option>
                  <option value="yes">Yes - suppository or similar (10 unit limit)</option>
                  <option value="no">No - smoked, eaten, or applied to the skin</option>
                </select>
              </div>
              <Field id={draftId} saved={saved} label="Individual units per PACKAGE" name="unitsPerPackage" />
            </div>
            <div>
              <label className={labelCls} htmlFor={`pf-${draftId}-note`}>Note (how you verified - e.g. &ldquo;checked the physical package&rdquo;)</label>
              <input id={`pf-${draftId}-note`} name="note" maxLength={500} defaultValue={saved?.note ?? ""} className={inputCls} />
            </div>
            <Button type="submit" variant="save" size="sm">Save the product facts</Button>
          </form>
        </details>
      )}
    </div>
  );
}
