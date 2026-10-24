/**
 * R74 S38 - Cultivera vendor confidence scorecard (Batch Lookups tab).
 * Read: loadConfidenceOverview. Buttons: attachVendorConfidenceAction.
 */
import Link from "next/link";
import { StatCard } from "@/components/admin/StatCard";
import { Badge } from "@/components/admin/ui";
import { draftsHref } from "@/lib/catalog/draft-deep-link-core";
import { loadConfidenceOverview } from "@/lib/catalog/cultivera-confidence-server";
import { BATCH_CONSOLE_PATH } from "@/lib/ai/batch-console-core";
import {
  CONFIDENCE_TAB,
  CULTIVERA_AUTO_ATTACH_MIN,
  SCORED_FACT_LABEL,
  autoApprovable,
  confidenceButtonLabel,
  type ProductScore,
} from "@/lib/catalog/cultivera-confidence-core";
import { attachVendorConfidenceAction } from "./actions";

const btn = "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--admin-surface-2)]";
const btnPrimary = "rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black hover:opacity-90 disabled:opacity-40";
const th = "px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]";
const td = "px-2 py-1.5 align-top";
const MIN = CULTIVERA_AUTO_ATTACH_MIN;

const tone = (c: number | null) => (c === null ? "neutral" : c >= MIN ? "green" : c >= 70 ? "gold" : "danger");
const show = (v: string | string[]) => (Array.isArray(v) ? v.join(", ") : v).slice(0, 90);
const href = (vendor: string, extra = "") => `${BATCH_CONSOLE_PATH}?tab=${CONFIDENCE_TAB}&vendor=${encodeURIComponent(vendor)}${extra}`;

function status(p: ProductScore): { label: string; tone: "neutral" | "green" | "gold" | "orange" | "danger" | "outline" } {
  if (!p.scored) return { label: "No lookup scores", tone: "neutral" };
  if (autoApprovable(p)) return { label: "Auto-approves", tone: "green" };
  if (p.unsure.length === 0) return { label: "Needs strain type", tone: "gold" };
  return { label: `${p.unsure.length} unsure`, tone: "orange" };
}

