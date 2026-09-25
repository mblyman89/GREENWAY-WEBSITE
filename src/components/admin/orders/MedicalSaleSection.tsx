/**
 * MedicalSaleSection — Task O (server component).
 *
 * The medical half of the order detail page:
 *  - No card attached: search patients and attach a VALID recognition card
 *    (attach re-checks validity; completion re-checks it again).
 *  - Card attached: show the card facts + validity + expiring-soon warning,
 *    the per-line DOH exemption plan (the SAME pure math the completion gate
 *    runs — what you see is what gets claimed), and a detach button.
 *  - Always: surface High-THC lines that cannot be sold without a card
 *    (statutory hard block, no override).
 *
 * Reads degrade gracefully before migration 0113 (no registry / no attach
 * column → plan shows no compliant products and attach explains the gap).
 */
import { Button, CHIP_ACTION } from "@/components/admin/ui";
import { SaveButton } from "@/components/admin/orders/SaveButton";
import { authorizationValidityAt } from "@/lib/medical/medical-authorization-core";
import { toRecognitionCard, getMedTaxSettings, getEndorsementConfig } from "@/lib/medical/store";
import { getOrderMedicalContext, getMedicalRegistryForKeys } from "@/lib/medical/sale-store";
import {
  buildOrderExemptionPlan,
  DOH_CATEGORY_LABELS,
  type PlanLine,
} from "@/lib/medical/medical-sale-core";
import { listCustomers } from "@/lib/customers/store";
import { getActiveCard } from "@/lib/medical/store";
import { attachMedicalCardAction, detachMedicalCardAction } from "@/app/admin/orders/actions";
import type { OrderWithLines } from "@/lib/orders/types";

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export async function MedicalSaleSection({
  order,
  searchQuery,
}: {
  order: OrderWithLines;
  searchQuery: string;
}) {
  const isClosed = order.status === "completed" || order.status === "cancelled" || order.status === "no_show";

  const [medCtx, medSettings, endorsement] = await Promise.all([
    getOrderMedicalContext(order.id),
    getMedTaxSettings(),
    getEndorsementConfig(),
  ]);
  const registry = await getMedicalRegistryForKeys(order.lines.map((l) => l.product_id));

  const validity = medCtx
    ? authorizationValidityAt(toRecognitionCard(medCtx.authorization), new Date())
    : null;
  const cardedValid = validity?.valid === true;

  const planLines: PlanLine[] = order.lines.map((l) => ({
    productId: l.product_id,
    productName: l.product_name,
    category: l.category ?? null,
    quantity: l.quantity,
    unitPriceMinorUnits: l.price_minor_units,
  }));
  const plan = buildOrderExemptionPlan(planLines, {
    registry,
    cardedValid,
    endorsed: medSettings.medicallyEndorsed,
    saleDate: new Date().toISOString().slice(0, 10),
    exciseExemptionUntil: endorsement?.exciseExemptionUntil ?? "2029-06-30",
  });

  // Patient search (only when open + no card attached).
  let results: { id: string; name: string; email: string | null; phone: string | null; carded: boolean }[] = [];
  if (!medCtx && !isClosed && searchQuery.trim()) {
    const customers = await listCustomers({ q: searchQuery, limit: 8 });
    results = await Promise.all(
      customers.map(async (c) => {
        const card = c.is_medical_patient ? await getActiveCard(c.id) : null;
        const v = card ? authorizationValidityAt(toRecognitionCard(card), new Date()) : null;
        return {
          id: c.id,
          name: `${c.first_name}${c.last_name ? ` ${c.last_name}` : ""}`,
          email: c.email,
          phone: c.phone,
          carded: v?.valid === true,
        };
      }),
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">
          Medical sale
        </h2>
        {medCtx ? (
          cardedValid ? (
            <span className="rounded-full border border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/10 px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] text-[var(--admin-accent)]">
              Card attached
            </span>
          ) : (
            <span className="rounded-full border border-red-500/50 bg-red-500/10 px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] text-red-300">
              Card invalid
            </span>
          )
        ) : (
          <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] text-white/50">
            Recreational
          </span>
        )}
      </div>

      {/* High-THC hard-stop warning — visible regardless of card state. */}
      {plan.highThcViolations.length > 0 ? (
        <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-red-300">
            High-THC product — recognition card required (no override)
          </p>
          <p className="mt-1 text-xs leading-5 text-red-200">
            {plan.highThcViolations.join(", ")} may ONLY be sold to a patient with a valid
            recognition card (chapter 246-70 WAC). Attach the patient&apos;s card or remove the item —
            completion will refuse otherwise.
          </p>
        </div>
      ) : null}

      {!medSettings.medicallyEndorsed ? (
        <p className="mt-3 rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 p-3 text-xs leading-5 text-[var(--admin-gold)]">
          The store&apos;s medical endorsement is switched OFF — no tax exemptions will be claimed.
        </p>
      ) : null}

      {medCtx ? (
        <div className="mt-4 space-y-4">
          {/* Card facts */}
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm">
            <p className="font-black text-white">{medCtx.customerName}</p>
            <p className="mt-0.5 text-xs text-white/50">
              {medCtx.authorization.holder_type === "designated_provider" ? "Designated provider" : "Patient"} · UPID{" "}
              <span className="font-mono">{medCtx.authorization.unique_patient_identifier ?? "—"}</span>
            </p>
            <p className="text-xs text-white/50">
              Card {medCtx.authorization.effective_on ?? medCtx.authorization.issued_on ?? "—"} →{" "}
              {medCtx.authorization.expires_on ?? "—"}
              {medCtx.authorization.in_doh_database ? " · in MCR" : " · NOT in MCR"}
            </p>
            {validity && !validity.valid ? (
              <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
                {validity.reason} — completion is blocked until the card is fixed or detached.
              </p>
            ) : null}
            {validity?.valid && validity.expiringSoon ? (
              <p className="mt-2 rounded border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 p-2 text-xs text-[var(--admin-gold)]">
                Card expires in {validity.daysUntilExpiry} day{validity.daysUntilExpiry === 1 ? "" : "s"} — remind
                the patient to renew their authorization.
              </p>
            ) : null}
          </div>

          {/* Per-line exemption plan (same math as the completion gate) */}
          <div>
            <p className="text-[0.66rem] font-black uppercase tracking-[0.12em] text-white/40">
              Exemption plan · WAC 314-55-090 / RCW 82.08.9998
            </p>
            <div className="mt-2 space-y-1.5">
              {plan.lines.map((l, i) => (
                <div key={i} className="flex items-start justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-white/80">{l.productName}</p>
                    <p className="text-white/40">
                      {l.isCannabis
                        ? l.dohCategory
                          ? `DOH ${DOH_CATEGORY_LABELS[l.dohCategory]}`
                          : "Not DOH-verified — full tax"
                        : "Non-cannabis"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {l.salesExempt || l.exciseExempt ? (
                      <>
                        {l.exciseExempt ? (
                          <p className="font-bold text-[var(--admin-accent)]">−{money(l.exciseExemptedMinor)} excise</p>
                        ) : null}
                        {l.salesExempt ? (
                          <p className="font-bold text-[var(--admin-accent)]">−{money(l.salesTaxExemptedMinor)} sales tax</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-white/40">no exemption</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {plan.claimedLineCount > 0 ? (
              <p className="mt-2 border-t border-white/10 pt-2 text-xs text-white/50">
                {plan.claimedLineCount} line{plan.claimedLineCount === 1 ? "" : "s"} will claim exemptions totaling{" "}
                <span className="font-bold text-[var(--admin-accent)]">
                  {money(plan.exciseExemptedMinor + plan.salesTaxExemptedMinor)}
                </span>
                . The WAC 314-55-090(2) records (UPID, card dates, SKU, price) are written automatically at
                completion — completion refuses if they cannot be written.
              </p>
            ) : (
              <p className="mt-2 border-t border-white/10 pt-2 text-xs text-white/40">
                No line claims an exemption — only DOH-verified (246-70) products qualify. Register products under
                Medical → DOH products.
              </p>
            )}
          </div>

          {!isClosed ? (
            <form action={detachMedicalCardAction}>
              <input type="hidden" name="id" value={order.id} />
              {/* SLICE L-39 — SaveButton, not a plain submit. On success the section
                  swaps to the "attach" view (the button leaves the page, so the
                  pending bar clears), but when the detach FAILS the action only
                  revalidates: same URL, same button, and a plain button would
                  leave the bar spinning to the 5-minute ceiling. */}
              <SaveButton
                label="Detach card (complete as recreational)"
                busyLabel="Detaching…"
                variant="neutral"
              />
            </form>
          ) : null}
        </div>
      ) : !isClosed ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs leading-5 text-white/50">
            Selling to a registered patient? Verify their recognition card in the MCR, then attach it here —
            exemptions are computed per line and the required records are written at completion.
          </p>
          <form method="GET" className="flex gap-2">
            <input
              type="search"
              name="medq"
              defaultValue={searchQuery}
              placeholder="Search patient name, email, or phone…"
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--admin-accent)]/50 focus:outline-none"
            />
            <Button type="submit" variant="neutral" size="sm" className="shrink-0">
              Search
            </Button>
          </form>
          {searchQuery.trim() ? (
            results.length === 0 ? (
              <p className="text-xs text-white/40">No customers matched. Patients are enrolled via Medical → Intake.</p>
            ) : (
              <ul className="space-y-1.5">
                {results.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white/85">{r.name}</p>
                      <p className="truncate text-xs text-white/40">
                        {r.email ?? "no email"} · {r.phone ?? "no phone"}
                      </p>
                    </div>
                    {r.carded ? (
                      <form action={attachMedicalCardAction}>
                        <input type="hidden" name="id" value={order.id} />
                        <input type="hidden" name="customerId" value={r.id} />
                        <button type="submit" className={`shrink-0 ${CHIP_ACTION}`}>
                          Attach card
                        </button>
                      </form>
                    ) : (
                      <span className="shrink-0 text-[0.66rem] font-bold uppercase tracking-[0.08em] text-white/30">
                        No valid card
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-white/40">
          This order completed as recreational (no recognition card was attached).
        </p>
      )}
    </div>
  );
}
