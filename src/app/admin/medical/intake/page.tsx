/**
 * /admin/medical/intake — Slice 85: a streamlined workflow for taking in a new
 * medical authorization efficiently, built around the equipment the owner
 * purchased (Canon PIXMA TS3522 flatbed scanner + Scotch Thermal Laminator).
 *
 * Flow, grounded in docs/medical-doh-requirements.md (DOH 608-048 / WAC
 * 314-55-090(2)) and docs/medical-authorization-intake.md:
 *   1. Scan the paper authorization on the Canon → upload the file here.
 *   2. Walk the DOH validation checklist (all four must pass to issue).
 *   3. Enter the unique patient identifier + card dates; confirm it's in the MCR.
 *   4. Print the recognition card and laminate it (Scotch laminator).
 *
 * The MCR has NO public retailer API, so we record what the certified consultant
 * validates — we do not call the DOH database directly.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { listCustomers } from "@/lib/customers/store";
import { getCustomerById } from "@/lib/customers/store";
import { getEndorsementConfig, listRecentAuthorizations } from "@/lib/medical/store";
import { AuthorizationIntakeForm } from "@/components/admin/medical/AuthorizationIntakeForm";
import { CustomerPicker } from "@/components/admin/medical/CustomerPicker";
import { markCardPrintedAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function MedicalIntakePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; q?: string; ok?: string; err?: string; scanerr?: string }>;
}) {
  await requirePermission("medical.manage");
  const { customer, q, ok, err, scanerr } = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Operations" }, { label: "Medical", href: "/admin/medical" }, { label: "Intake" }]} />
        <AdminPageHeader title="Authorization intake" subtitle="Take in a new medical authorization." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to manage medical." />
      </div>
    );
  }

  const [config, recent, selected, results] = await Promise.all([
    getEndorsementConfig(),
    listRecentAuthorizations(25),
    customer ? getCustomerById(customer) : Promise.resolve(null),
    q ? listCustomers({ q, limit: 20 }) : Promise.resolve([]),
  ]);

  const notEndorsed = !config?.isMedicallyEndorsed;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Operations" },
          { label: "Medical", href: "/admin/medical" },
          { label: "Authorization intake" },
        ]}
      />
      <AdminPageHeader
        title="Authorization intake"
        subtitle="Scan → validate → issue → print & laminate. Everything in one place."
        help={
          <HelpPanel
            id="medical-intake"
            title="How to take in a new authorization (with your Canon + laminator)"
            steps={[
              "Place the paper authorization face-down on the Canon PIXMA TS3522 flatbed and scan to PDF (Canon PRINT app or Scan Utility).",
              "Upload that scan below and check the four DOH 608-048 boxes (complete/signed, tamper-resistant paper, identity verified, embossed RCW 69.51A.030 seal).",
              "Enter the unique patient identifier + effective/expiration dates. Confirm you entered the patient into the DOH database (MCR) — there is no API; a consultant does this in the MCR.",
              "Issue the card, then click Print card and run it through the Scotch Thermal Laminator.",
            ]}
          >
            <p className="text-xs text-[var(--admin-text-faint)]">
              The scan is retained (private, staff-only) as part of the WAC 314-55-090(2) record.
              See docs/medical-authorization-intake.md.
            </p>
          </HelpPanel>
        }
      />

      {notEndorsed && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
          Store is not medically endorsed — recognition cards / exemptions are disabled. Set the
          endorsement on the Medical page first.
        </div>
      )}

      {ok && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
          Authorization created.{" "}
          <Link href={`/admin/medical/card/${ok}`} target="_blank" className="font-semibold underline">
            Print the recognition card →
          </Link>{" "}
          then laminate it.
          {scanerr ? <span className="ml-2 text-[var(--admin-danger)]">Scan upload failed: {scanerr}</span> : null}
        </div>
      )}
      {err && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
          {err === "nocustomer" ? "Choose a patient first." : err}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Left: pick the patient */}
        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-3 text-sm font-semibold text-[var(--admin-text)]">1 · Patient</h2>
          <CustomerPicker
            query={q ?? ""}
            results={results.map((c) => ({
              id: c.id,
              name: `${c.first_name} ${c.last_name ?? ""}`.trim(),
              email: c.email ?? null,
              phone: c.phone ?? null,
              isMedical: c.is_medical_patient,
            }))}
            selected={
              selected
                ? {
                    id: selected.id,
                    name: `${selected.first_name} ${selected.last_name ?? ""}`.trim(),
                    email: selected.email ?? null,
                    phone: selected.phone ?? null,
                    isMedical: selected.is_medical_patient,
                  }
                : null
            }
          />
        </section>

        {/* Right: the guided intake form */}
        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-3 text-sm font-semibold text-[var(--admin-text)]">
            2 · Scan, validate &amp; issue
          </h2>
          {selected ? (
            <AuthorizationIntakeForm
              customerId={selected.id}
              disabled={notEndorsed}
            />
          ) : (
            <p className="text-sm text-[var(--admin-text-faint)]">
              Choose a patient on the left to start. Search by name, email, or phone.
            </p>
          )}
        </section>
      </div>

      {/* Recent intake queue with scan/print status */}
      <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--admin-text)]">Recent authorizations</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-[var(--admin-text-faint)]">No authorizations yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <th className="px-3 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 font-medium">UPID</th>
                  <th className="px-3 py-2 font-medium">Dates</th>
                  <th className="px-3 py-2 font-medium">MCR</th>
                  <th className="px-3 py-2 font-medium">Scan</th>
                  <th className="px-3 py-2 font-medium">Card</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--admin-border)]/50 last:border-0">
                    <td className="px-3 py-2 text-[var(--admin-text)]">{r.customer_name ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--admin-text-muted)]">
                      {r.unique_patient_identifier ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--admin-text-faint)]">
                      {r.effective_on ?? "—"} → {r.expires_on ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.in_doh_database ? <Badge tone="green">In MCR</Badge> : <Badge tone="orange">Not yet</Badge>}
                    </td>
                    <td className="px-3 py-2">
                      {r.form_scan_path ? <Badge tone="green">Scanned</Badge> : <Badge tone="neutral">—</Badge>}
                    </td>
                    <td className="px-3 py-2">
                      {r.card_printed_at ? (
                        <Badge tone="green">Printed</Badge>
                      ) : (
                        <Badge tone="neutral">—</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/admin/medical/card/${r.id}`}
                          target="_blank"
                          className="text-xs font-semibold text-[var(--admin-accent)] underline"
                        >
                          🖨 Print card
                        </Link>
                        {!r.card_printed_at && (
                          <form action={markCardPrintedAction}>
                            <input type="hidden" name="authorization_row_id" value={r.id} />
                            <button
                              type="submit"
                              className="text-xs text-[var(--admin-text-faint)] underline hover:text-[var(--admin-accent)]"
                            >
                              mark printed
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
