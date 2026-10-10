/**
 * S30 (bible S30.2): the inline approve / fix / reject controls for ONE
 * approved product whose delivery's menu update is held for a
 * `fact_extraction_review` flag. This is the control the Issues / publish
 * fix link lands on (draftsHref status=approved + draft=<id>).
 *
 * Every form posts resolveIntakeFactReview with the same hidden identity:
 * the delivery, the product, the lot key the flag is about and the flag's
 * signature (so a flag that changed since the page loaded is asked again,
 * never silently answered). The Fix fields and the two compliance questions
 * are the SAME names and rules as the POS-import review
 * (menu-imports/[id]/facts/page.tsx; parsed by the shared
 * parseLowThcClassification / parseOtherwiseTakenClassification).
 *
 * R35 (#4): the Fix form states the WAC 314-55-095 serving / package limits
 * (serving-limit-warning-core); the server action saves a figure over a limit
 * WITH a warning (banner + audit), never a refusal.
 */
import { Button } from "@/components/admin/ui";
import { FACT_REVIEW_HEADING, factPanelLead, type OpenFactFlag } from "@/lib/pos/intake-fact-review-core";
import {
  PACKAGE_RULE,
  SERVING_RULE,
  WA_PACKAGE_MAX_THC_MG,
  WA_SERVING_MAX_THC_MG,
  servingLimitApplies,
} from "@/lib/compliance/serving-limit-warning-core";
import { VolumeField } from "@/components/admin/inventory/VolumeField";
import { resolveIntakeFactReview } from "./actions";

const inputCls =
  "admin-focus mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-xs text-[var(--admin-text)]";
const labelCls = "block text-[11px] uppercase tracking-wide text-[var(--admin-text-muted)]";

function Hidden({ flag, draftId, returnManifest }: { flag: OpenFactFlag; draftId: string; returnManifest: string | null }) {
  return (
    <>
      <input type="hidden" name="manifestId" value={flag.manifestId} />
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="sourceItemId" value={flag.key} />
      <input type="hidden" name="flagSignature" value={flag.signature} />
      {returnManifest && <input type="hidden" name="return_manifest" value={returnManifest} />}
    </>
  );
}

function FixField({ label, name, placeholder }: { label: string; name: string; placeholder?: string }) {
  return (
    <div>
      <label className={labelCls} htmlFor={`fact-${name}`}>{label}</label>
      <input id={`fact-${name}`} name={name} placeholder={placeholder} className={inputCls} />
    </div>
  );
}

function NoteField() {
  return (
    <div>
      <label className={labelCls}>Note (how you verified - e.g. &ldquo;checked the physical package&rdquo;, or the lot number)</label>
      <input name="note" maxLength={500} className={inputCls} />
    </div>
  );
}

export function IntakeFactReviewPanel({
  flag,
  draftId,
  returnManifest,
  category,
}: {
  flag: OpenFactFlag;
  draftId: string;
  returnManifest: string | null;
  /** R35: the product's website category (narrows the WAC 314-55-095 check; unknown = checked). */
  category?: string | null;
}) {
  return (
    <div
      className="mt-2 w-full rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-3 text-left"
      data-testid="intake-fact-review"
    >
      <p className="text-xs font-bold text-[var(--admin-gold)]">{FACT_REVIEW_HEADING}</p>
      <ul className="mt-1 list-disc pl-4 text-[11px] text-[var(--admin-text-muted)]">
        {flag.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {/* R27: truthful lead - a withheld product holds back only itself. */}
      <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">{factPanelLead(flag)}</p>

      <div className="mt-2 flex flex-wrap items-start gap-2">
        <form action={resolveIntakeFactReview} className="flex items-end gap-2">
          <Hidden flag={flag} draftId={draftId} returnManifest={returnManifest} />
          <input type="hidden" name="action" value="approve" />
          <input type="hidden" name="note" value="" />
          <Button type="submit" variant="save" size="sm">✓ The facts are right</Button>
        </form>
        <form action={resolveIntakeFactReview} className="flex items-end gap-2">
          <Hidden flag={flag} draftId={draftId} returnManifest={returnManifest} />
          <input type="hidden" name="action" value="reject" />
          <input type="hidden" name="note" value="" />
          <Button type="submit" variant="neutral" size="sm">Keep it off the menu</Button>
        </form>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-accent)]">Fix the facts…</summary>
        <form action={resolveIntakeFactReview} className="mt-2 space-y-3">
          <Hidden flag={flag} draftId={draftId} returnManifest={returnManifest} />
          <input type="hidden" name="action" value="fix" />
          {category && <input type="hidden" name="limit_category" value={category} />}
          <p className="text-[11px] text-[var(--admin-text-muted)]">
            Only what you type is changed. Take each figure from the package or the COA.
          </p>
          <p className="text-[11px] text-[var(--admin-text-muted)]">
            Package THC fills itself from servings × mg per serving when left blank. For ratio products (1:1, 2:2:2:1 CBG:CBC:CBD:THC) enter each cannabinoid’s PACKAGE total in mg — the menu shows these totals, never the lab percent.
          </p>
          {servingLimitApplies(category ?? null) && (
            <p className="text-[11px] text-[var(--admin-text-muted)]" data-testid="intake-fact-limit-hint">
              Washington limits: at most {WA_SERVING_MAX_THC_MG} mg THC per serving ({SERVING_RULE}) and {WA_PACKAGE_MAX_THC_MG} mg THC per package ({PACKAGE_RULE}). A figure above a limit is saved with a warning {"\u2014"} check the package before it is sold.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <FixField label="THC (display)" name="thc" placeholder="e.g. 100mg" />
            <FixField label="CBD (display)" name="cbd" placeholder="e.g. 100mg" />
            <FixField label="Ratio" name="ratioLabel" placeholder="e.g. 1:1 THC:CBD" />
            <FixField label="Servings per pack" name="servingsPerPack" />
            <FixField label="Mg per serving" name="mgPerServing" />
            <FixField label="Package THC (mg)" name="packageThcMg" />
            <FixField label="Package CBD (mg)" name="packageCbdMg" />
            <FixField label="Package CBG (mg)" name="packageCbgMg" />
            <FixField label="Package CBN (mg)" name="packageCbnMg" />
            <FixField label="Package CBC (mg)" name="packageCbcMg" />
            <FixField label="Net weight (g)" name="netWeightGrams" />
            <VolumeField id="fact-netVolumeMl" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Low-THC beverage (200 mg allowance)?</label>
              <select name="lowThcLiquid" defaultValue="" className={inputCls}>
                <option value="">Leave as-is</option>
                <option value="yes">Yes - packaged in units of 4 mg THC or less</option>
                <option value="no">No - regular infused liquid (72 oz limit)</option>
              </select>
            </div>
            <FixField label="THC mg per SEALED CONTAINER" name="unitThcMg" />
            <div>
              <label className={labelCls}>Otherwise taken into the body (10 unit limit)?</label>
              <select name="otherwiseTaken" defaultValue="" className={inputCls}>
                <option value="">Leave as-is</option>
                <option value="yes">Yes - suppository or similar (10 unit limit)</option>
                <option value="no">No - smoked, eaten, or applied to the skin</option>
              </select>
            </div>
            <FixField label="Individual units per PACKAGE" name="unitsPerPackage" />
          </div>
          <NoteField />
          <Button type="submit" variant="save" size="sm">Save the corrected facts</Button>
        </form>
      </details>
    </div>
  );
}
