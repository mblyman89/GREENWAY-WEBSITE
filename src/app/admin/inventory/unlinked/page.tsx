/**
 * /admin/inventory/unlinked  (D195 step 2: unlinked stock worklist)
 *
 * Owner, 2026-11-07: "i think it is not connected properly to the inventory
 * system." Lots received under their vendor barcode that belong to NO
 * published menu card. The register cannot floor them at cost, FIFO cannot
 * find them, and Promotions calls their card "no cost". Each row shows the
 * card it most likely belongs to and why; the owner confirms with one press.
 * The write is guarded (compare-and-set on the old key) and audited, and the
 * lot's CCRS identity (lot code / inventory external id) is never changed.
 *
 * Rejected lots are listed but never linked: rejected stock is not ours to
 * sell. If it really is on the shelf, set it active on its lot page first.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { formatMoneyMinor } from "@/lib/promotions/discount-engine-core";
import { formatPacificDateTime } from "@/lib/inventory/lot-lifecycle-core";
import {
  buildUnlinkedWorklist,
  summarizeUnlinked,
  type CardSuggestion,
  type UnlinkedRow,
  type UnlinkedState,
} from "@/lib/inventory/unlinked-stock-core";
import { loadCandidateLots, loadUnlinkedCards } from "@/lib/inventory/unlinked-stock-store";
import { relinkUnlinkedLotAction } from "./actions";

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<UnlinkedState, string> = {
  suggested: "Match found",
  ambiguous: "Several cards fit",
  no_match: "No card on the menu",
  rejected: "Rejected at receiving",
};

const STATE_TONE: Record<UnlinkedState, string> = {
  suggested: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  ambiguous: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  no_match: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  rejected: "border-white/15 bg-white/5 text-white/60",
};

function LinkButton({ row, c }: { row: UnlinkedRow; c: CardSuggestion }) {
  return (
    <form action={relinkUnlinkedLotAction} className="inline">
      <input type="hidden" name="lot_id" value={row.lot.id} />
      <input type="hidden" name="old_key" value={row.lot.posProductKey ?? ""} />
      <input type="hidden" name="card_key" value={c.cardKey} />
      {c.sizeId ? <input type="hidden" name="size_id" value={c.sizeId} /> : null}
      <button
        type="submit"
        data-testid="unlinked-confirm"
        className="rounded border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-100 hover:bg-emerald-400/20"
      >
        Link to {c.cardName}
        {c.sizeLabel ? ` (${c.sizeLabel})` : ""}
      </button>
    </form>
  );
}

export default async function UnlinkedStockPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; tone?: string }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const [cards, lots] = await Promise.all([loadUnlinkedCards(), loadCandidateLots()]);
  const problem = !cards.ok ? cards.error : !lots.ok ? lots.error : null;
  const rows = cards.ok && lots.ok ? buildUnlinkedWorklist(lots.lots, cards.cards) : [];
  const sum = summarizeUnlinked(rows);
  const checkedAt = formatPacificDateTime(new Date().toISOString());

  return (
    <div>
      <AdminPageHeader
        title="Stock on no menu card"
        subtitle="Lots received under a vendor barcode that no published product card points to. Link each to its card so cost, FIFO and Promotions see it."
      />
      <div className="space-y-5 px-5 py-6 sm:px-8">
        <Breadcrumbs items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Stock on no menu card" }]} />

        <HelpPanel id="unlinked-help" title="Why lots end up here, and what Link does">
          <p>
            Receiving keys a lot by the vendor&apos;s product SKU, or by its barcode when the manifest has no SKU. Product Onboarding then joins the
            lot to its menu card. That join is skipped when a manifest was <strong>rejected</strong> and its lots were later set active by hand, or
            when an onboarding draft was replaced by a card that was already live. The lot is then on the shelf but on no card: the register cannot
            floor it at cost, FIFO cannot pick it, and Promotions shows its card as &quot;no cost&quot;.
          </p>
          <p className="mt-2">
            <strong>Link</strong> points the lot at the card shown (and at its size, when the size is clear). The lot&apos;s lot code and CCRS
            inventory id stay exactly as received. The press re-checks everything first and changes nothing if the lot or the menu changed. Every
            link is in the audit log as &quot;inventory_lot.relinked_to_card&quot;.
          </p>
        </HelpPanel>

        {sp.msg ? (
          <p
            className={`rounded-lg border px-4 py-2 text-sm ${sp.tone === "error" ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"}`}
            data-testid="unlinked-banner"
          >
            {sp.msg}
          </p>
        ) : null}

        {problem ? (
          <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-2 text-sm text-red-100" data-testid="unlinked-read-problem">
            The list could not be built, so nothing is shown rather than a wrong list: {problem}
          </p>
        ) : (
          <p className="text-sm text-white/70" data-testid="unlinked-summary">
            {sum.sellable === 0
              ? "Every received lot is on a published menu card."
              : `${sum.sellable} lot${sum.sellable === 1 ? "" : "s"} (${sum.unitsOnHand} units on hand) on no menu card; ${sum.suggested} with a clear match.`}
            {sum.rejected > 0 ? ` ${sum.rejected} rejected lot${sum.rejected === 1 ? "" : "s"} listed for reference.` : ""}{" "}
            <span className="text-white/45" data-testid="unlinked-checked-at">Checked at {checkedAt}.</span>
          </p>
        )}

        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-sm" data-testid="unlinked-table">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/50">
                <tr>
                  <th className="px-3 py-2">Lot</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">On hand</th>
                  <th className="px-3 py-2">Cost</th>
                  <th className="px-3 py-2">Belongs to</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.lot.id} className="border-t border-white/10 align-top" data-testid="unlinked-row">
                    <td className="px-3 py-2">
                      <Link href={`/admin/inventory/${r.lot.id}`} className="text-white hover:underline" data-testid="unlinked-lot-link">
                        {r.lot.productName ?? "(no name)"}
                      </Link>
                      <div className="text-xs text-white/45">
                        {r.lot.posProductKey}
                        {r.lot.vendorName ? ` · ${r.lot.vendorName}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-white/70">{r.lot.status}</td>
                    <td className="px-3 py-2 text-white/70">{r.lot.onHandQty}</td>
                    <td className="px-3 py-2 text-white/70">{r.lot.unitCostMinorUnits != null ? formatMoneyMinor(r.lot.unitCostMinorUnits) : "none"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${STATE_TONE[r.state]}`}>{STATE_LABEL[r.state]}</span>
                      {r.candidates.map((c) => (
                        <div key={c.cardKey} className="mt-1.5" data-testid="unlinked-candidate">
                          <div className="text-white/85">
                            {c.cardName}
                            {c.brandName ? <span className="text-white/50"> · {c.brandName}</span> : null}
                            {c.category ? <span className="text-white/50"> · {c.category}</span> : null}
                            <span className="text-white/40"> · {c.cardKey}</span>
                          </div>
                          <div className="text-xs text-white/50">{c.reasons.join("; ")}.</div>
                          {r.state === "rejected" ? (
                            <div className="text-xs text-white/50">
                              Not linked: this lot was rejected. If it really is on the shelf, set it active on{" "}
                              <Link href={`/admin/inventory/${r.lot.id}`} className="underline">its lot page</Link> first.
                            </div>
                          ) : (
                            <div className="mt-1">
                              <LinkButton row={r} c={c} />
                              {!c.sizeId ? <span className="ml-2 text-xs text-white/50">Then pick its size on the lot page.</span> : null}
                            </div>
                          )}
                        </div>
                      ))}
                      {r.state === "no_match" ? (
                        <div className="mt-1 text-xs text-white/55">
                          No published card fits. Create it in{" "}
                          <Link href={`/admin/inventory/drafts?status=draft&q=${encodeURIComponent(r.lot.posProductKey ?? "")}`} className="underline">
                            Product Onboarding
                          </Link>
                          , or link it on <Link href={`/admin/inventory/${r.lot.id}`} className="underline">its lot page</Link>.
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
