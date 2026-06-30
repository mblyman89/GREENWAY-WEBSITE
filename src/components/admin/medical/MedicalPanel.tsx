/**
 * src/components/admin/medical/MedicalPanel.tsx
 *
 * Per-customer medical recognition-card panel for the customer detail page.
 * Lets a Certified Medical Cannabis Consultant issue a card (gated by the DOH
 * 608-048 form checklist), validate it in the MCR, print it, and revoke/expire.
 */
import Link from "next/link";
import { Button, Input, Select, Field, Badge } from "@/components/admin/ui";
import { listAuthorizations, toRecognitionCard } from "@/lib/medical/store";
import { cardValidity } from "@/lib/medical/tax";
import { issueCardAction, setCardStatusAction, validateMcrAction } from "@/app/admin/medical/actions";

function fmtDate(d: string | null): string {
  return d ?? "—";
}

const STATUS_TONE: Record<string, "green" | "gold" | "danger" | "neutral"> = {
  active: "green",
  expired: "gold",
  revoked: "danger",
};

export async function MedicalPanel({
  customerId,
  canManage,
}: {
  customerId: string;
  canManage: boolean;
}) {
  const cards = await listAuthorizations(customerId);

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Medical recognition cards</h2>
        <Badge tone="outline">DOH / WAC 314-55-090</Badge>
      </div>

      {cards.length === 0 ? (
        <p className="mb-4 text-sm text-[var(--admin-text-faint)]">No recognition card on file.</p>
      ) : (
        <div className="mb-4 space-y-2">
          {cards.map((c) => {
            const v = cardValidity(toRecognitionCard(c));
            return (
              <div key={c.id} className="rounded-lg border border-[var(--admin-border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Badge>
                    <span className="text-sm font-semibold text-white">
                      {c.holder_type === "designated_provider" ? "Designated Provider" : "Patient"}
                    </span>
                    {c.in_doh_database ? (
                      <Badge tone="green">In MCR</Badge>
                    ) : (
                      <Badge tone="orange">Not in MCR</Badge>
                    )}
                  </div>
                  <span className="font-mono text-xs text-white/60">
                    UPID {c.unique_patient_identifier ?? "—"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-white/50">
                  Effective {fmtDate(c.effective_on ?? c.issued_on)} · Expires {fmtDate(c.expires_on)} ·{" "}
                  {v.valid ? (
                    <span className="text-[var(--admin-green)]">valid for exemptions</span>
                  ) : (
                    <span className="text-orange-400">{v.reason}</span>
                  )}
                </p>
                {canManage && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link href={`/admin/medical/card/${c.id}`} target="_blank">
                      <Button variant="subtle">Print card</Button>
                    </Link>
                    {!c.in_doh_database && (
                      <form action={validateMcrAction}>
                        <input type="hidden" name="authorization_row_id" value={c.id} />
                        <input type="hidden" name="customer_id" value={customerId} />
                        <Button type="submit" variant="subtle">
                          Mark validated in MCR
                        </Button>
                      </form>
                    )}
                    {c.status === "active" && (
                      <form action={setCardStatusAction}>
                        <input type="hidden" name="authorization_row_id" value={c.id} />
                        <input type="hidden" name="customer_id" value={customerId} />
                        <input type="hidden" name="status" value="revoked" />
                        <Button type="submit" variant="subtle">
                          Revoke
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManage && (
        <details className="rounded-lg border border-[var(--admin-border)] p-3">
          <summary className="cursor-pointer text-sm font-semibold text-white/80">
            Issue a new recognition card
          </summary>
          <form action={issueCardAction} className="mt-3 space-y-3">
            <input type="hidden" name="customer_id" value={customerId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Unique patient identifier (UPID)" help="From the MCR">
                <Input name="unique_patient_identifier" placeholder="e.g. 1234567" />
              </Field>
              <Field label="Holder type">
                <Select name="holder_type" defaultValue="patient">
                  <option value="patient">Patient</option>
                  <option value="designated_provider">Designated Provider</option>
                </Select>
              </Field>
              <Field label="Effective date">
                <Input name="effective_on" type="date" />
              </Field>
              <Field label="Expiration date">
                <Input name="expires_on" type="date" />
              </Field>
            </div>

            <div className="rounded-lg border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-3">
              <p className="mb-2 text-xs font-semibold text-[var(--admin-gold)]">
                Authorization-form checklist (DOH 608-048) — all required
              </p>
              <div className="space-y-2 text-sm text-white/80">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="chk_form" className="h-4 w-4" /> Form complete &amp; signed by a
                  health care practitioner
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="chk_tamper" className="h-4 w-4" /> Printed on tamper-resistant
                  paper with a security feature
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="chk_identity" className="h-4 w-4" /> Identity verified (full legal
                  name, physical address)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="chk_seal" className="h-4 w-4" /> Embossed RCW 69.51A.030 seal
                  visible
                </label>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-white/80">
              <input type="checkbox" name="in_doh_database" defaultChecked className="h-4 w-4" /> Card is active in
              the DOH database (MCR) — enables tax exemptions
            </label>

            <Field label="Notes (optional)">
              <Input name="notes" placeholder="Internal note" />
            </Field>

            <Button type="submit" variant="subtle">
              Issue recognition card
            </Button>
          </form>
        </details>
      )}
    </div>
  );
}
