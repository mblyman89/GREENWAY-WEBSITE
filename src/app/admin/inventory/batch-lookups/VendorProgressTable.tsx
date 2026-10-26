/**
 * R74 S44 - "Lookup progress by vendor" (Batch Lookups > Vendor confidence).
 * Every Cultivera vendor; expand one to see each product: did we ask Google,
 * exactly what was asked, did anything come back, how many facts, how many
 * landed on the record. Native <details> - no client JS.
 */
import Link from "next/link";
import { Badge } from "@/components/admin/ui";
import { draftsHref } from "@/lib/catalog/draft-deep-link-core";
import { BATCH_CONSOLE_PATH } from "@/lib/ai/batch-console-core";
import { CONFIDENCE_TAB } from "@/lib/catalog/cultivera-confidence-core";
import { loadVendorLookupProgress } from "@/lib/catalog/vendor-lookup-progress-server";
import { unstickAndRequeueAction } from "./actions";
import { ASK_STATE_LABEL, ASK_STATE_TONE, type VendorProgress } from "@/lib/catalog/vendor-lookup-progress-core";

const th = "px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]";
const td = "px-2 py-1.5 align-top";
const ROW_CAP = 500;

const pctTone = (p: number) => (p >= 90 ? "green" : p >= 50 ? "gold" : "orange");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "-");

function Bar({ v }: { v: VendorProgress }) {
  const w = (x: number) => `${v.products === 0 ? 0 : (x / v.products) * 100}%`;
  return (
    <div className="flex h-2 w-40 overflow-hidden rounded-full bg-[var(--admin-surface-2)]" title={`${v.answered} found info, ${v.fromMemory} on file, ${v.nothingFound} nothing found, ${v.inFlight} in progress, ${v.failed} failed, ${v.stuck} stuck, ${v.notAsked} not asked`}>
      <span className="bg-emerald-500" style={{ width: w(v.answered + v.fromMemory) }} />
      <span className="bg-amber-500" style={{ width: w(v.nothingFound) }} />
      <span className="bg-sky-500" style={{ width: w(v.inFlight) }} />
      <span className="bg-red-500" style={{ width: w(v.failed + v.stuck) }} />
    </div>
  );
}

