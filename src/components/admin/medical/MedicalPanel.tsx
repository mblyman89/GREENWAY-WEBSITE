/**
 * src/components/admin/medical/MedicalPanel.tsx
 *
 * Per-customer medical recognition-card panel for the customer detail page.
 * Lets a Certified Medical Cannabis Consultant issue a card (gated by the DOH
 * 608-048 form checklist), validate it in the MCR, print it, and revoke/expire.
 */
import Link from "next/link";
import { Button, Badge } from "@/components/admin/ui";
import { listAuthorizations, toRecognitionCard } from "@/lib/medical/store";
import { cardValidity } from "@/lib/medical/tax";
import { setCardStatusAction, validateMcrAction } from "@/app/admin/medical/actions";

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
                      <Button variant="neutral">Print card</Button>
                    </Link>
                    {!c.in_doh_database && (
                      <form action={validateMcrAction}>
                        <input type="hidden" name="authorization_row_id" value={c.id} />
                        <input type="hidden" name="customer_id" value={customerId} />
                        <Button type="submit" variant="neutral">
                          Mark validated in MCR
                        </Button>
                      </form>
                    )}
                    {c.status === "active" && (
                      <form action={setCardStatusAction}>
                        <input type="hidden" name="authorization_row_id" value={c.id} />
                        <input type="hidden" name="customer_id" value={customerId} />
                        <input type="hidden" name="status" value="revoked" />
                        <Button type="submit" variant="neutral">
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
        <Button
          href={`/admin/medical?patient=${customerId}`}
          variant="confirm"
          className="gap-2"
        >
          📇 Start guided intake for this patient →
        </Button>
      )}
    </div>
  );
}