export async function ConfidenceTab({ vendor, view }: { vendor: string; view: string }) {
  const o = await loadConfidenceOverview(vendor);
  if (!o.ok) return <p className="text-sm text-red-300">{o.error}</p>;
  const sel = o.selected;
  const vendors = [...o.vendors].filter((v) => v.productsInReview > 0).sort((a, b) => a.vendor.localeCompare(b.vendor));
  const unsureOnly = view === "unsure";
  const list = sel ? (unsureOnly ? sel.products.filter((p) => !p.scored || p.unsure.length > 0) : sel.products) : [];

  return (
    <div className="space-y-5">
      <div className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)] p-4">
        <h2 className="text-base font-bold">{"\ud83c\udfaf"} Cultivera vendor confidence</h2>
        <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
          Cultivera products only. For each vendor, how sure the AI is about what it found: description, short line, effects, aroma, flavor and strain type (images are never scored - you pick those). A product&apos;s score is its weakest fact. The bar is {MIN}%.
          Attaching saves the facts to each product&apos;s own record as your confirmed answer. A product is then approved and published <strong>only if it has a strain type</strong> (your pick, the lookup at {MIN}%+, or the strain library / manifest when they agree) and passes the usual category and type checks. Everything else waits on the onboarding page for you.
        </p>
        <form method="get" action={BATCH_CONSOLE_PATH} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value={CONFIDENCE_TAB} />
          <label className="text-sm">Vendor<br />
            <select name="vendor" defaultValue={sel?.vendor ?? vendor} className="min-w-64 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1">
              <option value="">Pick a vendor...</option>
              {vendors.map((v) => <option key={v.key} value={v.vendor}>{v.vendor} ({v.productsInReview} in review)</option>)}
            </select>
          </label>
          <button className={btn}>Score this vendor</button>
        </form>
      </div>

      {sel && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Confidence" value={sel.scorecard.confidence === null ? "-" : `${sel.scorecard.confidence}%`} hint={`${sel.scorecard.factsAtBar}/${sel.scorecard.factsTotal} facts at ${MIN}%+`} accent={sel.scorecard.ready ? "green" : "orange"} />
            <StatCard label="In review" value={String(sel.scorecard.products)} hint={`${sel.scorecard.scored} with lookup scores`} />
            <StatCard label="All facts confident" value={String(sel.scorecard.confidentProducts)} hint={`every fact at ${MIN}%+`} accent="green" />
            <StatCard label="Will auto-approve" value={String(sel.scorecard.approvable)} hint="confident + strain type" accent="green" />
            <StatCard label="Need strain type" value={String(sel.scorecard.needStrain)} hint="facts attach, row waits for you" accent="gold" />
            <StatCard label="Held back" value={String(sel.scorecard.heldBack)} hint="an unsure fact or no scores" accent="muted" />
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)] p-3">
            <Badge tone={sel.scorecard.ready ? "green" : "orange"}>{sel.scorecard.ready ? `Trusted: ${sel.scorecard.confidence}% \u2265 ${MIN}%` : `Below the ${MIN}% bar`}</Badge>
            <form action={attachVendorConfidenceAction}>
              <input type="hidden" name="vendor" value={sel.vendor} />
              <input type="hidden" name="mode" value="confident" />
              <button className={btnPrimary} disabled={!sel.scorecard.ready || sel.scorecard.confidentProducts === 0}>{confidenceButtonLabel(sel.scorecard)}</button>
            </form>
            <form action={attachVendorConfidenceAction}>
              <input type="hidden" name="vendor" value={sel.vendor} />
              <input type="hidden" name="mode" value="all" />
              <button className={btn} disabled={sel.scorecard.scored === 0}>Attach every fact found ({sel.scorecard.scored} products)</button>
            </form>
            <Link className={btn} href={href(sel.vendor, unsureOnly ? "" : "&view=unsure")}>{unsureOnly ? "Show all products" : `Show unsure (${sel.scorecard.heldBack})`}</Link>
          </div>
          {!sel.scorecard.ready && sel.scorecard.confidence !== null && <p className="text-sm text-amber-300">This vendor is below the {MIN}% bar, so the one-click button is off. Review the unsure products, or tick the ones you trust and attach them.</p>}

          <form action={attachVendorConfidenceAction} className="space-y-2">
            <input type="hidden" name="vendor" value={sel.vendor} />
            <input type="hidden" name="mode" value="selected" />
            {unsureOnly && <input type="hidden" name="view" value="unsure" />}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">{unsureOnly ? "Unsure products" : "Every product in review"} ({list.length})</h3>
              <button className={btn} disabled={list.length === 0}>Attach every fact for the ticked products</button>
            </div>
            <div className="overflow-x-auto rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead><tr><th className={th}></th><th className={th}>Product</th><th className={th}>Score</th><th className={th}>Facts (confidence)</th><th className={th}>Strain type</th><th className={th}>Status</th></tr></thead>
                <tbody>
                  {list.slice(0, 400).map((p) => {
                    const st = status(p);
                    const have = sel.attachedFields.get(p.draftId);
                    return (
                      <tr key={p.draftId} className="border-t border-[var(--admin-border)]">
                        <td className={td}><input type="checkbox" name="d" value={p.draftId} disabled={!p.scored} aria-label={`Select ${p.name}`} /></td>
                        <td className={td}><Link className="font-semibold hover:underline" href={draftsHref({ manifestId: p.manifestId, draftId: p.draftId })}>{p.name}</Link></td>
                        <td className={td}><Badge tone={tone(p.score)}>{p.score === null ? "-" : `${p.score}%`}</Badge></td>
                        <td className={td}>
                          <ul className="space-y-0.5">
                            {p.facts.map((f) => (
                              <li key={f.field} className={f.confidence !== null && f.confidence >= MIN ? "" : "text-amber-300"}>
                                <span className="font-semibold">{SCORED_FACT_LABEL[f.field]}</span> {f.confidence === null ? "?" : `${f.confidence}%`}{have?.has(f.field) ? " \u2713" : ""}: <span className="text-[var(--admin-text-muted)]">{show(f.value)}</span>
                              </li>
                            ))}
                            {!p.scored && <li className="text-[var(--admin-text-muted)]">Run the batch lookup for this product first.</li>}
                          </ul>
                        </td>
                        <td className={td}>{p.strain ? `${p.strain} (${p.strainFrom})` : <span className="text-amber-300">pick on the row</span>}</td>
                        <td className={td}><Badge tone={st.tone}>{st.label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {list.length > 400 && <p className="text-xs text-[var(--admin-text-muted)]">Showing the first 400 (weakest first). The vendor buttons cover all {list.length}.</p>}
          </form>
        </>
      )}
    </div>
  );
}