export async function VendorProgressTable({ selectedVendor }: { selectedVendor: string }) {
  const load = await loadVendorLookupProgress();
  if (!load.ok) return <p className="text-sm text-red-300">Lookup progress could not load: {load.error}</p>;
  const vendors = load.vendors;
  const t = vendors.reduce(
    (a, v) => ({ products: a.products + v.products, asked: a.asked + v.asked, answered: a.answered + v.answered + v.fromMemory, notAsked: a.notAsked + v.notAsked, redo: a.redo + v.stuck + v.failed + v.inFlight }),
    { products: 0, asked: 0, answered: 0, notAsked: 0, redo: 0 },
  );
  const sel = selectedVendor.trim().toLowerCase();

  return (
    <div className="space-y-2 rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">{"\ud83d\udcca"} Lookup progress by vendor</h2>
        <p className="text-xs text-[var(--admin-text-muted)]">
          {vendors.length} vendors · {t.products} products · {t.asked} asked Google · {t.answered} with info · {t.notAsked} never asked
        </p>
      </div>
      <p className="text-xs text-[var(--admin-text-muted)]">
        Every Cultivera product, grouped by vendor. Open a vendor to see each product: whether we asked Google, the exact words searched, whether anything came back, how many facts were found and how many were attached. Bar: green = has info, amber = asked but nothing found, blue = in progress (really waiting for Google), red = failed or stuck (nothing is sending it), grey = not asked. Use <strong>Score &amp; attach</strong> to work a vendor with the buttons above.
      </p>
      {t.redo > 0 && (
        <form action={unstickAndRequeueAction} className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-sm)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm" data-testid="unstick-all">
          <span className="flex-1">
            <strong>{t.redo}</strong> products are in progress, stuck or failed. <strong>Unstick & re-ask</strong> closes them and queues a fresh lookup for each (products already answered, or &ldquo;asked - nothing found&rdquo;, are not resent; anything inside a batch still open at Google is left alone). Then press <strong>Send 1 test batch</strong> on the Mission tab.
          </span>
          <button type="submit" className="rounded-[var(--admin-radius-sm)] bg-red-500 px-3 py-1.5 font-bold text-white hover:opacity-90">Unstick & re-ask all vendors</button>
        </form>
      )}
      <div className="divide-y divide-[var(--admin-border)] rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)]">
        {vendors.map((v) => (
          <details key={v.key} open={v.key === sel} className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--admin-surface-2)]">
              <span className="w-4 text-[var(--admin-text-faint)] group-open:rotate-90">{"\u25b8"}</span>
              <span className="min-w-48 flex-1 font-semibold">{v.vendor}</span>
              <Bar v={v} />
              <Badge tone={pctTone(v.completeness)}>{v.completeness}% with info</Badge>
              <span className="text-xs text-[var(--admin-text-muted)]">
                {v.products} products · {v.asked} asked · {v.answered} found · {v.fromMemory} on file · {v.nothingFound} nothing · {v.notAsked} not asked{v.inFlight ? ` · ${v.inFlight} in progress` : ""}{v.stuck ? ` · ${v.stuck} stuck` : ""}{v.failed ? ` · ${v.failed} failed` : ""} · {v.factsFound} facts · {v.attached} attached · {v.approved} approved
              </span>
              {v.stuck + v.failed + v.inFlight > 0 && (
                <form action={unstickAndRequeueAction}>
                  <input type="hidden" name="vendor" value={v.vendor} />
                  <button type="submit" className="rounded border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-100 hover:bg-red-500/30" title="Close this vendor's stuck, in-progress and failed lookups and queue a fresh one">
                    Unstick & re-ask ({v.stuck + v.failed + v.inFlight})
                  </button>
                </form>
              )}
              <Link className="rounded border border-[var(--admin-border)] px-2 py-0.5 text-xs font-semibold hover:bg-[var(--admin-surface)]" href={`${BATCH_CONSOLE_PATH}?tab=${CONFIDENCE_TAB}&vendor=${encodeURIComponent(v.vendor)}`}>
                Score &amp; attach
              </Link>
            </summary>
            <div className="overflow-x-auto px-3 pb-3">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Product</th>
                    <th className={th}>Asked Google?</th>
                    <th className={th}>What was asked</th>
                    <th className={th}>Came back</th>
                    <th className={th}>Facts found</th>
                    <th className={th}>Attached / to review</th>
                    <th className={th}>Times</th>
                    <th className={th}>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {v.rows.slice(0, ROW_CAP).map((p) => (
                    <tr key={p.draftId} className="border-t border-[var(--admin-border)]">
                      <td className={td}>
                        <Link className="font-semibold hover:underline" href={draftsHref({ manifestId: p.manifestId, draftId: p.draftId })}>{p.name}</Link>
                        {p.approved && <span className="ml-1 text-xs text-emerald-300">approved</span>}
                      </td>
                      <td className={td}><Badge tone={ASK_STATE_TONE[p.state]}>{ASK_STATE_LABEL[p.state]}</Badge></td>
                      <td className={`${td} max-w-xs text-xs`}>
                        {p.state === "not_asked" || p.state === "from_memory" ? (
                          <span className="text-[var(--admin-text-muted)]">would search: {p.asked}</span>
                        ) : (
                          <>
                            <span className="font-mono">&ldquo;{p.asked}&rdquo;</span>
                            {!p.askedIsExact && <span className="block text-[var(--admin-text-faint)]">(rebuilt - asked before exact queries were saved)</span>}
                          </>
                        )}
                      </td>
                      <td className={`${td} text-xs`}>
                        {p.timesAsked === 0 ? "-" : p.state === "answered" ? `Yes${p.usedWebSearch ? ", web search" : ""}${p.sources ? `, ${p.sources} source${p.sources === 1 ? "" : "s"}` : ""}` : p.state === "nothing_found" ? <span className="text-amber-300">Nothing usable</span> : p.state === "from_memory" ? "Knowledge base" : p.note ? <span className="text-red-300">{p.note}</span> : "-"}
                      </td>
                      <td className={td}>{p.timesAsked === 0 ? "-" : p.factsFound}</td>
                      <td className={td}>{p.timesAsked === 0 ? "-" : `${p.attached} / ${p.queuedForReview}`}</td>
                      <td className={td}>{p.timesAsked}</td>
                      <td className={`${td} text-xs`}>{when(p.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {v.rows.length > ROW_CAP && <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Showing the first {ROW_CAP} of {v.rows.length} (weakest first).</p>}
            </div>
          </details>
        ))}
        {vendors.length === 0 && <p className="px-3 py-2 text-sm text-[var(--admin-text-muted)]">No Cultivera vendors yet.</p>}
      </div>
    </div>
  );
}
